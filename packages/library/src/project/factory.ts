// Capability 29 · Factory and product
import type { Pool } from "pg";

import { type FieldEdit, type LibrarySchema, type ListFilter, type RecordType, type SchemaRecord, SchemaRecords, type Transactions, type WriteOptions } from "../records/index.js";
import { assertProjectName } from "./names.js";

export const SYSTEM_KINDS: readonly RecordType[] = ["agent", "check", "principle", "guardrail", "pattern", "process"];

const isSystem = (kind: RecordType): boolean => SYSTEM_KINDS.includes(kind);

export type FactoryLink = { readonly kind: "factory" } | { readonly kind: "product"; readonly factory: string } | { readonly kind: "none" };

export class ProjectLineage {
  readonly #pool: Pool;
  readonly #name: string;

  constructor(pool: Pool, name: string) {
    this.#pool = pool;
    this.#name = name;
  }

  async factory(): Promise<FactoryLink> {
    const { rows } = await this.#pool.query<{ key: string; value: string }>("SELECT key, value FROM library_meta WHERE key IN ('kind', 'factory')");
    const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    if (meta.kind === "factory") return { kind: "factory" };
    if (meta.kind === "product" && meta.factory !== undefined) return { kind: "product", factory: meta.factory };
    return { kind: "none" };
  }

  async markFactory(): Promise<boolean> {
    const made = await this.#pool.query("INSERT INTO library_meta (key, value) VALUES ('kind', 'factory') ON CONFLICT (key) DO NOTHING");
    if (made.rowCount === 1) return true;
    const link = await this.factory();
    if (link.kind === "factory") return false;
    throw new Error(`Project "${this.#name}" is a product project${link.kind === "product" ? ` built with factory "${link.factory}"` : ""}, so it cannot be made a factory.`);
  }

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

export class InheritedRecords extends SchemaRecords {
  readonly #factory: SchemaRecords;

  constructor(transactions: Transactions, factory: SchemaRecords, schema: LibrarySchema) {
    super(transactions, schema);
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

  override async edit(id: string, fields: FieldEdit, options: Parameters<SchemaRecords["edit"]>[2] = {}): Promise<SchemaRecord | null> {
    if ((await super.get(id)) !== null) return super.edit(id, fields, options);
    const target = await this.get(id);
    if (target === null || (await super.get(target.id)) !== null) return super.edit(target?.id ?? id, fields, options);
    options.checkCurrent?.(target);
    const copy = Object.fromEntries(Object.entries({ ...target.fields, ...fields }).filter(([, value]) => value !== undefined));
    try {
      return await this.create(target.type, copy as never, { id: target.id, onlyIfNew: true, ...writerOf(options) });
    } catch (error) {
      if ((await super.get(target.id)) === null) throw error;
      return super.edit(target.id, fields, options);
    }
  }

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

  async inherited(): Promise<SchemaRecord[]> {
    return (await this.#shown(SYSTEM_KINDS, (kinds, from) => from.list(kinds))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

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

function writerOf(options: WriteOptions): WriteOptions {
  return {
    ...(options.actor === undefined ? {} : { actor: options.actor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.outsideRead === undefined ? {} : { outsideRead: options.outsideRead }),
  };
}

export type Reached<P> = { readonly project: string; readonly opened: P; readonly unopened?: undefined } | { readonly project: string; readonly opened?: undefined; readonly unopened: string };

export class OutsideCircleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutsideCircleError";
  }
}

interface CircleMember {
  readonly name: string;
  readonly lineage: Pick<ProjectLineage, "factory">;
  close(): Promise<void>;
}

export class FactoryCircle<P extends CircleMember> {
  readonly #self: P;
  readonly #open: (name: string) => Promise<P>;
  readonly #list: () => Promise<string[]>;
  readonly #opened = new Map<string, Promise<P>>();

  constructor(self: P, open: (name: string) => Promise<P>, list: () => Promise<string[]>) {
    this.#self = self;
    this.#open = open;
    this.#list = list;
  }

  async reach(name: string): Promise<P> {
    if (name === this.#self.name) return this.#self;
    const home = await this.#home();
    if (home === undefined) throw new OutsideCircleError(`Project "${this.#self.name}" names no factory, so it reads only its own library, never "${name}"'s.`);
    let opening = this.#opened.get(name);
    if (opening === undefined) {
      opening = this.#member(name, home);
      opening.catch(() => this.#opened.delete(name));
      this.#opened.set(name, opening);
    }
    return opening;
  }

  async reachAll(): Promise<Reached<P>[]> {
    if ((await this.#home()) === undefined) return [];
    const reached: Reached<P>[] = [];
    for (const project of (await this.#list()).filter((name) => name !== this.#self.name)) {
      try {
        reached.push({ project, opened: await this.reach(project) });
      } catch (error) {
        if (error instanceof OutsideCircleError || (error instanceof Error && error.name === "ProjectGoneError")) continue;
        reached.push({ project, unopened: error instanceof Error ? error.message : String(error) });
      }
    }
    return reached;
  }

  async close(): Promise<void> {
    const opened = [...this.#opened.values()];
    this.#opened.clear();
    await Promise.all(opened.map((opening) => opening.then((project) => project.close(), () => undefined)));
  }

  async #home(): Promise<string | undefined> {
    const link = await this.#self.lineage.factory();
    if (link.kind === "factory") return this.#self.name;
    return link.kind === "product" ? link.factory : undefined;
  }

  async #member(name: string, home: string): Promise<P> {
    const project = await this.#open(name);
    const link = await project.lineage.factory().catch(async (error: unknown) => {
      await project.close();
      throw error;
    });
    if ((name === home && link.kind === "factory") || (link.kind === "product" && link.factory === home)) return project;
    await project.close();
    throw new OutsideCircleError(`Project "${name}" is neither factory "${home}" nor a project that names it, so it is not read from project "${this.#self.name}".`);
  }
}
