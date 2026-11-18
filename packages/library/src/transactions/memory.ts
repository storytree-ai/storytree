// Capability 2 · Library transactions
import { AsyncLocalStorage } from "node:async_hooks";

import { check, editedRecord, saveAllInputs, historyEntry, historyFilter, jsonCopy, listed, now, numbered, outsideReadOf, revertedRecord, revertInput, revertReason, savedRecord, writesReverted, writtenBy } from "./records.js";
import type {
  EditInput,
  HistoryEntry,
  HistoryFilter,
  ListFilter,
  RecordEnvelope,
  RetireInput,
  RevertedWrite,
  RevertInput,
  RevertWritesInput,
  SaveInput,
  Transactions,
} from "./types.js";

export class MemoryTransactions implements Transactions {
  readonly #records = new Map<string, RecordEnvelope>();
  readonly #history: HistoryEntry[] = [];
  #lastSeq = 0;
  readonly #inside = new AsyncLocalStorage<true>();
  #open: Promise<unknown> | undefined;

  async save(input: SaveInput): Promise<RecordEnvelope> {
    input.signal?.throwIfAborted();
    while (this.#waits()) await this.#open;
    if (input.onlyIfNew && this.#history.some((entry) => entry.recordId === input.id && entry.type !== "health")) {
      throw new RangeError(`${input.id} already exists in history; this setting can only be written once`);
    }
    const current = this.#records.get(input.id);
    const record = savedRecord(this.#numbered(input), current, now());
    check(record, input.validate);
    this.#append(current === undefined ? "created" : "updated", record, record.updatedAt, input.actor, undefined, outsideReadOf(input.outsideRead, record.type));
    this.#records.set(record.id, record);
    return jsonCopy(record);
  }

  async saveAll(inputs: readonly SaveInput[], signal?: AbortSignal): Promise<RecordEnvelope[]> {
    saveAllInputs(inputs);
    return this.inOneWrite(async () => {
      const saved: RecordEnvelope[] = [];
      for (const input of inputs) saved.push(await this.save(input));
      return saved;
    }, signal);
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    const record = this.#records.get(id);
    return record === undefined ? null : jsonCopy(record);
  }

  async list(type: string | readonly string[], filter: ListFilter = {}): Promise<RecordEnvelope[]> {
    return listed(this.#records.values(), type, filter).map(jsonCopy);
  }

  async edit(input: EditInput): Promise<RecordEnvelope | null> {
    input.signal?.throwIfAborted();
    while (this.#waits()) await this.#open;
    const current = this.#records.get(input.id);
    if (current === undefined) return null;
    const record = editedRecord(current, input.fields, now(), input.upgrade);
    if (input.sequence !== undefined) {
      record.fields = (this.#numbered({ ...record, sequence: input.sequence, sequenceNeverHeld: input.sequenceNeverHeld === true })).fields;
    }
    check(record, input.validate);
    this.#append("updated", record, record.updatedAt, input.actor, input.reason, outsideReadOf(input.outsideRead, record.type));
    this.#records.set(record.id, record);
    return jsonCopy(record);
  }

  async retire(input: RetireInput): Promise<void> {
    input.signal?.throwIfAborted();
    while (this.#waits()) await this.#open;
    const current = this.#records.get(input.id);
    if (current === undefined) return;
    this.#append("retired", current, now(), input.actor, input.reason, outsideReadOf(input.outsideRead, current.type));
    this.#records.delete(input.id);
  }

  async revert(given: RevertInput): Promise<RecordEnvelope> {
    given.signal?.throwIfAborted();
    while (this.#waits()) await this.#open;
    const input = revertInput(given);
    const own = this.#history.filter((entry) => entry.recordId === input.id);
    const current = this.#records.get(input.id);
    const record = revertedRecord(input, own.find((entry) => entry.seq === input.to), own.at(-1)?.seq, current, now());
    check(record, input.validate);
    this.#append("updated", record, record.updatedAt, input.actor, revertReason(input), outsideReadOf(input.outsideRead, record.type));
    this.#records.set(record.id, record);
    return jsonCopy(record);
  }

  async revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]> {
    input.signal?.throwIfAborted();
    while (this.#waits()) await this.#open;
    const ids = new Set(this.#history.filter((entry) => entry.actor === input.of).map((entry) => entry.recordId));
    const written = writtenBy(input.of, this.#history.filter((entry) => ids.has(entry.recordId)));
    const at = now();
    const writes = writesReverted(input, written, (id) => this.#records.get(id), at);
    for (const { reverted, record, reason } of writes) {
      this.#append(reverted.action, record, at, input.actor, reason);
      if (reverted.action === "retired") this.#records.delete(record.id);
      else this.#records.set(record.id, record);
    }
    return writes.map(({ reverted }) => reverted);
  }

  async history(given: HistoryFilter = {}): Promise<HistoryEntry[]> {
    const { id, since, actor, from, types, actions, oldest, newest, upTo, healthColumns, fields } = historyFilter(given);
    const kept = this.#history.filter((entry) =>
      (id === undefined || entry.recordId === id) && (since === undefined || entry.seq > since) && (actor === undefined || entry.actor === actor)
      && (from === undefined || entry.at >= from) && (types === undefined || types.includes(entry.type))
      && (actions === undefined || actions.includes(entry.action)) && (upTo === undefined || entry.seq <= upTo)
      && (healthColumns === undefined || entry.type !== "health" || healthColumns.includes(entry.record.fields.column as string)));
    const limited = oldest !== undefined ? kept.slice(0, oldest) : newest !== undefined ? kept.slice(-newest) : kept;
    return limited.map((entry) => {
      const copy = jsonCopy(entry);
      if (fields !== undefined) copy.record.fields = Object.fromEntries(Object.entries(copy.record.fields).filter(([name]) => fields.includes(name)));
      return copy;
    });
  }

  async inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#inside.getStore() === true) return work();
    signal?.throwIfAborted();
    while (this.#open !== undefined) await this.#open;
    const records = new Map(this.#records);
    const { length } = this.#history;
    const lastSeq = this.#lastSeq;
    const run = this.#inside.run(true, work);
    this.#open = run.catch(() => undefined);
    try {
      return await run;
    } catch (error) {
      this.#records.clear();
      for (const [id, record] of records) this.#records.set(id, record);
      this.#history.length = length;
      this.#lastSeq = lastSeq;
      throw error;
    } finally {
      this.#open = undefined;
    }
  }

  #waits(): boolean {
    return this.#open !== undefined && this.#inside.getStore() !== true;
  }

  #numbered(input: SaveInput): SaveInput {
    const field = input.sequence;
    if (field === undefined) return input;
    const held = this.#history.filter((entry) => (input.sequenceNeverHeld ? entry.type !== "health" : entry.type === input.type) && typeof entry.record.fields[field] === "number");
    const highest = Math.max(0, ...held.map((entry) => entry.record.fields[field] as number));
    return numbered(input, highest, (number) => held.some((entry) => (input.sequenceNeverHeld || entry.recordId !== input.id) && entry.record.fields[field] === number));
  }

  #append(
    action: HistoryEntry["action"],
    record: RecordEnvelope,
    at: string,
    actor: string | undefined,
    reason?: string,
    outsideRead?: string[],
  ): void {
    this.#lastSeq += 1;
    this.#history.push(
      historyEntry({ seq: this.#lastSeq, recordId: record.id, type: record.type, action, record, reason, actor, outsideRead, at }),
    );
  }
}
