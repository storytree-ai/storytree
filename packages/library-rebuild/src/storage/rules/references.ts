// Capability 4 · Work model
import type { SchemaRecord, SchemaRecords } from "./records.js";
import { unstorable } from "./records.js";
import type { RecordType } from "./schema.js";

export class MissingReferenceError extends Error {
  override readonly name = "MissingReferenceError";
  readonly field: string;
  readonly id: string;
  readonly expected: string;
  readonly found: string | undefined;

  constructor(field: string, id: string, expected: string, found?: string, why?: string) {
    const is = found === undefined ? `no live ${expected} has that id` : `that is a ${found}, not a ${expected}`;
    super(`${JSON.stringify(field)} names ${JSON.stringify(id)}, but ${is}${why === undefined ? "" : `: ${why}`}`);
    this.field = field;
    this.id = id;
    this.expected = expected;
    this.found = found;
  }
}

export class DependencyLoopError extends Error {
  override readonly name = "DependencyLoopError";
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`a dependency loop is refused: ${path.join(" → ")}`);
    this.path = path;
  }
}

export async function liveRecord(records: SchemaRecords, id: string): Promise<SchemaRecord | null> {
  if (unstorable(id) !== undefined) return null;
  return await records.get(id);
}

export async function liveOf<T extends RecordType>(records: SchemaRecords, type: T, id: string): Promise<SchemaRecord<T> | null> {
  const record = await liveRecord(records, id);
  return record?.type === type ? (record as SchemaRecord<T>) : null;
}

export async function referTo<T extends RecordType>(records: SchemaRecords, field: string, id: string, expected: T): Promise<SchemaRecord<T>> {
  const record = await liveRecord(records, id);
  if (record?.type === expected) return record as SchemaRecord<T>;
  throw new MissingReferenceError(field, id, expected, record?.type);
}

export function findLoop(start: string, next: readonly string[], dependsOn: (id: string) => readonly string[]): string[] | undefined {
  const seen = new Set<string>();
  const walk = (id: string, path: readonly string[]): string[] | undefined => {
    if (id === start) return [...path, id];
    if (seen.has(id)) return undefined;
    seen.add(id);
    for (const step of dependsOn(id)) {
      const loop = walk(step, [...path, id]);
      if (loop !== undefined) return loop;
    }
    return undefined;
  };
  for (const id of next) {
    const loop = walk(id, [start]);
    if (loop !== undefined) return loop;
  }
  return undefined;
}
