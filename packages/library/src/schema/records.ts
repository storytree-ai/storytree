/**
 * Capability 3 · Data schema. SchemaRecords: capability 3's typed layer over any Transactions (capability 2), so it runs
 * unchanged on the in-memory twin and on Postgres.
 *
 * - Every write is checked INSIDE the write, as the transactions' validate hook, on the record the
 *   write would leave (for an edit, the merged fields). A refused write writes nothing.
 * - A record written on an older schema version of its type is read upgraded: the schema's upgrade
 *   steps are applied in order, up to the current version. An edit of one merges onto the upgraded
 *   fields and stores it on the current version, in place, in the same all-or-nothing write.
 * - A record this code cannot interpret is refused, never guessed at: one whose type it does not
 *   know, whose schema version is newer than it knows for that type, or whose older version no
 *   upgrade step leads on from.
 * - What comes back is capability 2's envelope, with its version and fields as upgraded.
 */
import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { HistoryEntry, HistoryFilter, ListFilter, RecordEnvelope, Transactions } from "../transactions/types.js";
import { pickFields } from "../transactions/records.js";
import { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
import type { FieldsOf, LibrarySchema, RecordType } from "./types.js";
import { LIBRARY_SCHEMA } from "./upgrades.js";

/** A stored record of type `T`: capability 2's envelope, unchanged, with its type and fields typed. */
export type SchemaRecord<T extends RecordType = RecordType> = {
  [K in T]: Omit<RecordEnvelope, "type" | "fields"> & { type: K; fields: FieldsOf<K> };
}[T];

/** An edit: some of one type's fields. A field set to undefined is removed. */
export type FieldEdit = {
  [K in RecordType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[RecordType];

export interface CreateOptions extends WriteOptions {
  /** The new record's id. When omitted, one is generated: `<type>_<12 lowercase hex digits>`. */
  readonly id?: string;
  /** A field the record is numbered in, within its type: capability 2's save `sequence`. */
  readonly sequence?: string;
  readonly sequenceFloor?: number;
  readonly sequenceNeverHeld?: boolean;
  readonly onlyIfNew?: boolean;
}

export interface WriteOptions {
  /** Who is writing, kept in the history. */
  readonly actor?: string;
  /** Abort a write still waiting to start; once it has the write lock, it completes normally. */
  readonly signal?: AbortSignal;
}

export class SchemaRecords {
  readonly #transactions: Transactions;
  readonly #schema: LibrarySchema;

  /** `schema` is the library's own, unless a test gives a later one. */
  constructor(transactions: Transactions, schema: LibrarySchema = LIBRARY_SCHEMA) {
    this.#transactions = transactions;
    this.#schema = schema;
  }

  /**
   * Save a new record of `type`, stamped with the type's schema version, under `options.id` or a
   * generated id. (An existing record with that id is replaced whole, as capability 2's save does.)
   * An unknown type is refused (UnknownTypeError), and so are fields that do not fit the type
   * (SchemaError); either way nothing is written.
   */
  async create<T extends RecordType>(type: T, fields: FieldsOf<T>, options: CreateOptions = {}): Promise<SchemaRecord<T>> {
    if (!this.#isRecordType(type)) throw new UnknownTypeError(type);
    const record = await this.#transactions.save({
      id: options.id ?? newId(type),
      type,
      fields,
      version: this.#version(type),
      validate: this.#check,
      ...writeOptionsOf(options),
      ...(options.sequence === undefined ? {} : { sequence: options.sequence }),
      ...(options.sequenceFloor === undefined ? {} : { sequenceFloor: options.sequenceFloor }),
      ...(options.sequenceNeverHeld === undefined ? {} : { sequenceNeverHeld: options.sequenceNeverHeld }),
      ...(options.onlyIfNew === undefined ? {} : { onlyIfNew: options.onlyIfNew }),
    });
    return record as SchemaRecord<T>;
  }

  /** The record, upgraded, or null if it is missing or retired. One this code cannot interpret is refused. */
  async get(id: string): Promise<SchemaRecord | null> {
    const record = await this.#transactions.get(id);
    return record === null ? null : this.current(record);
  }

  /**
   * The current records of `type`, upgraded, ordered by id. An unknown type is refused, and so is
   * the whole list if any record in it cannot be interpreted.
   */
  async list<T extends RecordType>(type: T | readonly T[], filter?: Omit<ListFilter, "projection">): Promise<SchemaRecord<T>[]> {
    for (const kind of typeof type === "string" ? [type] : type) {
      if (!this.#isRecordType(kind)) throw new UnknownTypeError(kind);
    }
    const records = await this.#transactions.list(type, filter);
    return records.map((record) => this.current(record) as SchemaRecord<T>);
  }

  /**
   * A field selection, never a whole SchemaRecord. Current-version rows project on the server;
   * older rows arrive whole, upgrade, then project, so no upgrade loses an input it needs.
   * Filters, like list's, compare stored fields, before any upgrade.
   */
  async select<T extends RecordType, K extends keyof FieldsOf<T> & string>(
    type: T, fields: readonly K[], filter: Omit<ListFilter, "projection"> = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<FieldsOf<T>, K> })[]> {
    if (!this.#isRecordType(type)) throw new UnknownTypeError(type);
    const records = await this.#transactions.list(type, { ...filter, projection: { version: this.#version(type), fields } });
    return records.map((record) => {
      const current = this.current(record) as SchemaRecord<T>;
      return { ...current, fields: pickFields(current.fields, fields) as Pick<FieldsOf<T>, K> };
    });
  }

  /**
   * Change only the named fields, merged onto what is stored now (capability 2's edit), upgraded
   * first if it was written on an older version, so the record is stored on the current one. The
   * merged record is checked inside the write, so an edit that would leave it invalid, or that
   * touches a record this code cannot interpret, is refused and writes nothing. Null if the record
   * is missing or retired.
   */
  async edit(id: string, fields: FieldEdit, options: WriteOptions & { sequence?: string; sequenceNeverHeld?: boolean; reason?: string; checkCurrent?: (record: SchemaRecord) => void } = {}): Promise<SchemaRecord | null> {
    const record = await this.#transactions.edit({
      id,
      fields,
      upgrade: (stored) => {
        const current = this.current(stored);
        options.checkCurrent?.(current);
        return current;
      },
      ...(options.sequence === undefined ? {} : { sequence: options.sequence }),
      ...(options.sequenceNeverHeld === undefined ? {} : { sequenceNeverHeld: options.sequenceNeverHeld }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      validate: this.#check,
      ...writeOptionsOf(options),
    });
    return record as SchemaRecord | null;
  }

  /** Retire the record, keeping the reason in its history: capability 2's retire, unchanged. */
  async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    await this.#transactions.retire({ id, reason, ...writeOptionsOf(options) });
  }

  /** The history, oldest first: capability 2's history, unchanged, each record as it was written. */
  async history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return this.#transactions.history(filter);
  }

  /**
   * `record` as this code reads it: upgraded one step at a time, from the version it was written on
   * to the current version of its type. A record whose type is not declared, whose version is newer
   * than the current one, or whose older version no step leads on from, is refused. (A reader of
   * the history, which keeps each record as it was written, reads its records through this.)
   */
  readonly current = (record: RecordEnvelope): SchemaRecord => {
    const { id, type } = record;
    if (!this.#isRecordType(type)) throw new UnknownTypeError(type, id);
    const known = this.#version(type);
    if (record.version > known) throw new NewerSchemaError(id, type, record.version, known);
    let { version, fields } = record;
    while (version < known) {
      const from = version;
      const step = this.#schema.upgrades.find((candidate) => candidate.type === type && candidate.from === from);
      if (step === undefined) throw new MissingUpgradeError(id, type, from, known);
      fields = step.up(fields);
      version = from + 1;
    }
    return (version === record.version ? record : { ...record, version, fields }) as SchemaRecord;
  };

  /**
   * The validate hook of every write. The record the write would leave, after any upgrade and
   * merge, must be one this code can interpret, and its fields must fit its type. A throw aborts
   * the write.
   */
  readonly #check = (candidate: RecordEnvelope): void => {
    const { type, fields } = this.current(candidate);
    const problems = [...this.#shapeProblems(type, fields), ...unstorableText(fields)];
    if (problems.length > 0) throw new SchemaError(type, problems);
  };

  /** How the fields break their type's schema, each problem naming its field. */
  #shapeProblems(type: RecordType, fields: unknown): FieldProblem[] {
    const result = this.#schema.schemas[type]!.safeParse(fields);
    return result.success ? [] : result.error.issues.flatMap((issue) => describeIssue(issue, fields));
  }

  /** Whether `type` is a declared record type. Only the schema's own keys count, never inherited names. */
  #isRecordType(type: string): type is RecordType {
    return Object.hasOwn(this.#schema.versions, type);
  }

  /** The current version of a declared type. */
  #version(type: RecordType): number {
    return this.#schema.versions[type]!;
  }
}

