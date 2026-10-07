/**
 * Capability 4 · Work model. References between records (capabilities 4, 5, 6 and 9): a capability names its story, a
 * contract its capability, an arc the stories it grows, a capability the capabilities it depends
 * on, a health entry its contract, a note the notes it links to, and a decision the story or
 * capability it is a front cover of. A write whose references are broken is refused, and writes
 * nothing: the checks here run before the write, and throw.
 */
import { unstorable, type SchemaRecord, type SchemaRecords } from "./schema/records.js";
import type { RecordType } from "./schema/types.js";

/**
 * A reference that names no record it may name: the record is missing, retired, or of the wrong
 * type. The message names the field and the id:
 * `field "story" names "story_0123456789ab": there is no story with that id (it is missing or retired)`.
 */
export class MissingReferenceError extends Error {
  /** The field holding the reference: `story`, `capability`, `stories`, `dependsOn`, `node`, `links` or `frontCoverOf`. */
  readonly field: string;
  /** The id that names no suitable record. */
  readonly id: string;
  /**
   * What the reference must name: a record type, `record` when any type will do, or the name of
   * the types it may name (`note`, `story or capability`).
   */
  readonly expected: string;
  /** The type of the record the id does name, when that record is of the wrong type. */
  readonly found: string | undefined;

  /** `why`, when given, ends the message in brackets: why the reference may not name what it does. */
  constructor(field: string, id: string, expected: string, found?: string, why?: string) {
    const named = `field ${JSON.stringify(field)} names ${JSON.stringify(id)}`;
    const problem =
      found === undefined
        ? `there is no ${expected} with that id (it is missing or retired)`
        : `that is ${article(found)} ${found} record, not ${article(expected)} ${expected}`;
    super(`${named}: ${problem}${why === undefined ? "" : ` (${why})`}`);
    this.name = "MissingReferenceError";
    this.field = field;
    this.id = id;
    this.expected = expected;
    this.found = found;
  }
}

/**
 * A write would make a capability depend on itself, directly or through others. The message names
 * the loop, from the capability being written back round to itself: `A → B → A`.
 */
export class DependencyLoopError extends Error {
  /** The capability ids around the loop, starting and ending with the capability being written. */
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(
      `dependency loop between capabilities: ${path.join(" → ")} ` +
        "(a capability may not depend on itself, directly or through others)",
    );
    this.name = "DependencyLoopError";
    this.path = [...path];
  }
}

/**
 * What a reference may name: one record type; any type at all (`record`); or any of several types
 * under one name for them, such as `note` for a memory, a decision or a definition, with `why`
 * saying why no other type will do.
 */
export type Expected =
  | RecordType
  | "record"
  | { readonly name: string; readonly types: readonly RecordType[]; readonly why?: string };

/**
 * Check that `value`, the reference held in `field`, names a live (stored, not retired) record
 * that `expected` allows. Throws MissingReferenceError when it does not.
 *
 * Only an id that could name a record is looked up. Anything else (undefined because the field is
 * absent, a value that is not a string, or text the library cannot store, which Postgres will not
 * even be asked about) is left to the schema check inside the write, which refuses whatever needs
 * refusing with a SchemaError naming the field, the same on both backends.
 */
export async function checkReference(
  records: SchemaRecords,
  field: string,
  value: unknown,
  expected: Expected,
): Promise<void> {
  if (!couldBeId(value)) return;
  const target = await records.get(value);
  if (typeof expected !== "string") {
    if (target === null) throw new MissingReferenceError(field, value, expected.name);
    if (!expected.types.includes(target.type)) {
      throw new MissingReferenceError(field, value, expected.name, target.type, expected.why);
    }
    return;
  }
  if (target === null) throw new MissingReferenceError(field, value, expected);
  if (expected !== "record" && target.type !== expected) {
    throw new MissingReferenceError(field, value, expected, target.type);
  }
}

/**
 * checkReference for every id in a list field, in list order, so the first broken reference is
 * the one reported. A value that is not a list is left to the schema check inside the write.
 */
export async function checkReferences(
  records: SchemaRecords,
  field: string,
  values: unknown,
  expected: Expected,
): Promise<void> {
  if (!Array.isArray(values)) return;
  for (const value of values) await checkReference(records, field, value, expected);
}

/** The live record `id` if its type is one of `types`, and null otherwise (missing, retired, or another type). */
export async function liveRecord<T extends RecordType>(
  records: SchemaRecords,
  id: unknown,
  types: readonly T[],
): Promise<SchemaRecord<T> | null> {
  const record = await recordNamed(records, id);
  return record !== null && (types as readonly RecordType[]).includes(record.type) ? (record as SchemaRecord<T>) : null;
}

/**
 * The live record `id` names, whatever its type, or null if it names none: it is missing or
 * retired, or it is not an id the library could store, which is never looked up.
 */
export async function recordNamed(records: SchemaRecords, id: unknown): Promise<SchemaRecord | null> {
  return couldBeId(id) ? records.get(id) : null;
}

/** Whether `value` could be the id of a stored record: a string of text the library can store. */
export function couldBeId(value: unknown): value is string {
  return typeof value === "string" && unstorable(value) === undefined;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
