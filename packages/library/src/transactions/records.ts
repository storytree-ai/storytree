/**
 * What a write stores, worked out by one piece of code for both backends so that they agree
 * exactly: the record a save or an edit would leave, the check on it, and the shape of a history
 * entry. Each backend only decides where these go and how a write stays atomic.
 */
import type { HistoryEntry, RecordEnvelope, SaveInput, Upgrade, Validate } from "./types.js";

/** The time now, as records carry it: an ISO 8601 UTC timestamp. */
export function now(): string {
  return new Date().toISOString();
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

/** A stub for the red run of capability 13. */
export class NumberTakenError extends Error {}
