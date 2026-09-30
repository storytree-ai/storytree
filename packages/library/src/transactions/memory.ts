/**
 * MemoryTransactions: the in-memory twin of PgTransactions. The behaviour suite runs unchanged on
 * both, so later stories can test against this one without a database.
 */
import { check, editedRecord, historyEntry, jsonCopy, now, numbered, savedRecord } from "./records.js";
import type {
  EditInput,
  HistoryEntry,
  HistoryFilter,
  RecordEnvelope,
  RetireInput,
  SaveInput,
  Transactions,
} from "./types.js";

/**
 * Every write reads what is stored, builds and checks the new record, and writes it, with no
 * `await` in between: nothing else can run between its read and its write, so each write is
 * atomic, as a Postgres transaction is. What is stored is only ever replaced, never changed in
 * place, and callers only ever get copies.
 */
export class MemoryTransactions implements Transactions {
  /** The current records by id. A retired record is not here; its history is. */
  readonly #records = new Map<string, RecordEnvelope>();
  readonly #history: HistoryEntry[] = [];
  #lastSeq = 0;

  async save(input: SaveInput): Promise<RecordEnvelope> {
    input.signal?.throwIfAborted();
    if (input.onlyIfNew && this.#history.some((entry) => entry.recordId === input.id)) {
      throw new RangeError(`${input.id} already exists in history; this setting can only be written once`);
    }
    const current = this.#records.get(input.id);
    const record = savedRecord(this.#numbered(input), current, now());
    check(record, input.validate);
    this.#append(current === undefined ? "created" : "updated", record, record.updatedAt, input.actor);
    this.#records.set(record.id, record);
    return jsonCopy(record);
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    const record = this.#records.get(id);
    return record === undefined ? null : jsonCopy(record);
  }

  async list(type: string): Promise<RecordEnvelope[]> {
    return [...this.#records.values()]
      .filter((record) => record.type === type)
      .sort((a, b) => compareIds(a.id, b.id))
      .map((record) => jsonCopy(record));
  }

  async edit(input: EditInput): Promise<RecordEnvelope | null> {
    input.signal?.throwIfAborted();
    const current = this.#records.get(input.id);
    if (current === undefined) return null;
    const record = editedRecord(current, input.fields, now(), input.upgrade);
    if (input.sequence !== undefined) {
      record.fields = (this.#numbered({ ...record, sequence: input.sequence, sequenceNeverHeld: input.sequenceNeverHeld === true })).fields;
    }
    check(record, input.validate);
    this.#append("updated", record, record.updatedAt, input.actor, input.reason);
    this.#records.set(record.id, record);
    return jsonCopy(record);
  }

  async retire(input: RetireInput): Promise<void> {
    input.signal?.throwIfAborted();
    const current = this.#records.get(input.id);
    if (current === undefined) return;
    this.#append("retired", current, now(), input.actor, input.reason);
    this.#records.delete(input.id);
  }

  async history(filter: HistoryFilter = {}): Promise<HistoryEntry[]> {
    const { id, since } = filter;
    return this.#history
      .filter((entry) => (id === undefined || entry.recordId === id) && (since === undefined || entry.seq > since))
      .map((entry) => jsonCopy(entry));
  }

  /** `input` numbered from every number its type's records have held, as the history keeps them. */
  #numbered(input: SaveInput): SaveInput {
    const field = input.sequence;
    if (field === undefined) return input;
    const held = this.#history.filter((entry) => (input.sequenceNeverHeld || entry.type === input.type) && typeof entry.record.fields[field] === "number");
    const highest = Math.max(0, ...held.map((entry) => entry.record.fields[field] as number));
    return numbered(input, highest, (number) => held.some((entry) => (input.sequenceNeverHeld || entry.recordId !== input.id) && entry.record.fields[field] === number));
  }

  /** Append one history entry, numbered one past the last. */
  #append(
    action: HistoryEntry["action"],
    record: RecordEnvelope,
    at: string,
    actor: string | undefined,
    reason?: string,
  ): void {
    this.#lastSeq += 1;
    this.#history.push(
      historyEntry({ seq: this.#lastSeq, recordId: record.id, type: record.type, action, record, reason, actor, at }),
    );
  }
}

/**
 * Code-point order, which is UTF-8 byte order: the order Postgres's C collation gives, so `list`
 * orders ids exactly as PgTransactions does. (JavaScript's default string order is by UTF-16 code
 * unit, which puts characters beyond U+FFFF before U+E000-U+FFFF.)
 */
function compareIds(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
