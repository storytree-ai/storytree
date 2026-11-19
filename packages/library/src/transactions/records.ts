// Capability 2 · Library transactions
import type { HistoryEntry, HistoryFilter, ListFilter, OutsideRead, RecordEnvelope, RevertedWrite, RevertInput, RevertWritesInput, SaveInput, Upgrade, Validate } from "./types.js";

export function now(): string {
  return new Date().toISOString();
}

const HISTORY_ACTIONS: readonly HistoryEntry["action"][] = ["created", "updated", "retired"];

export function historyFilter(filter: HistoryFilter): HistoryFilter {
  const { from, oldest, newest, actions } = filter;
  for (const action of actions ?? []) {
    if (!HISTORY_ACTIONS.includes(action)) throw new RangeError(`history's actions are ${HISTORY_ACTIONS.join(", ")}, not ${JSON.stringify(action)}`);
  }
  for (const [name, limit] of [["oldest", oldest], ["newest", newest]] as const) {
    if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0)) {
      throw new RangeError(`history's ${name} is how many changes to keep, a whole number above 0, not ${String(limit)}`);
    }
  }
  if (oldest !== undefined && newest !== undefined) throw new RangeError("history keeps the oldest or the newest changes, not both");
  if (from === undefined) return filter;
  const at = typeof from === "string" ? Date.parse(from) : Number.NaN;
  if (Number.isNaN(at)) throw new RangeError(`history's from is a time (ISO 8601), not ${JSON.stringify(from)}`);
  return { ...filter, from: new Date(at).toISOString() };
}

export function listFilter(filter: ListFilter): ListFilter {
  if (filter.limit !== undefined && !(Number.isSafeInteger(filter.limit) && filter.limit > 0)) {
    throw new RangeError("list's limit must be a whole number above 0");
  }
  for (const matches of [filter.where, filter.not]) {
    for (const [path, value] of Object.entries(matches ?? {})) {
      if (path.split(".").some((part) => part === "") || !(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
        throw new RangeError("list's field predicates need a nonempty path and a JSON scalar");
      }
    }
  }
  if (filter.projection !== undefined && ![filter.projection, ...(filter.projection.older ?? [])].every(({ version }) => Number.isSafeInteger(version) && version > 0)) {
    throw new RangeError("list's projection version must be a whole number above 0");
  }
  return filter;
}

export function fieldAt(fields: Record<string, unknown>, path: string): unknown {
  let value: unknown = fields;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function projectedFields(projection: ListFilter["projection"], version: number): readonly string[] | undefined {
  if (projection === undefined) return undefined;
  if (projection.version === version) return projection.fields;
  return projection.older?.find((older) => older.version === version)?.fields;
}

export function pickFields(fields: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(fields, name)).map((name) => [name, fields[name]]));
}

export function listed(records: Iterable<RecordEnvelope>, type: string | readonly string[], given: ListFilter): RecordEnvelope[] {
  const filter = listFilter(given);
  return [...records]
    .filter((record) => (typeof type === "string" ? record.type === type : type.includes(record.type))
      && (filter.after === undefined || compareIds(record.id, filter.after) > 0)
      && (filter.phrase === undefined || Object.entries(record.fields).some(([key, value]) =>
        (filter.phrase!.fields === undefined || filter.phrase!.fields.includes(key))
        && typeof value === "string" && value.includes(filter.phrase!.text)))
      && (filter.ids === undefined || filter.ids.includes(record.id))
      && (filter.names === undefined || Object.values(record.fields).some((value) =>
        value === filter.names || (Array.isArray(value) && value.includes(filter.names))))
      && Object.entries(filter.where ?? {}).every(([path, value]) => fieldAt(record.fields, path) === value)
      && Object.entries(filter.not ?? {}).every(([path, value]) => fieldAt(record.fields, path) !== value))
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, filter.limit)
    .map((record) => {
      const kept = projectedFields(filter.projection, record.version);
      return kept === undefined ? record : { ...record, fields: pickFields(record.fields, kept) };
    });
}

