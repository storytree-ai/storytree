// Capability 2 · Library transactions
import { AsyncLocalStorage } from "node:async_hooks";

export interface RecordEnvelope {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type Action = "created" | "updated" | "retired";

export interface HistoryEntry {
  seq: number;
  recordId: string;
  type: string;
  action: Action;
  record: RecordEnvelope;
  reason?: string;
  actor?: string;
  outsideRead?: string[];
  at: string;
  recordedBy?: string;
}

export type OutsideRead = (type: string) => readonly string[] | undefined;
export type Validate = (candidate: RecordEnvelope) => void;
export type Upgrade = (current: RecordEnvelope) => RecordEnvelope;

interface Writing {
  readonly signal?: AbortSignal;
  readonly actor?: string;
  readonly outsideRead?: OutsideRead;
}

export interface SaveInput extends Writing {
  readonly id: string;
  readonly type: string;
  readonly fields: Record<string, unknown>;
  readonly version?: number;
  readonly validate?: Validate;
}

export interface EditInput extends Writing {
  readonly id: string;
  readonly fields: Record<string, unknown>;
  readonly reason?: string;
  readonly upgrade?: Upgrade;
  readonly validate?: Validate;
}

export interface RetireInput extends Writing {
  readonly id: string;
  readonly reason: string;
}

export interface RevertInput extends Writing {
  readonly id: string;
  readonly to: number;
  readonly read: number;
  readonly reason?: string;
  readonly validate?: Validate;
}

export interface RevertWritesInput {
  readonly signal?: AbortSignal;
  readonly of: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly validate?: Validate;
}

export interface RevertedWrite {
  readonly id: string;
  readonly action: "updated" | "retired";
  readonly to?: number;
}

export interface HistoryFilter {
  readonly id?: string;
  readonly since?: number;
  readonly actor?: string;
  readonly from?: string;
  readonly types?: readonly string[];
  readonly actions?: readonly Action[];
  readonly oldest?: number;
  readonly newest?: number;
}

export type FieldValues = Readonly<Record<string, string | number | boolean | null>>;

export interface Projection {
  readonly version: number;
  readonly fields: readonly string[];
  readonly older?: readonly { readonly version: number; readonly fields: readonly string[] }[];
}

export interface ListFilter {
  readonly after?: string;
  readonly phrase?: { readonly text: string; readonly fields?: readonly string[] };
  readonly ids?: readonly string[];
  readonly names?: string;
  readonly where?: FieldValues;
  readonly limit?: number;
  readonly projection?: Projection;
}

export interface Transactions {
  save(input: SaveInput): Promise<RecordEnvelope>;
  saveAll(inputs: readonly SaveInput[], signal?: AbortSignal): Promise<RecordEnvelope[]>;
  get(id: string): Promise<RecordEnvelope | null>;
  list(type: string | readonly string[], filter?: ListFilter): Promise<RecordEnvelope[]>;
  edit(input: EditInput): Promise<RecordEnvelope | null>;
  retire(input: RetireInput): Promise<void>;
  revert(input: RevertInput): Promise<RecordEnvelope>;
  revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]>;
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
  inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export type NewEntry = Omit<HistoryEntry, "seq" | "at" | "recordedBy">;

export interface Reader {
  get(id: string): Promise<RecordEnvelope | null>;
  list(types: readonly string[], filter: ListFilter): Promise<RecordEnvelope[]>;
  history(filter: HistoryFilter): Promise<HistoryEntry[]>;
}

export interface Writer extends Reader {
  put(record: RecordEnvelope): Promise<void>;
  remove(id: string): Promise<void>;
  append(entry: NewEntry): Promise<void>;
}

export interface Backend {
  readonly reader: Reader;
  write<T>(work: (writer: Writer) => Promise<T>, signal: AbortSignal | undefined): Promise<T>;
}

export class LaterWriterError extends Error {
  override readonly name = "LaterWriterError";
}

const ACTIONS: readonly string[] = ["created", "updated", "retired"];

export class Store implements Transactions {
  readonly #backend: Backend;
  readonly #open = new AsyncLocalStorage<Writer>();

  constructor(backend: Backend) {
    this.#backend = backend;
  }

  async save(input: SaveInput): Promise<RecordEnvelope> {
    return await this.#write((writer) => saveOne(writer, input), input.signal);
  }

