// Capability 3 · Data schema
import { randomUUID } from "node:crypto";

import type { z } from "zod";

import { pickFields, writtenBy, type HistoryEntry, type HistoryFilter, type ListFilter, type OutsideRead, type RecordEnvelope, type RevertedWrite, type Transactions } from "../transactions/index.js";
import { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
import type { FieldsOf, LibrarySchema, RecordType } from "./types.js";
import { isPluginKind } from "./plugin-kinds.js";
import { LIBRARY_SCHEMA } from "./upgrades.js";

export type SchemaRecord<T extends RecordType = RecordType> = {
  [K in T]: Omit<RecordEnvelope, "type" | "fields"> & { type: K; fields: FieldsOf<K>; dormant?: true };
}[T];

export type FieldEdit = {
  [K in RecordType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[RecordType];

export interface CreateOptions extends WriteOptions {
  readonly id?: string;
  readonly sequence?: string;
  readonly sequenceFloor?: number;
  readonly sequenceNeverHeld?: boolean;
  readonly onlyIfNew?: boolean;
}

export interface WriteOptions {
  readonly actor?: string;
  readonly signal?: AbortSignal;
  readonly outsideRead?: () => Promise<readonly string[]>;
}

export const MARKED_BY_OUTSIDE_READ: readonly string[] = ["principle", "guardrail", "pattern", "process", "agent", "decision"];

export interface WriterChange {
  readonly id: string;
  readonly type: string;
  readonly writes: number;
  readonly before: SchemaRecord | null;
  readonly after: SchemaRecord | null;
  readonly retired?: string;
  readonly later?: { readonly seq: number; readonly actor?: string };
}

export class SchemaRecords {
  readonly #transactions: Transactions;
  readonly #schema: LibrarySchema;

  constructor(transactions: Transactions, schema: LibrarySchema = LIBRARY_SCHEMA) {
    this.#transactions = transactions;
    this.#schema = schema;
  }

  async create<T extends RecordType>(type: T, fields: FieldsOf<T>, options: CreateOptions = {}): Promise<SchemaRecord<T>> {
    if (!this.#isRecordType(type)) throw new UnknownTypeError(type);
    const record = await this.#transactions.save({
      id: options.id ?? newId(type),
      type,
      fields,
      version: this.#version(type),
      validate: this.#check,
      ...writeOptionsOf(options),
      ...(await outsideReadFor(options, type)),
      ...(options.sequence === undefined ? {} : { sequence: options.sequence }),
      ...(options.sequenceFloor === undefined ? {} : { sequenceFloor: options.sequenceFloor }),
      ...(options.sequenceNeverHeld === undefined ? {} : { sequenceNeverHeld: options.sequenceNeverHeld }),
      ...(options.onlyIfNew === undefined ? {} : { onlyIfNew: options.onlyIfNew }),
    });
    return record as SchemaRecord<T>;
  }

  async createAll<T extends RecordType>(records: readonly { type: T; fields: FieldsOf<T>; options?: Omit<CreateOptions, "sequence" | "sequenceFloor" | "sequenceNeverHeld" | "onlyIfNew" | "signal"> }[], signal?: AbortSignal): Promise<SchemaRecord<T>[]> {
    const inputs = [];
    for (const { type, fields, options = {} } of records) {
      if (!this.#isRecordType(type)) throw new UnknownTypeError(type);
      inputs.push({ id: options.id ?? newId(type), type, fields, version: this.#version(type), validate: this.#check, ...writeOptionsOf(options), ...(await outsideReadFor(options, type)) });
    }
    return (await this.#transactions.saveAll(inputs, signal)) as SchemaRecord<T>[];
  }

  async get(id: string): Promise<SchemaRecord | null> {
    const record = await this.#transactions.get(id);
    return record === null ? null : this.current(record);
  }

  async list<T extends RecordType>(type: T | readonly T[], filter?: Omit<ListFilter, "projection">): Promise<SchemaRecord<T>[]> {
    const kinds = (typeof type === "string" ? [type] : type).filter((kind) => !this.isDormant(kind));
    for (const kind of kinds) {
      if (!this.#isRecordType(kind)) throw new UnknownTypeError(kind);
    }
    if (kinds.length === 0) return [];
    const records = await this.#transactions.list(typeof type === "string" ? kinds[0]! : kinds, filter);
    return records.map((record) => this.current(record) as SchemaRecord<T>);
  }

  async select<T extends RecordType, K extends keyof FieldsOf<T> & string>(
    type: T, fields: readonly K[], filter: Omit<ListFilter, "projection"> = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<FieldsOf<T>, K> })[]> {
    if (this.isDormant(type)) return [];
    if (!this.#isRecordType(type)) throw new UnknownTypeError(type);
    const records = await this.#transactions.list(type, { ...filter, projection: { version: this.#version(type), fields, older: this.#olderProjections(type, fields) } });
    return records.map((record) => {
      const current = this.current(record) as SchemaRecord<T>;
      return { ...current, fields: pickFields(current.fields, fields) as Pick<FieldsOf<T>, K> };
    });
  }

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
      ...(await outsideReadFor(options)),
    });
    return record as SchemaRecord | null;
  }

  check(type: RecordType, fields: Record<string, unknown>): void {
    this.#check({ id: "", type, version: this.#version(type), fields, createdAt: "", updatedAt: "" });
  }

  async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    await this.#transactions.retire({ id, reason, ...writeOptionsOf(options), ...(await outsideReadFor(options)) });
  }

  async revert(id: string, to: number, read: number, options: WriteOptions & { reason?: string } = {}): Promise<SchemaRecord> {
    const record = await this.#transactions.revert({
      id,
      to,
      read,
      upgrade: this.current,
      validate: this.#check,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...writeOptionsOf(options),
      ...(await outsideReadFor(options)),
    });
    return record as SchemaRecord;
  }

  async revertWrites(of: string, options: WriteOptions & { reason?: string } = {}): Promise<RevertedWrite[]> {
    return this.#transactions.revertWrites({
      of,
      upgrade: this.current,
      validate: this.#check,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...writeOptionsOf(options),
    });
  }

  async writtenBy(of: string): Promise<WriterChange[]> {
    const ids = [...new Set((await this.#transactions.history({ actor: of })).filter((entry) => entry.type !== "health").map((entry) => entry.recordId))];
    const entries = (await Promise.all(ids.map((id) => this.#transactions.history({ id })))).flat();
    const state = (entry: HistoryEntry | undefined): SchemaRecord | null => (entry === undefined || entry.action === "retired" ? null : this.current(entry.record));
    return writtenBy(of, entries).map(({ id, type, before, own, others: [later] }) => ({
      id,
      type,
      writes: own.length,
      before: state(before),
      after: state(own.at(-1)),
      ...(own.at(-1)!.action === "retired" && own.at(-1)!.reason !== undefined ? { retired: own.at(-1)!.reason! } : {}),
      ...(later === undefined ? {} : { later: { seq: later.seq, ...(later.actor === undefined ? {} : { actor: later.actor }) } }),
    }));
  }

  async history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return this.#transactions.history(filter);
  }

  readonly current = (record: RecordEnvelope): SchemaRecord => {
    const { id, type } = record;
    if (this.isDormant(type)) return { ...record, dormant: true } as SchemaRecord;
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

  readonly #check = (candidate: RecordEnvelope): void => {
    if (this.isDormant(candidate.type)) throw new UnknownTypeError(candidate.type, candidate.id || undefined);
    const { type, fields } = this.current(candidate);
    const problems = [...this.#shapeProblems(type, fields), ...unstorableText(fields)];
    if (problems.length > 0) throw new SchemaError(type, problems);
  };

  #shapeProblems(type: RecordType, fields: unknown): FieldProblem[] {
    const result = this.#schema.schemas[type]!.safeParse(fields);
    return result.success ? [] : result.error.issues.flatMap((issue) => describeIssue(issue, fields));
  }

  #olderProjections(type: RecordType, fields: readonly string[]): { version: number; fields: string[] }[] {
    const older: { version: number; fields: string[] }[] = [];
    const needed = new Set(fields);
    for (let from = this.#version(type) - 1; from > 0; from--) {
      const reads = this.#schema.upgrades.find((step) => step.type === type && step.from === from)?.reads;
      if (reads === undefined) break;
      for (const field of reads) needed.add(field);
      older.push({ version: from, fields: [...needed] });
    }
    return older;
  }

  #isRecordType(type: string): type is RecordType {
    return Object.hasOwn(this.#schema.versions, type);
  }

  isDormant(type: string): boolean {
    return isPluginKind(type) && !this.#isRecordType(type);
  }

  #version(type: RecordType): number {
    return this.#schema.versions[type]!;
  }
}

function newId(type: RecordType): string {
  return `${type}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function outsideReadFor(options: WriteOptions, type?: string): Promise<{ outsideRead?: OutsideRead }> {
  if (options.outsideRead === undefined || (type !== undefined && !MARKED_BY_OUTSIDE_READ.includes(type))) return {};
  const read = await options.outsideRead();
  return read.length === 0 ? {} : { outsideRead: (stored) => (MARKED_BY_OUTSIDE_READ.includes(stored) ? read : undefined) };
}

function writeOptionsOf(options: WriteOptions): Omit<WriteOptions, "outsideRead"> {
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
  const where = [`field ${quote(field)}`, ...rest.map((key) => `item ${String(key)}`)].join(" ");
  if (issue.code === "custom") return [{ field, problem: rest.length === 0 ? issue.message : `${where}: ${issue.message}` }];
  if (rest.length === 0 && !hasOwnField(fields, field)) {
    return [{ field, problem: `missing required field ${quote(field)}` }];
  }
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

function unstorableText(fields: unknown): FieldProblem[] {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields).flatMap(([field, value]) =>
    textsIn(value, `field ${quote(field)}`).flatMap(([where, text]) => {
      const found = unstorable(text);
      return found === undefined ? [] : [{ field, problem: `${where} contains ${found}, which the library cannot store` }];
    }),
  );
}

function textsIn(value: unknown, where: string): [where: string, text: string][] {
  if (typeof value === "string") return [[where, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => textsIn(item, `${where} item ${index}`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => textsIn(item, `${where} key ${quote(key)}`));
  }
  return [];
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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

function kindName(expected: string): string {
  if (expected === "array") return "a list";
  if (expected === "object") return "an object";
  return `a ${expected}`;
}

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
