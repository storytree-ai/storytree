// Capability 29 · Factory and product
import { SchemaRecords, type FieldsOf, type LibrarySchema, type RecordType, type SchemaRecord, type WriteOptions } from "../../storage/rules/index.js";
import type { ListFilter, Transactions } from "../../storage/store/index.js";

export interface SystemSwitches {
  readonly off: readonly string[];
  readonly on: readonly string[];
}

export interface InheritedRecords {
  inherited(): Promise<SchemaRecord[]>;
}

const GROUPS: Readonly<Record<string, readonly string[]>> = {
  roles: ["agent"],
  checks: ["check"],
  notes: ["principle", "guardrail", "pattern", "process"],
};

const SYSTEM: readonly string[] = Object.values(GROUPS).flat();

type Filter = Omit<ListFilter, "projection">;

interface Resolved {
  readonly record: SchemaRecord;
  readonly own: boolean;
}

function titleOf(record: { readonly fields: unknown }): unknown {
  return (record.fields as { title?: unknown }).title;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class ProjectRecords extends SchemaRecords implements InheritedRecords {
  readonly #transactions: Transactions;
  readonly #system: readonly string[];
  readonly #factory: SchemaRecords | undefined;
  readonly #switches: SystemSwitches | undefined;

  constructor(transactions: Transactions, schema: LibrarySchema, factory: SchemaRecords | undefined, switches: SystemSwitches | undefined) {
    super(transactions, schema);
    this.#transactions = transactions;
    this.#system = SYSTEM.filter((type) => Object.hasOwn(schema.versions, type));
    this.#factory = factory;
    this.#switches = switches;
  }

  override async get(id: string): Promise<SchemaRecord | null> {
    return (await this.#resolve(id))?.record ?? null;
  }

  override async list<T extends RecordType>(type: T | readonly T[], filter: Filter = {}): Promise<SchemaRecord<T>[]> {
    if (this.#factory === undefined && this.#switches === undefined) return await super.list(type, filter);
    const { limit, ...rest } = filter;
    const types: readonly T[] = typeof type === "string" ? [type as T] : (type as readonly T[]);
    const own = await super.list(types, rest);
    const inherited = await this.#inheritedOf(types.filter((each) => this.#system.includes(each)), rest);
    const shown = [...own, ...inherited].sort(byId).filter((record) => this.#shown(record));
    return (limit === undefined ? shown : shown.slice(0, limit)) as SchemaRecord<T>[];
  }

  override async select<T extends RecordType, K extends keyof FieldsOf<T> & string>(
    type: T,
    fields: readonly K[],
    filter: Filter = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<FieldsOf<T>, K> })[]> {
    if (this.#factory === undefined && this.#switches === undefined) return await super.select(type, fields, filter);
    const listed = await this.list(type, filter);
    return listed.map((record) => {
      const held = record.fields as Record<string, unknown>;
      return { ...record, fields: Object.fromEntries(fields.filter((field) => Object.hasOwn(held, field)).map((field) => [field, held[field]])) };
    }) as never;
  }

  override async edit(id: string, fields: Parameters<SchemaRecords["edit"]>[1], options: WriteOptions = {}): Promise<SchemaRecord | null> {
    if (this.#factory === undefined) return await super.edit(id, fields, options);
    const resolved = await this.#resolve(id);
    if (resolved === null || resolved.own) return await super.edit(resolved?.record.id ?? id, fields, options);
    const theirs = resolved.record;
    const merged: Record<string, unknown> = { ...theirs.fields, ...fields };
    for (const [field, value] of Object.entries(merged)) if (value === undefined) delete merged[field];
    return await this.create(theirs.type, merged as FieldsOf<RecordType>, { ...options, id: theirs.id });
  }

  override async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    const factory = this.#factory;
    if (factory === undefined) return await super.retire(id, reason, options);
    const resolved = await this.#resolve(id);
    await this.#transactions.inOneWrite(async () => {
      if (resolved?.own === true) await super.retire(resolved.record.id, reason, options);
      if (resolved?.own === true && resolved.record.id === id) return;
      const theirs = await factory.get(id);
      if (theirs === null || !this.#system.includes(theirs.type)) return;
      await this.#transactions.save({ id, type: theirs.type, version: theirs.version, fields: theirs.fields as Record<string, unknown>, ...(options.actor === undefined ? {} : { actor: options.actor }) });
      await super.retire(id, reason, options);
    }, options.signal);
  }

  async inherited(): Promise<SchemaRecord[]> {
    return (await this.#inheritedOf(this.#system, {})).sort(byId);
  }

  async #resolve(id: string): Promise<Resolved | null> {
    const own = await super.get(id);
    if (own !== null) return { record: own, own: true };
    const factory = this.#factory;
    if (factory === undefined) return null;
    const last = (await this.#transactions.history({ id, newest: 1 }))[0];
    if (last !== undefined) return this.#system.includes(last.type) ? await this.#byTitle(last.type, titleOf(last.record)) : null;
    const theirs = await factory.get(id);
    if (theirs === null || !this.#system.includes(theirs.type)) return null;
    return (await this.#byTitle(theirs.type, titleOf(theirs), true)) ?? { record: theirs, own: false };
  }

  async #byTitle(type: string, title: unknown, ownOnly = false): Promise<Resolved | null> {
    if (typeof title !== "string") return null;
    const own = (await super.list(type as RecordType, { where: { title } }))[0];
    if (own !== undefined) return { record: own, own: true };
    if (ownOnly) return null;
    const theirs = (await this.#inheritedOf([type], { where: { title } }))[0];
    return theirs === undefined ? null : { record: theirs, own: false };
  }

  async #inheritedOf(types: readonly string[], filter: Filter): Promise<SchemaRecord[]> {
    const factory = this.#factory;
    if (factory === undefined || types.length === 0) return [];
    const [own, retired, theirs] = await Promise.all([
      this.#transactions.list(types),
      this.#transactions.history({ actions: ["retired"], types }),
      factory.list(types as readonly RecordType[], filter),
    ]);
    const held = new Set(own.map((record) => record.id));
    const gone = new Set(retired.map((entry) => entry.recordId));
    const titles = new Set(own.map((record) => `${record.type}\u0000${String(titleOf(record))}`));
    return theirs.filter((record) => !held.has(record.id) && !gone.has(record.id) && !titles.has(`${record.type}\u0000${String(titleOf(record))}`));
  }

  #shown(record: { readonly id: string; readonly type: string; readonly fields: unknown }): boolean {
    const switches = this.#switches;
    if (switches === undefined || !this.#system.includes(record.type)) return true;
    const group = Object.keys(GROUPS).find((name) => GROUPS[name]!.includes(record.type));
    for (const names of [[record.id, titleOf(record)], [group], ["all"]]) {
      if (names.some((name) => typeof name === "string" && switches.on.includes(name))) return true;
      if (names.some((name) => typeof name === "string" && switches.off.includes(name))) return false;
    }
    return true;
  }
}