  async saveAll(inputs: readonly SaveInput[], signal?: AbortSignal): Promise<RecordEnvelope[]> {
    return await this.#write(async (writer) => {
      const saved: RecordEnvelope[] = [];
      for (const input of inputs) saved.push(await saveOne(writer, input));
      return saved;
    }, signal);
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    return await this.#reader().get(id);
  }

  async list(type: string | readonly string[], filter: ListFilter = {}): Promise<RecordEnvelope[]> {
    return await this.#reader().list(typeof type === "string" ? [type] : type, filter);
  }

  async edit(input: EditInput): Promise<RecordEnvelope | null> {
    return await this.#write(async (writer) => {
      const stored = await writer.get(input.id);
      if (stored === null) return null;
      const current = input.upgrade === undefined ? stored : input.upgrade(stored);
      const fields: Record<string, unknown> = { ...current.fields, ...input.fields };
      for (const [field, value] of Object.entries(fields)) if (value === undefined) delete fields[field];
      const record = { ...current, fields, updatedAt: new Date().toISOString() };
      input.validate?.(record);
      await writer.put(record);
      await writer.append(entry("updated", record, input, input.reason));
      return record;
    }, input.signal);
  }

  async retire(input: RetireInput): Promise<void> {
    await this.#write(async (writer) => {
      const stored = await writer.get(input.id);
      if (stored === null) return;
      await writer.remove(input.id);
      await writer.append(entry("retired", stored, input, input.reason));
    }, input.signal);
  }

  async revert(input: RevertInput): Promise<RecordEnvelope> {
    return await this.#write(async (writer) => {
      const entries = await writer.history({ id: input.id });
      const newest = entries.at(-1)?.seq;
      if (newest !== input.read) {
        throw new Error(`${input.id} was written after entry ${input.read} (its newest is ${String(newest)}): read it again before reverting`);
      }
      const target = entries.find((candidate) => candidate.seq === input.to && candidate.action !== "retired");
      if (target === undefined) throw new Error(`entry ${input.to} is not a state of ${input.id} to revert to`);
      const record = { ...target.record, updatedAt: new Date().toISOString() };
      input.validate?.(record);
      const why = `reverted to entry ${input.to}, written by ${writerOf(target)}`;
      await writer.put(record);
      await writer.append(entry("updated", record, input, input.reason === undefined ? why : `${why}: ${input.reason}`));
      return record;
    }, input.signal);
  }

  async revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]> {
    return await this.#write(async (writer) => {
      const byRecord = new Map<string, HistoryEntry[]>();
      for (const change of await writer.history({})) byRecord.set(change.recordId, [...(byRecord.get(change.recordId) ?? []), change]);
      const later: string[] = [];
      const plan: { readonly write: RevertedWrite; readonly record: RecordEnvelope }[] = [];
      for (const [id, entries] of byRecord) {
        const first = entries.findIndex((change) => change.actor === input.of);
        if (first < 0 || entries[first]!.type === "health") continue;
        const other = entries.slice(first + 1).find((change) => change.actor !== input.of);
        if (other !== undefined) later.push(`${id} at entry ${other.seq} by ${writerOf(other)}`);
        const before = entries[first - 1];
        const live = await writer.get(id);
        if (before === undefined || before.action === "retired") {
          if (live !== null) plan.push({ write: { id, action: "retired" }, record: live });
        } else {
          plan.push({ write: { id, action: "updated", to: before.seq }, record: { ...before.record, updatedAt: new Date().toISOString() } });
        }
      }
      if (later.length > 0) throw new LaterWriterError(`${input.of}'s writes cannot be reverted: another writer wrote later to ${later.join("; ")}`);
      for (const { write, record } of plan) if (write.action === "updated") input.validate?.(record);
      for (const { write, record } of plan) {
        const back = write.to === undefined ? `reverting ${input.of}'s writes, which made it` : `reverting ${input.of}'s writes, back to entry ${write.to}`;
        const reason = input.reason === undefined ? back : `${back}: ${input.reason}`;
        if (write.action === "retired") await writer.remove(write.id);
        else await writer.put(record);
        await writer.append(entry(write.action, record, input, reason));
      }
      return plan.map(({ write }) => write);
    }, input.signal);
  }

  async history(filter: HistoryFilter = {}): Promise<HistoryEntry[]> {
    checkHistoryFilter(filter);
    return await this.#reader().history(filter);
  }

  async inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return await this.#write(work, signal);
  }

  #reader(): Reader {
    return this.#open.getStore() ?? this.#backend.reader;
  }

  async #write<T>(work: (writer: Writer) => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    const open = this.#open.getStore();
    if (open !== undefined) return await work(open);
    return await this.#backend.write((writer) => this.#open.run(writer, () => work(writer)), signal);
  }
}

async function saveOne(writer: Writer, input: SaveInput): Promise<RecordEnvelope> {
  const stored = await writer.get(input.id);
  const now = new Date().toISOString();
  const record = { id: input.id, type: input.type, version: input.version ?? 1, fields: input.fields, createdAt: stored?.createdAt ?? now, updatedAt: now };
  input.validate?.(record);
  await writer.put(record);
  await writer.append(entry(stored === null ? "created" : "updated", record, input, undefined));
  return record;
}

function entry(action: Action, record: RecordEnvelope, by: { readonly actor?: string; readonly outsideRead?: OutsideRead }, reason: string | undefined): NewEntry {
  const read = by.outsideRead?.(record.type);
  return {
    recordId: record.id,
    type: record.type,
    action,
    record,
    ...(reason === undefined ? {} : { reason }),
    ...(by.actor === undefined ? {} : { actor: by.actor }),
    ...(read === undefined ? {} : { outsideRead: [...read] }),
  };
}

function writerOf(change: HistoryEntry): string {
  return change.actor ?? "a writer who gave no name";
}

function checkHistoryFilter(filter: HistoryFilter): void {
  for (const limit of [filter.oldest, filter.newest]) {
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new RangeError(`a history limit is a whole number above 0, not ${limit}`);
  }
  if (filter.oldest !== undefined && filter.newest !== undefined) throw new RangeError("a history read takes the oldest or the newest entries, not both");
  if (filter.from !== undefined && Number.isNaN(Date.parse(filter.from))) throw new RangeError(`${JSON.stringify(filter.from)} is not a time`);
  for (const action of filter.actions ?? []) {
    if (!ACTIONS.includes(action)) throw new RangeError(`${JSON.stringify(action)} is not an action a change has (${ACTIONS.join(", ")})`);
  }
}

export function project(record: RecordEnvelope, projection: Projection | undefined): RecordEnvelope {
  const named = [projection, ...(projection?.older ?? [])].find((version) => version?.version === record.version);
  if (named === undefined) return record;
  return { ...record, fields: Object.fromEntries(named.fields.filter((field) => Object.hasOwn(record.fields, field)).map((field) => [field, record.fields[field]])) };
}
