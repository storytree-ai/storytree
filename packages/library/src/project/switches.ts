// Capability 29 · Factory and product
import { type CreateOptions, type FieldsOf, type HistoryEntry, type HistoryFilter, type LibrarySchema, type ListFilter, type RecordType, type SchemaRecord, SchemaRecords, type Transactions } from "../records/index.js";
import { SYSTEM_KINDS } from "./factory.js";

export interface SystemSwitches {
  readonly off: readonly string[];
  readonly on: readonly string[];
}

const GROUPS: Readonly<Record<string, string>> = {
  agent: "roles",
  check: "checks",
  principle: "notes",
  guardrail: "notes",
  pattern: "notes",
  process: "notes",
};

function switchedOff(switches: SystemSwitches, type: RecordType, id: string, title: string | undefined): boolean {
  const group = GROUPS[type];
  if (group === undefined) return false;
  for (const names of [[id, ...(title === undefined ? [] : [title])], [group], ["all"]]) {
    if (names.some((name) => switches.on.includes(name))) return false;
    if (names.some((name) => switches.off.includes(name))) return true;
  }
  return false;
}

export class SwitchedRecords extends SchemaRecords {
  readonly #records: SchemaRecords;
  readonly #switches: SystemSwitches;

  constructor(transactions: Transactions, records: SchemaRecords, switches: SystemSwitches, schema: LibrarySchema) {
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
    const read = await this.#records.select(type, [...new Set([...fields, "title" as K])], rest);
    const shown = read.filter((record) => this.#shown(record)).map((record) => ({
      ...record,
      fields: Object.fromEntries(Object.entries(record.fields).filter(([name]) => fields.includes(name as K))) as Pick<SchemaRecord<T>["fields"], K>,
    }));
    return limit === undefined ? shown : shown.slice(0, limit);
  }

  #touches(type: RecordType | readonly RecordType[]): boolean {
    return (typeof type === "string" ? [type] : type).some((kind) => SYSTEM_KINDS.includes(kind));
  }

  #shown(record: { readonly id: string; readonly type: RecordType; readonly fields: object }): boolean {
    return !switchedOff(this.#switches, record.type, record.id, (record.fields as { title?: string }).title);
  }
}
