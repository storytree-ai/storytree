/**
 * Capability 1 · Project libraries, contract 1.21: the system switches (ADR-1092 D2). A project opened with them leaves
 * each switched-off role, check and note out of what it lists and selects, and so out of every search, which reads
 * through its lists. Reading one by its id still finds it, as following a link does, and writes are unchanged.
 */
import type { FieldsOf, RecordType } from "../schema/index.js";
import type { LibrarySchema } from "../schema/types.js";
import { SchemaRecords, type CreateOptions, type SchemaRecord } from "../schema/records.js";
import type { HistoryEntry, HistoryFilter, ListFilter, Transactions } from "../transactions/types.js";
import { SYSTEM_KINDS } from "./factory.js";

/**
 * Which parts of the system are switched off and which on, each a list of names: `all`, a group (`roles`, `checks` or
 * `notes`), or one record's title or id. A record's most specific mention decides: its own title or id beats its
 * group, which beats `all`. A system record no name mentions is shown.
 */
export interface SystemSwitches {
  readonly off: readonly string[];
  readonly on: readonly string[];
}

/** Each system kind's group, as a switch names it. */
const GROUPS: Readonly<Record<string, string>> = {
  agent: "roles",
  check: "checks",
  principle: "notes",
  guardrail: "notes",
  pattern: "notes",
  process: "notes",
};

/** Whether `switches` switch off the system record of `type`, `id` and `title`. */
function switchedOff(switches: SystemSwitches, type: RecordType, id: string, title: string | undefined): boolean {
  const group = GROUPS[type];
  if (group === undefined) return false;
  for (const names of [[id, ...(title === undefined ? [] : [title])], [group], ["all"]]) {
    if (names.some((name) => switches.on.includes(name))) return false;
    if (names.some((name) => switches.off.includes(name))) return true;
  }
  return false;
}

/**
 * A project's records with the system switches applied to the merged result, a product's and its factory's together, so
 * a product's own record switched off never lets its factory's of the same title show. Every other read and every write
 * goes to the records it wraps.
 */
export class SwitchedRecords extends SchemaRecords {
  readonly #records: SchemaRecords;
  readonly #switches: SystemSwitches;

  constructor(transactions: Transactions, records: SchemaRecords, switches: SystemSwitches, schema?: LibrarySchema) {
    super(transactions, schema);
    this.#records = records;
    this.#switches = switches;
  }

  override get(id: string): Promise<SchemaRecord | null> {
    return this.#records.get(id);
  }

  override create<T extends RecordType>(type: T, fields: FieldsOf<T>, options?: CreateOptions): Promise<SchemaRecord<T>> {
    return this.#records.create(type, fields, options);
  }

  override edit(...args: Parameters<SchemaRecords["edit"]>): ReturnType<SchemaRecords["edit"]> {
    return this.#records.edit(...args);
  }

  override retire(...args: Parameters<SchemaRecords["retire"]>): ReturnType<SchemaRecords["retire"]> {
    return this.#records.retire(...args);
  }

  override history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return this.#records.history(filter);
  }

  override async list<T extends RecordType>(type: T | readonly T[], filter?: Omit<ListFilter, "projection">): Promise<SchemaRecord<T>[]> {
    if (!this.#touches(type)) return this.#records.list(type, filter);
    const { limit, ...rest } = filter ?? {};
    const shown = (await this.#records.list(type, rest)).filter((record) => this.#shown(record));
    return limit === undefined ? shown : shown.slice(0, limit);
  }

  override async select<T extends RecordType, K extends keyof SchemaRecord<T>["fields"] & string>(
    type: T, fields: readonly K[], filter: Omit<ListFilter, "projection"> = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<SchemaRecord<T>["fields"], K> })[]> {
    if (!this.#touches(type)) return this.#records.select(type, fields, filter);
    const { limit, ...rest } = filter;
    // A record's title decides it, so it is read beside the fields asked for and dropped again unless asked for.
    const read = await this.#records.select(type, [...new Set([...fields, "title" as K])], rest);
    const shown = read.filter((record) => this.#shown(record)).map((record) => ({
      ...record,
      fields: Object.fromEntries(Object.entries(record.fields).filter(([name]) => fields.includes(name as K))) as Pick<SchemaRecord<T>["fields"], K>,
    }));
    return limit === undefined ? shown : shown.slice(0, limit);
  }

  /** Whether reading `type` can meet a record the switches decide. */
  #touches(type: RecordType | readonly RecordType[]): boolean {
    return (typeof type === "string" ? [type] : type).some((kind) => SYSTEM_KINDS.includes(kind));
  }

  #shown(record: { readonly id: string; readonly type: RecordType; readonly fields: object }): boolean {
    return !switchedOff(this.#switches, record.type, record.id, (record.fields as { title?: string }).title);
  }
}
