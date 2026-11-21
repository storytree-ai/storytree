// Capability 7 · Library API
import { unstorable, type RecordType, type SchemaRecord, type SchemaRecords } from "./schema/index.js";

export class MissingReferenceError extends Error {
  readonly field: string;
  readonly id: string;
  readonly expected: string;
  readonly found: string | undefined;

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

export class DependencyLoopError extends Error {
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

export type Expected =
  | RecordType
  | "record"
  | { readonly name: string; readonly types: readonly RecordType[]; readonly why?: string };

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

export async function checkReferences(
  records: SchemaRecords,
  field: string,
  values: unknown,
  expected: Expected,
): Promise<void> {
  if (!Array.isArray(values)) return;
  for (const value of values) await checkReference(records, field, value, expected);
}

export async function liveRecord<T extends RecordType>(
  records: SchemaRecords,
  id: unknown,
  types: readonly T[],
): Promise<SchemaRecord<T> | null> {
  const record = await recordNamed(records, id);
  return record !== null && (types as readonly RecordType[]).includes(record.type) ? (record as SchemaRecord<T>) : null;
}

export async function recordNamed(records: SchemaRecords, id: unknown): Promise<SchemaRecord | null> {
  return couldBeId(id) ? records.get(id) : null;
}

export function couldBeId(value: unknown): value is string {
  return typeof value === "string" && unstorable(value) === undefined;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
