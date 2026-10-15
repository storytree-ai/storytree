/**
 * Capability 1 · Project libraries. A project's factory (ADR-1040): the user's factory is a project of its own holding
 * the system their product projects build with, and each product project names it. Both facts are the library's own,
 * kept in library_meta beside the project's name: `kind` is `factory` or `product`, and a product's `factory` is the
 * name of the project it builds with. A project that says neither (one made before factories, or by a join) has none.
 *
 * A product reads its system from its factory (InheritedRecords): its roles, notes and checks are the factory's, except
 * where it holds its own record of the same kind and title, which wins, or retired the factory's. Its memory, and
 * everything it writes, stay its own: an edit of an inherited record writes the product's own copy of it.
 */
import type { Pool } from "pg";

import { SchemaRecords, type FieldEdit, type SchemaRecord, type WriteOptions } from "../schema/records.js";
import type { RecordType } from "../schema/types.js";
import type { ListFilter, Transactions } from "../transactions/types.js";
import { assertProjectName } from "./names.js";

/** The kinds that are a project's system, which a product reads from its factory; never memory (ADR-1040 D3). */
export const SYSTEM_KINDS: readonly RecordType[] = ["agent", "check", "principle", "guardrail", "pattern", "process"];

const isSystem = (kind: RecordType): boolean => SYSTEM_KINDS.includes(kind);

/** What a project is to factories: the user's factory, a product project naming its factory, or neither. */
export type FactoryLink = { readonly kind: "factory" } | { readonly kind: "product"; readonly factory: string } | { readonly kind: "none" };

/** A project's factory link, read and written in its library_meta. */
export class ProjectLineage {
  readonly #pool: Pool;
  readonly #name: string;

  constructor(pool: Pool, name: string) {
    this.#pool = pool;
    this.#name = name;
  }

  /** Whether this project is a factory, a product naming its factory, or neither. */
  async factory(): Promise<FactoryLink> {
    const { rows } = await this.#pool.query<{ key: string; value: string }>("SELECT key, value FROM library_meta WHERE key IN ('kind', 'factory')");
    const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    if (meta.kind === "factory") return { kind: "factory" };
    if (meta.kind === "product" && meta.factory !== undefined) return { kind: "product", factory: meta.factory };
    return { kind: "none" };
  }

  /**
   * Make this project a factory. True when this call made it one, false when it was one already, so of two setups
   * racing to make the same factory only one seeds it. A product project is refused: it builds with a factory.
   */
  async markFactory(): Promise<boolean> {
    const made = await this.#pool.query("INSERT INTO library_meta (key, value) VALUES ('kind', 'factory') ON CONFLICT (key) DO NOTHING");
    if (made.rowCount === 1) return true;
    const link = await this.factory();
    if (link.kind === "factory") return false;
    throw new Error(`Project "${this.#name}" is a product project${link.kind === "product" ? ` built with factory "${link.factory}"` : ""}, so it cannot be made a factory.`);
  }

  /**
   * Record that this project is a product built with factory `name`, replacing any factory it named before. A
   * factory is refused, and so is a project naming itself.
   */
  async recordFactory(name: string): Promise<void> {
    assertProjectName(name);
    if (name === this.#name) throw new RangeError(`Project "${name}" cannot be its own factory.`);
    const client = await this.#pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      const marked = await client.query(
        `INSERT INTO library_meta (key, value) VALUES ('kind', 'product') ON CONFLICT (key)
           DO UPDATE SET value = excluded.value WHERE library_meta.value <> 'factory'`,
      );
      if (marked.rowCount !== 1) throw new Error(`Project "${this.#name}" is a factory, so it builds with no factory of its own.`);
      await client.query("INSERT INTO library_meta (key, value) VALUES ('factory', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [name]);
      await client.query("COMMIT");
    } catch (error) {
      failed = true;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(failed);
    }
  }
}

/**
 * A product project's records, reading its system from its factory's (ADR-1040 D4). For the system kinds, `list` and
 * `select` give the product's own records and the factory's whose kind and title the product holds none of, in id
 * order, and `get` of a factory record's id gives the product's own record of that kind and title when it holds one,
 * so a role's links, written as the factory's ids, read the product's edits; `get` of a system record the product
 * retired gives its own live record of that kind and title, else the factory's, so links to a copy it dropped still
 * read (1.17). An edit of a factory record the product holds no copy of writes its own copy under the factory's id,
 * which then wins, and retiring one retires that copy, which hides the factory's from the product (1.18). Every other
 * kind, every write and the history are the product's own.
 */
export class InheritedRecords extends SchemaRecords {
  readonly #factory: SchemaRecords;

  constructor(transactions: Transactions, factory: SchemaRecords) {
    super(transactions);
    this.#factory = factory;
  }