function compareIds(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function saveAllInputs(inputs: readonly SaveInput[]): readonly SaveInput[] {
  const ids = new Set<string>();
  for (const input of inputs) {
    if (input.sequence !== undefined || input.onlyIfNew === true || input.sequenceNeverHeld === true) throw new RangeError(`saveAll takes no numbered or only-if-new record: ${input.id} is one`);
    if (ids.has(input.id)) throw new RangeError(`saveAll was given ${input.id} twice`);
    ids.add(input.id);
  }
  return inputs;
}

export function savedRecord(input: SaveInput, current: RecordEnvelope | undefined, at: string): RecordEnvelope {
  return {
    id: input.id,
    type: input.type,
    version: input.version ?? 1,
    fields: jsonCopy(input.fields),
    createdAt: current?.createdAt ?? at,
    updatedAt: at,
  };
}

export function editedRecord(
  stored: RecordEnvelope,
  fields: Record<string, unknown>,
  at: string,
  upgrade?: Upgrade,
): RecordEnvelope {
  const current = upgrade === undefined ? stored : upgrade(jsonCopy(stored));
  const merged = new Map(Object.entries(current.fields));
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) merged.delete(key);
    else merged.set(key, value);
  }
  return { ...current, fields: jsonCopy(Object.fromEntries(merged)), updatedAt: at };
}

export function revertInput(input: RevertInput): RevertInput {
  for (const [name, seq] of [["to", input.to], ["read", input.read]] as const) {
    if (!(Number.isSafeInteger(seq) && seq > 0)) throw new RangeError(`revert's ${name} is a history entry's seq, a whole number above 0, not ${String(seq)}`);
  }
  return input;
}

export function revertedRecord(
  input: RevertInput,
  target: Pick<HistoryEntry, "action" | "record"> | undefined,
  newest: number | undefined,
  current: RecordEnvelope | undefined,
  at: string,
): RecordEnvelope {
  if (target === undefined) throw new RangeError(`${input.id} has no history entry ${input.to}`);
  if (target.action === "retired") throw new RangeError(`entry ${input.to} is ${input.id}'s retirement, not a state to revert to; pick an entry before it`);
  if (newest !== input.read) throw new StaleRevertError(input.id, input.read, newest ?? 0);
  return restoredRecord(input.id, target.record, current, at, input.upgrade);
}

function restoredRecord(id: string, kept: RecordEnvelope, current: RecordEnvelope | undefined, at: string, upgrade: Upgrade | undefined): RecordEnvelope {
  const stored = jsonCopy(kept);
  const record = upgrade === undefined ? stored : upgrade(stored);
  return { ...record, id, createdAt: current?.createdAt ?? stored.createdAt, updatedAt: at };
}

export interface WrittenRecord {
  readonly id: string;
  readonly type: string;
  readonly before?: HistoryEntry;
  readonly own: readonly HistoryEntry[];
  readonly others: readonly HistoryEntry[];
}

export function writtenBy(of: string, entries: readonly HistoryEntry[]): WrittenRecord[] {
  const byRecord = new Map<string, HistoryEntry[]>();
  for (const entry of [...entries].sort((one, other) => one.seq - other.seq)) {
    if (entry.type === "health") continue;
    byRecord.set(entry.recordId, [...(byRecord.get(entry.recordId) ?? []), entry]);
  }
  const written: WrittenRecord[] = [];
  for (const [id, history] of byRecord) {
    const first = history.findIndex((entry) => entry.actor === of);
    if (first === -1) continue;
    const after = history.slice(first);
    written.push({
      id,
      type: history[first]!.type,
      ...(first === 0 ? {} : { before: history[first - 1]! }),
      own: after.filter((entry) => entry.actor === of),
      others: after.filter((entry) => entry.actor !== of),
    });
  }
  return written.sort((one, other) => compareCodePoints(one.id, other.id));
}

export interface RevertWrite {
  readonly reverted: RevertedWrite;
  readonly record: RecordEnvelope;
  readonly reason: string;
}