/** A new id for a record of `type`: `<type>_` and 12 lowercase hex digits, all of them random. */
function newId(type: RecordType): string {
  return `${type}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Carry attribution and cancellation to capability 2 without passing other caller options. */
function writeOptionsOf(options: WriteOptions): WriteOptions {
  return {
    ...(options.actor === undefined ? {} : { actor: options.actor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

function describeIssue(issue: z.core.$ZodIssue, fields: unknown): FieldProblem[] {
  const [head, ...rest] = issue.path;
  if (head === undefined) {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({ field: key, problem: `unknown field ${quote(key)}` }));
    }
    return [{ field: undefined, problem: `the fields must be an object, not ${kindOf(fields)}` }];
  }
  const field = String(head);
  // A rule across fields (a re-steer's "a defect needs a mode") says in its own words what is wrong.
  if (issue.code === "custom") return [{ field, problem: issue.message }];
  if (rest.length === 0 && !hasOwnField(fields, field)) {
    return [{ field, problem: `missing required field ${quote(field)}` }];
  }
  const where = [`field ${quote(field)}`, ...rest.map((key) => `item ${String(key)}`)].join(" ");
  switch (issue.code) {
    case "invalid_type": {
      const given = valueAt(fields, issue.path);
      const problem = `${where} must be ${kindName(issue.expected)}, not ${kindOf(given)}`;
      return [rest.length === 0 && issue.expected === "array" && typeof given === "string" ? { field, problem, textForList: true } : { field, problem }];
    }
    case "too_small":
      if (issue.origin === "string" && Number(issue.minimum) === 1) return [{ field, problem: `${where} must not be empty` }];
      break;
    case "invalid_value":
      return [{ field, problem: `${where} must be one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}` }];
  }
  return [{ field, problem: `${where} is not valid: ${issue.message}` }];
}

/**
 * Text Postgres cannot store, anywhere in the fields' values, lists included: a NUL character, or a
 * lone UTF-16 surrogate. The in-memory twin could store both, so refusing them here, before either
 * backend sees them, keeps the two alike.
 */
function unstorableText(fields: unknown): FieldProblem[] {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields).flatMap(([field, value]) =>
    textsIn(value, `field ${quote(field)}`).flatMap(([where, text]) => {
      const found = unstorable(text);
      return found === undefined ? [] : [{ field, problem: `${where} contains ${found}, which the library cannot store` }];
    }),
  );
}

/** Every string in `value` (itself, or anywhere inside its lists and objects), with where it sits. */
function textsIn(value: unknown, where: string): [where: string, text: string][] {
  if (typeof value === "string") return [[where, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => textsIn(item, `${where} item ${index}`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => textsIn(item, `${where} key ${quote(key)}`));
  }
  return [];
}

/** A high surrogate with no low one after it, or a low surrogate with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** What in `text` cannot be stored, or undefined if it all can. (Capabilities 4 and 6 reuse it for ids.) */
export function unstorable(text: string): string | undefined {
  if (text.includes("\u0000")) return "a NUL character (U+0000)";
  const lone = LONE_SURROGATE.exec(text)?.[0];
  return lone === undefined ? undefined : `a lone UTF-16 surrogate (U+${lone.charCodeAt(0).toString(16).toUpperCase()})`;
}

function hasOwnField(fields: unknown, field: string): boolean {
  return typeof fields === "object" && fields !== null && Object.hasOwn(fields, field);
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** What a zod `expected` kind is called in a message. */
function kindName(expected: string): string {
  if (expected === "array") return "a list";
  if (expected === "object") return "an object";
  return `a ${expected}`;
}

/** What kind of value `value` is, as a message says it. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

function quote(name: string): string {
  return JSON.stringify(name);
}
