// Capability 2 · Library transactions
import { isDeepStrictEqual } from "node:util";

import { project, Store, type Backend, type HistoryEntry, type HistoryFilter, type ListFilter, type NewEntry, type Reader, type RecordEnvelope, type Writer } from "./transactions.js";

export class MemoryTransactions extends Store {
  constructor() {
    super(new MemoryBackend());
  }
}

class MemoryBackend implements Backend {
  #records = new Map<string, RecordEnvelope>();
  #entries: HistoryEntry[] = [];
  #queue: Promise<unknown> = Promise.resolve();

  readonly reader: Reader = {
    get: async (id) => structuredClone(this.#records.get(id) ?? null),
    list: async (types, filter) => list(this.#records, types, filter),
    history: async (filter) => history(this.#entries, filter),
  };

  async write<T>(work: (writer: Writer) => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    signal?.throwIfAborted();
    const turn = this.#queue.then(async () => {
      signal?.throwIfAborted();
      const records = new Map(this.#records);
      const entries = [...this.#entries];
      const done = await work({
        get: async (id) => structuredClone(records.get(id) ?? null),
        list: async (types, filter) => list(records, types, filter),
        history: async (filter) => history(entries, filter),
        put: async (record) => {
          records.set(record.id, structuredClone(record));
        },
        remove: async (id) => {
          records.delete(id);
        },
        append: async (entry) => {
          append(entries, entry);
        },
      });
      this.#records = records;
      this.#entries = entries;
      return done;
    });
    this.#queue = turn.catch(() => {});
    return await turn;
  }
}

function append(entries: HistoryEntry[], entry: NewEntry): void {
  const seq = (entries.at(-1)?.seq ?? 0) + 1;
  entries.push(structuredClone({ ...entry, seq, at: entry.action === "retired" ? new Date().toISOString() : entry.record.updatedAt }));
}

function list(records: Map<string, RecordEnvelope>, types: readonly string[], filter: ListFilter): RecordEnvelope[] {
  const names = filter.names;
  const found = [...records.values()]
    .filter((record) => types.includes(record.type))
    .filter((record) => filter.ids === undefined || filter.ids.includes(record.id))
    .filter((record) => filter.after === undefined || record.id > filter.after)
    .filter((record) => filter.phrase === undefined || holds(record, filter.phrase))
    .filter((record) => Object.entries(filter.where ?? {}).every(([field, value]) => isDeepStrictEqual(record.fields[field], value)))
    .filter((record) => names === undefined || Object.values(record.fields).some((value) => value === names || (Array.isArray(value) && value.includes(names))))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, filter.limit);
  return found.map((record) => structuredClone(project(record, filter.projection)));
}

function history(entries: readonly HistoryEntry[], filter: HistoryFilter): HistoryEntry[] {
  const from = filter.from === undefined ? undefined : Date.parse(filter.from);
  const found = entries.filter((entry) =>
    (filter.id === undefined || entry.recordId === filter.id) &&
    (filter.since === undefined || entry.seq > filter.since) &&
    (filter.actor === undefined || entry.actor === filter.actor) &&
    (from === undefined || Date.parse(entry.at) >= from) &&
    (filter.types === undefined || filter.types.includes(entry.type)) &&
    (filter.actions === undefined || filter.actions.includes(entry.action)));
  const kept = filter.newest !== undefined ? found.slice(-filter.newest) : found.slice(0, filter.oldest);
  return structuredClone(kept);
}

function holds(record: RecordEnvelope, phrase: NonNullable<ListFilter["phrase"]>): boolean {
  return Object.entries(record.fields).some(([field, value]) =>
    typeof value === "string" && (phrase.fields === undefined || phrase.fields.includes(field)) && value.includes(phrase.text));
}
