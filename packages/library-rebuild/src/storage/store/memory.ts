// Capability 2 · Library transactions
import { isDeepStrictEqual } from "node:util";

import { project, Store, type Backend, type HistoryEntry, type HistoryFilter, type ListFilter, type NewEntry, type RecordEnvelope, type Writer } from "./transactions.js";

export class MemoryTransactions extends Store {
  constructor() {
    super(new MemoryBackend());
  }
}

class MemoryBackend implements Backend {
  #records = new Map<string, RecordEnvelope>();
  #entries: HistoryEntry[] = [];
  #queue: Promise<unknown> = Promise.resolve();

  readonly reader: Writer = {
    get: async (id) => structuredClone(this.#records.get(id) ?? null),
    list: async (types, filter) => this.#list(types, filter),
    history: async (filter) => this.#history(filter),
    put: async (record) => {
      this.#records.set(record.id, structuredClone(record));
    },
    remove: async (id) => {
      this.#records.delete(id);
    },
    append: async (entry) => {
      this.#append(entry);
    },
  };

  async write<T>(work: (writer: Writer) => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    signal?.throwIfAborted();
    const turn = this.#queue.then(async () => {
      signal?.throwIfAborted();
      const records = new Map(this.#records);
      const entries = this.#entries.length;
      try {
        return await work(this.reader);
      } catch (error) {
        this.#records = records;
        this.#entries.length = entries;
        throw error;
      }
    });
    this.#queue = turn.catch(() => {});
    return await turn;
  }

  #append(entry: NewEntry): void {
    const seq = (this.#entries.at(-1)?.seq ?? 0) + 1;
    this.#entries.push(structuredClone({ ...entry, seq, at: new Date().toISOString() }));
  }

  #list(types: readonly string[], filter: ListFilter): RecordEnvelope[] {
    const names = filter.names;
    const found = [...this.#records.values()]
      .filter((record) => types.includes(record.type))
      .filter((record) => filter.ids === undefined || filter.ids.includes(record.id))
      .filter((record) => Object.entries(filter.where ?? {}).every(([field, value]) => isDeepStrictEqual(record.fields[field], value)))
      .filter((record) => names === undefined || Object.values(record.fields).some((value) => value === names || (Array.isArray(value) && value.includes(names))))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, filter.limit);
    return found.map((record) => structuredClone(project(record, filter.projection)));
  }

  #history(filter: HistoryFilter): HistoryEntry[] {
    const from = filter.from === undefined ? undefined : Date.parse(filter.from);
    const found = this.#entries.filter((entry) =>
      (filter.id === undefined || entry.recordId === filter.id) &&
      (filter.since === undefined || entry.seq > filter.since) &&
      (filter.actor === undefined || entry.actor === filter.actor) &&
      (from === undefined || Date.parse(entry.at) >= from) &&
      (filter.types === undefined || filter.types.includes(entry.type)) &&
      (filter.actions === undefined || filter.actions.includes(entry.action)));
    const kept = filter.newest !== undefined ? found.slice(-filter.newest) : found.slice(0, filter.oldest);
    return structuredClone(kept);
  }
}
