/**
 * Capability 2 · Library transactions. What a write stores, worked out by one piece of code for both backends so that they agree
 * exactly: the record a save or an edit would leave, the check on it, and the shape of a history
 * entry. Each backend only decides where these go and how a write stays atomic.
 */
import type { HistoryEntry, HistoryFilter, ListFilter, OutsideRead, RecordEnvelope, RevertedWrite, RevertInput, RevertWritesInput, SaveInput, Upgrade, Validate } from "./types.js";

/** The time now, as records carry it: an ISO 8601 UTC timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/**
 * `filter` as both backends apply it: its time as records carry one (UTC, to the millisecond), so
 * that a comparison means the same in each. A malformed filter is refused before anything is read.
 */
export function historyFilter(filter: HistoryFilter): HistoryFilter {
  const { from, oldest, newest } = filter;
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

/** Refuse malformed list filters the same way on both backends, before a read. */
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
  if (filter.projection !== undefined && !(Number.isSafeInteger(filter.projection.version) && filter.projection.version > 0)) {
    throw new RangeError("list's projection version must be a whole number above 0");
  }
  return filter;
}

/** A stored JSON field path; inherited object properties are never fields. */
export function fieldAt(fields: Record<string, unknown>, path: string): unknown {
  let value: unknown = fields;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Pick top-level fields, keeping an absent field absent (and a present null present). */
export function pickFields(fields: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(fields, name)).map((name) => [name, fields[name]]));
}

/** The record `save` would store, given the record stored now (if any). */
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

/**
 * The record `edit` would store: `fields` merged shallowly onto the stored fields (after the
 * writer's upgrade, if any), a key whose value is undefined being removed. Everything else about
 * the record stays as stored, or as the upgrade left it.
 */
export function editedRecord(
  stored: RecordEnvelope,
  fields: Record<string, unknown>,
  at: string,
  upgrade?: Upgrade,
): RecordEnvelope {
  const current = upgrade === undefined ? stored : upgrade(jsonCopy(stored));
  // A Map rather than assignment into an object, so a field named "__proto__" is kept as a field.
  const merged = new Map(Object.entries(current.fields));
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) merged.delete(key);
    else merged.set(key, value);
  }
  return { ...current, fields: jsonCopy(Object.fromEntries(merged)), updatedAt: at };
}

/** Refuse a revert whose entry numbers are not history's, the same way on both backends, before a read. */
export function revertInput(input: RevertInput): RevertInput {
  for (const [name, seq] of [["to", input.to], ["read", input.read]] as const) {
    if (!(Number.isSafeInteger(seq) && seq > 0)) throw new RangeError(`revert's ${name} is a history entry's seq, a whole number above 0, not ${String(seq)}`);
  }
  return input;
}

/**
 * The record a revert writes back: `target`, the record's own entry numbered `input.to` (if it has one), as it was
 * stored, upgraded by the writer, created when the record now live (or else the entry's record) was. Refused as
 * RevertInput says: no such entry of the record's, a retirement, or `newest`, its newest entry, not the one read.
 */
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

/** `kept`, a record as a history entry stored it, upgraded by the writer, to be written back under `id` at `at`. */
function restoredRecord(id: string, kept: RecordEnvelope, current: RecordEnvelope | undefined, at: string, upgrade: Upgrade | undefined): RecordEnvelope {
  const stored = jsonCopy(kept);
  const record = upgrade === undefined ? stored : upgrade(stored);
  return { ...record, id, createdAt: current?.createdAt ?? stored.createdAt, updatedAt: at };
}

/** One record a writer wrote, as its history shows it. */
export interface WrittenRecord {
  readonly id: string;
  readonly type: string;
  /** Its newest entry before the writer's first write to it; none when the writer's first write made it. */
  readonly before?: HistoryEntry;
  /** The writer's own entries on it, oldest first. */
  readonly own: readonly HistoryEntry[];
  /** Entries other writers made to it after the writer's first, oldest first. */
  readonly others: readonly HistoryEntry[];
}

/**
 * Every record `of` wrote, health left out, by id, from `entries`: the history of those records (it may hold others,
 * and comes in any order). What both backends revert and what a per-writer diff reads.
 */
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

/** One record's part of a revert of a writer's writes: what it reports, the record its entry keeps, and the entry's reason. */
export interface RevertWrite {
  readonly reverted: RevertedWrite;
  readonly record: RecordEnvelope;
  readonly reason: string;
}

/** What a revert of `input.of`'s writes does to each record, refused (LaterWriterError) where another writer wrote since. */
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

/** Code-point order, which is UTF-8 byte order and Postgres's C collation: how ids are ordered everywhere. */
function compareCodePoints(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** The reason a revert's history entry carries: the entry it reverts to, then the writer's own reason. */
export function revertReason(input: RevertInput): string {
  return `reverted to ${input.to}${input.reason === undefined ? "" : `: ${input.reason}`}`;
}

/** Run the writer's check on a copy of the would-be record. If it throws, the write aborts. */
export function check(record: RecordEnvelope, validate: Validate | undefined): void {
  validate?.(jsonCopy(record));
}

/** A history entry. `reason` and `actor` are present only when there is one. */
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
}): HistoryEntry {
  const { reason, actor, outsideRead, ...rest } = entry;
  return {
    ...rest,
    ...(reason === null || reason === undefined ? {} : { reason }),
    ...(actor === null || actor === undefined ? {} : { actor }),
    ...(outsideRead === null || outsideRead === undefined || outsideRead.length === 0 ? {} : { outsideRead: [...outsideRead] }),
  };
}

/** What the writer's `outsideRead` names for a record of `type`: the mark its history entry keeps, or undefined for none. */
export function outsideReadOf(outsideRead: OutsideRead | undefined, type: string): string[] | undefined {
  const read = outsideRead?.(type);
  return read === undefined || read.length === 0 ? undefined : [...read];
}

/**
 * A deep copy through JSON, which is what a Postgres jsonb column hands back: a Date comes back as
 * its ISO string, undefined inside an array as null, and a key whose value is undefined not at
 * all. Every record is normalised this way before it is checked or stored, on both backends.
 */
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A save gave its record a number that another record of its type has held, now or before it was
 * retired: a number is never used twice.
 */
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

/**
 * The save `input` numbered, for a save with a `sequence` field: the fields with that field stamped
 * one past `highest` when they leave it out. A number they give that `taken` says another record
 * has held is refused. (One that is not a number is left for the writer's check to refuse.)
 */
export function numbered(input: SaveInput, highest: number, taken: (number: number) => boolean): SaveInput {
  const field = input.sequence;
  if (field === undefined) return input;
  const given = input.fields[field];
  if (given === undefined) return { ...input, fields: { ...input.fields, [field]: Math.max(highest, input.sequenceFloor ?? 0) + 1 } };
  if (typeof given === "number" && taken(given)) throw new NumberTakenError(input.type, field, given);
  return input;
}

/** A revert whose writer read the record before its newest change: another writer's work would be overwritten. */
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

/** A record one writer wrote, and the first entry another writer made to it after that writer's first. */
export interface LaterWrite {
  readonly id: string;
  readonly seq: number;
  readonly actor?: string;
}

/** A revert of one writer's writes where another writer has written to a record since: theirs would be lost too. */
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