export function writesReverted(
  input: RevertWritesInput,
  written: readonly WrittenRecord[],
  current: (id: string) => RecordEnvelope | undefined,
  at: string,
): RevertWrite[] {
  const later = written.filter((one) => one.others.length > 0).map(({ id, others: [first] }) => ({ id, seq: first!.seq, ...(first!.actor === undefined ? {} : { actor: first!.actor }) }));
  if (later.length > 0) throw new LaterWriterError(input.of, later);
  const why = input.reason === undefined ? "" : `: ${input.reason}`;
  return written.flatMap(({ id, before }): RevertWrite[] => {
    const live = current(id);
    if (before === undefined || before.action === "retired") {
      return live === undefined ? [] : [{ reverted: { id, action: "retired" }, record: live, reason: `reverted ${input.of}'s writes, which created it${why}` }];
    }
    const record = restoredRecord(id, before.record, live, at, input.upgrade);
    check(record, input.validate);
    return [{ reverted: { id, action: "updated", to: before.seq }, record, reason: `reverted ${input.of}'s writes, to ${before.seq}${why}` }];
  });
}

function compareCodePoints(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function revertReason(input: RevertInput): string {
  return `reverted to ${input.to}${input.reason === undefined ? "" : `: ${input.reason}`}`;
}

export function check(record: RecordEnvelope, validate: Validate | undefined): void {
  validate?.(jsonCopy(record));
}

export function historyEntry(entry: {
  seq: number;
  recordId: string;
  type: string;
  action: HistoryEntry["action"];
  record: RecordEnvelope;
  reason: string | null | undefined;
  actor: string | null | undefined;
  outsideRead?: readonly string[] | null | undefined;
  at: string;
  recordedBy?: string | null | undefined;
}): HistoryEntry {
  const { reason, actor, outsideRead, recordedBy, ...rest } = entry;
  return {
    ...rest,
    ...(reason === null || reason === undefined ? {} : { reason }),
    ...(actor === null || actor === undefined ? {} : { actor }),
    ...(outsideRead === null || outsideRead === undefined || outsideRead.length === 0 ? {} : { outsideRead: [...outsideRead] }),
    ...(recordedBy === null || recordedBy === undefined ? {} : { recordedBy }),
  };
}

export function outsideReadOf(outsideRead: OutsideRead | undefined, type: string): string[] | undefined {
  const read = outsideRead?.(type);
  return read === undefined || read.length === 0 ? undefined : [...read];
}

export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class NumberTakenError extends Error {
  readonly type: string;
  readonly field: string;
  readonly number: number;

  constructor(type: string, field: string, number: number) {
    super(`${type} number ${number} is taken: a record has held it in field ${JSON.stringify(field)}, and a number is never used twice`);
    this.name = "NumberTakenError";
    this.type = type;
    this.field = field;
    this.number = number;
  }
}

export function numbered(input: SaveInput, highest: number, taken: (number: number) => boolean): SaveInput {
  const field = input.sequence;
  if (field === undefined) return input;
  const given = input.fields[field];
  if (given === undefined) return { ...input, fields: { ...input.fields, [field]: Math.max(highest, input.sequenceFloor ?? 0) + 1 } };
  if (typeof given === "number" && taken(given)) throw new NumberTakenError(input.type, field, given);
  return input;
}

export class StaleRevertError extends Error {
  readonly id: string;
  readonly read: number;
  readonly newest: number;

  constructor(id: string, read: number, newest: number) {
    super(`${id} changed since it was read: its newest history entry is ${newest}, not ${read}. Read its history again before reverting it`);
    this.name = "StaleRevertError";
    this.id = id;
    this.read = read;
    this.newest = newest;
  }
}

export interface LaterWrite {
  readonly id: string;
  readonly seq: number;
  readonly actor?: string;
}

export class LaterWriterError extends Error {
  readonly of: string;
  readonly records: readonly LaterWrite[];

  constructor(of: string, records: readonly LaterWrite[]) {
    const named = records.map((one) => `${one.id} (entry ${one.seq}, by ${one.actor ?? "a writer who gave no name"})`);
    super(`another writer has written to ${records.length === 1 ? "a record" : `${records.length} records`} ${of} wrote, so nothing was reverted: ${named.join(", ")}. Revert ${records.length === 1 ? "it" : "each"} by hand (library revert), or leave ${of}'s writes standing`);
    this.name = "LaterWriterError";
    this.of = of;
    this.records = records;
  }
}
