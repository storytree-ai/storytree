/**
 * What a write stores, worked out by one piece of code for both backends so that they agree
 * exactly: the record a save or an edit would leave, the check on it, and the shape of a history
 * entry. Each backend only decides where these go and how a write stays atomic.
 */
import type { HistoryEntry, HistoryFilter, RecordEnvelope, SaveInput, Upgrade, Validate } from "./types.js";

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
  at: string;
}): HistoryEntry {
  const { reason, actor, ...rest } = entry;
  return {
    ...rest,
    ...(reason === null || reason === undefined ? {} : { reason }),
    ...(actor === null || actor === undefined ? {} : { actor }),
  };
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