  override async get(id: string): Promise<SchemaRecord | null> {
    const own = await super.get(id);
    if (own !== null) return own;
    const inherited = await this.#factory.get(id);
    if (inherited !== null) {
      if (!isSystem(inherited.type)) return null;
      const [shadow] = await super.list(inherited.type, { where: { title: (inherited.fields as { title: string }).title } });
      if (shadow !== undefined) return shadow;
      return (await this.#retiredHere(id)) ? null : inherited;
    }
    // A system record the product retired (moving onto its factory drops an unedited copy) reads as its kind and title.
    const last = (await super.history({ id })).at(-1);
    if (last?.action !== "retired") return null;
    const retired = this.current(last.record);
    if (!isSystem(retired.type)) return null;
    const where = { where: { title: (retired.fields as { title: string }).title } };
    const [shadow] = await super.list(retired.type, where);
    if (shadow !== undefined) return shadow;
    const [theirs] = await this.#factory.list(retired.type, where);
    return theirs === undefined || (await this.#retiredHere(theirs.id)) ? null : theirs;
  }

  /**
   * Edit what `id` reads as. A factory record the product holds no copy of is copied into the product under its id,
   * with the edit applied, and the factory's is left as it was.
   */
  override async edit(id: string, fields: FieldEdit, options: Parameters<SchemaRecords["edit"]>[2] = {}): Promise<SchemaRecord | null> {
    if ((await super.get(id)) !== null) return super.edit(id, fields, options);
    const target = await this.get(id);
    if (target === null || (await super.get(target.id)) !== null) return super.edit(target?.id ?? id, fields, options);
    options.checkCurrent?.(target);
    const copy = Object.fromEntries(Object.entries({ ...target.fields, ...fields }).filter(([, value]) => value !== undefined));
    try {
      return await this.create(target.type, copy as never, { id: target.id, onlyIfNew: true, ...writerOf(options) });
    } catch (error) {
      // A racing write made the copy first: edit that.
      if ((await super.get(target.id)) === null) throw error;
      return super.edit(target.id, fields, options);
    }
  }

  /**
   * Retire what `id` reads as. Retiring a factory record retires the product's own record of its kind and title, if it
   * holds one, and a copy of the factory's under its id, so the product reads it no more; the factory's is unchanged.
   */
  override async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    const inherited = (await super.get(id)) === null && (await super.history({ id })).length === 0 ? await this.#factory.get(id) : null;
    if (inherited === null || !isSystem(inherited.type)) return super.retire(id, reason, options);
    const [shadow] = await super.list(inherited.type, { where: { title: (inherited.fields as { title: string }).title } });
    if (shadow !== undefined) await super.retire(shadow.id, reason, options);
    try {
      await this.create(inherited.type, inherited.fields as never, { id, onlyIfNew: true, ...writerOf(options) });
    } catch (error) {
      if ((await super.history({ id })).length === 0) throw error;
    }
    await super.retire(id, reason, options);
  }

  /** Whether the product retired its copy of the record `id`, which hides the factory's of that id. */
  async #retiredHere(id: string): Promise<boolean> {
    return (await super.history({ id })).at(-1)?.action === "retired";
  }

  override async list<T extends RecordType>(type: T | readonly T[], filter?: Omit<ListFilter, "projection">): Promise<SchemaRecord<T>[]> {
    return this.#merged(type, filter, (kinds, from) => from.list(kinds, filter), (kinds) => super.list(kinds, filter));
  }

  override async select<T extends RecordType, K extends keyof SchemaRecord<T>["fields"] & string>(
    type: T, fields: readonly K[], filter: Omit<ListFilter, "projection"> = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<SchemaRecord<T>["fields"], K> })[]> {
    return this.#merged(type, filter, (kinds, from) => from.select(kinds[0]!, fields, filter), (kinds) => super.select(kinds[0]!, fields, filter));
  }

  /**
   * The product's own records of `type` read by `own`, and the factory's read by `read` whose kind and title the
   * product holds none of, whether or not its own match `filter`; kept to `filter.limit` in id order.
   */
  async #merged<T extends RecordType, R extends { readonly id: string; readonly type: RecordType; readonly fields: object }>(
    type: T | readonly T[],
    filter: Omit<ListFilter, "projection"> | undefined,
    read: (kinds: readonly T[], from: SchemaRecords) => Promise<R[]>,
    own: (kinds: readonly T[]) => Promise<R[]>,
  ): Promise<R[]> {
    const kinds = typeof type === "string" ? [type] : type;
    const mine = await own(kinds);
    const inheritable = kinds.filter(isSystem);
    if (inheritable.length === 0) return mine;
    const merged = [...mine, ...(await this.#shown(inheritable, read))].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return filter?.limit === undefined ? merged : merged.slice(0, filter.limit);
  }

  /**
   * The factory's system records the product reads as its own (1.19): those whose kind and title it holds no record of,
   * and whose id it never retired a copy under, in id order. Its own copies and shadows are its own records, not these;
   * a product's globe draws these beside its history.
   */
  async inherited(): Promise<SchemaRecord[]> {
    return (await this.#shown(SYSTEM_KINDS, (kinds, from) => from.list(kinds))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The factory's records of the system kinds `inheritable` read by `read` that the product holds no record of that kind and title for, nor retired. */
  async #shown<T extends RecordType, R extends { readonly id: string; readonly type: RecordType; readonly fields: object }>(
    inheritable: readonly T[],
    read: (kinds: readonly T[], from: SchemaRecords) => Promise<R[]>,
  ): Promise<R[]> {
    const held = new Set<string>();
    const last = new Map<string, string>();
    for (const entry of await super.history({ types: inheritable })) last.set(entry.recordId, entry.action);
    for (const kind of inheritable) {
      for (const record of await super.select(kind, ["title" as never])) held.add(`${kind}\0${(record.fields as { title: string }).title}`);
    }
    const inherited = (await Promise.all(inheritable.map((kind) => read([kind], this.#factory)))).flat();
    return inherited.filter((record) => !held.has(`${record.type}\0${(record.fields as { title?: string }).title}`) && last.get(record.id) !== "retired");
  }
}

/** Who is writing and the abort signal, from an edit's options, for a write that is not an edit. */
function writerOf(options: WriteOptions): WriteOptions {
  return { ...(options.actor === undefined ? {} : { actor: options.actor }), ...(options.signal === undefined ? {} : { signal: options.signal }) };
}
