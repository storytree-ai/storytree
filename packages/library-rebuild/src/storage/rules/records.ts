// Capability 3 · Data schema
import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { HistoryEntry, HistoryFilter, ListFilter, RecordEnvelope, RevertedWrite, SaveInput, Transactions } from "../store/index.js";
import { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
import { LIBRARY_SCHEMA, type FieldsOf, type LibrarySchema, type RecordType } from "./schema.js";

export type SchemaRecord<T extends RecordType = RecordType> = {
  [K in T]: Omit<RecordEnvelope, "type" | "fields"> & { type: K; fields: FieldsOf<K>; dormant?: true };
}[T];

type FieldEdit = {
  [K in RecordType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[RecordType];

export interface WriteOptions {
  readonly actor?: string;
  readonly signal?: AbortSignal;
  readonly outsideRead?: () => Promise<readonly string[]>;
}

export interface CreateOptions extends WriteOptions {
  readonly id?: string;
}

export type EditOptions = WriteOptions & { readonly reason?: string; readonly checkCurrent?: (record: SchemaRecord) => void };

type Filter = Omit<ListFilter, "projection">;

export class SchemaRecords {
  readonly #transactions: Transactions;
  readonly #schema: LibrarySchema;

  constructor(transactions: Transactions, schema: LibrarySchema = LIBRARY_SCHEMA) {
    this.#transactions = transactions;
    this.#schema = schema;
  }

  async create<T extends RecordType>(type: T, fields: FieldsOf<T>, options: CreateOptions = {}): Promise<SchemaRecord<T>> {
    const saved = await this.#transactions.save(await this.#saving(type, fields, options));
    return saved as SchemaRecord<T>;
  }

  async createAll<T extends RecordType>(records: readonly { type: T; fields: FieldsOf<T>; options?: Omit<CreateOptions, "signal"> }[], signal?: AbortSignal): Promise<SchemaRecord<T>[]> {
    const inputs: SaveInput[] = [];
    for (const { type, fields, options = {} } of records) inputs.push(await this.#saving(type, fields, options));
    return (await this.#transactions.saveAll(inputs, signal)) as SchemaRecord<T>[];
  }

  async #saving(type: RecordType, fields: object, options: CreateOptions): Promise<SaveInput> {
    const shaped = fields as Record<string, unknown>;
    this.check(type, shaped);
    const id = options.id ?? `${type}_${randomBytes(6).toString("hex")}`;
    return { id, type, version: this.#schema.versions[type]!, fields: shaped, ...writing(options), ...(await this.#mark(type, options)) };
  }

  async #mark(type: string | undefined, options: WriteOptions): Promise<Pick<SaveInput, "outsideRead">> {
    if (options.outsideRead === undefined || type === undefined || !(this.#schema.marked ?? []).includes(type)) return {};
    const read = [...(await options.outsideRead())];
    return read.length === 0 ? {} : { outsideRead: () => read };
  }

  async #typeOf(id: string, options: WriteOptions): Promise<string | undefined> {
    return options.outsideRead === undefined ? undefined : (await this.#transactions.get(id))?.type;
  }

  async get(id: string): Promise<SchemaRecord | null> {
    const stored = await this.#transactions.get(id);
    return stored === null ? null : this.current(stored);
  }

  async list<T extends RecordType>(type: T | readonly T[], filter: Filter = {}): Promise<SchemaRecord<T>[]> {
    const types = this.#readable(type);
    if (types.length === 0) return [];
    return (await this.#transactions.list(types, filter)).map(this.current) as SchemaRecord<T>[];
  }

  async select<T extends RecordType, K extends keyof FieldsOf<T> & string>(
    type: T,
    fields: readonly K[],
    filter: Filter = {},
  ): Promise<(Omit<SchemaRecord<T>, "fields"> & { fields: Pick<FieldsOf<T>, K> })[]> {
    if (this.#readable(type).length === 0) return [];
    const known = this.#schema.versions[type]!;
    const older: { version: number; fields: string[] }[] = [];
    for (let version = known - 1; version >= 1; version--) {
      const step = this.#step(type, version);
      if (step?.reads === undefined) break;
      older.push({ version, fields: [...new Set([...(older.at(-1)?.fields ?? fields), ...step.reads])] });
    }
    const stored = await this.#transactions.list(type, { ...filter, projection: { version: known, fields, older } });
    return stored.map((record) => {
      const current = this.current(record);
      return { ...current, fields: Object.fromEntries(fields.filter((field) => Object.hasOwn(current.fields, field)).map((field) => [field, (current.fields as Record<string, unknown>)[field]])) };
    }) as never;
  }

  async edit(id: string, fields: FieldEdit, options: EditOptions = {}): Promise<SchemaRecord | null> {
    const edited = await this.#transactions.edit({
      id,
      fields,
      ...writing(options),
      ...(await this.#mark(await this.#typeOf(id, options), options)),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      upgrade: (stored) => {
        if (!Object.hasOwn(this.#schema.versions, stored.type)) throw new UnknownTypeError(stored.type, stored.id);
        const current = this.current(stored);
        options.checkCurrent?.(current);
        return current;
      },
      validate: (candidate) => this.check(candidate.type as RecordType, candidate.fields),
    });
    return edited as SchemaRecord | null;
  }

  check(type: RecordType, fields: Record<string, unknown>): void {
    const refused = this.#schema.refused ?? {};
    if (Object.hasOwn(refused, type)) throw new SchemaError(type, [{ field: undefined, problem: refused[type]! }]);
    if (!Object.hasOwn(this.#schema.schemas, type)) throw new UnknownTypeError(type);
    const schema = this.#schema.schemas[type]!;
    const shape = schema instanceof z.ZodObject ? schema.shape : {};
    const problems: FieldProblem[] = [];
    for (const field of Object.keys(fields)) {
      if (!Object.hasOwn(shape, field)) problems.push({ field, problem: `unknown field ${JSON.stringify(field)}` });
      const held = unstorable(fields[field]);
      if (held !== undefined) problems.push({ field, problem: `${JSON.stringify(field)} holds ${held}, which cannot be stored` });
    }
    const parsed = schema.safeParse(fields);
    for (const issue of parsed.error?.issues ?? []) {
      if (issue.code === "unrecognized_keys" && issue.path.length === 0) continue;
      const field = issue.path[0] === undefined ? undefined : String(issue.path[0]);
      const value = field === undefined ? fields : fields[field];
      if (!(issue.code === "custom" && issue.params?.["reason"] === true) && field !== undefined && value === undefined) {
        problems.push({ field, problem: `missing required field ${JSON.stringify(field)}` });
      } else {
        const textForList = issue.code === "invalid_type" && issue.expected === "array" && typeof value === "string";
        problems.push({ field, problem: `${JSON.stringify(field ?? type)}: ${issue.message}`, ...(textForList ? { textForList } : {}) });
      }
    }
    if (problems.length > 0) throw new SchemaError(type, problems);
  }

  async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    await this.#transactions.retire({ id, reason, ...writing(options), ...(await this.#mark(await this.#typeOf(id, options), options)) });
  }

  async revert(id: string, to: number, read: number, options: WriteOptions & { readonly reason?: string } = {}): Promise<SchemaRecord> {
    const validate = (candidate: RecordEnvelope) => this.check(candidate.type as RecordType, candidate.fields);
    return this.current(await this.#transactions.revert({ id, to, read, ...writing(options), ...(options.reason === undefined ? {} : { reason: options.reason }), validate }));
  }

  async revertWrites(of: string, options: WriteOptions & { readonly reason?: string } = {}): Promise<RevertedWrite[]> {
    const validate = (candidate: RecordEnvelope) => this.check(candidate.type as RecordType, candidate.fields);
    return await this.#transactions.revertWrites({ of, ...writing(options), ...(options.reason === undefined ? {} : { reason: options.reason }), validate });
  }

  async history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return await this.#transactions.history(filter);
  }

  async inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return await this.#transactions.inOneWrite(work, signal);
  }

  readonly current = (record: RecordEnvelope): SchemaRecord => {
    const { id, type } = record;
    if (!Object.hasOwn(this.#schema.versions, type)) {
      if (dotted(type)) return { ...record, dormant: true } as SchemaRecord;
      throw new UnknownTypeError(type, id);
    }
    const known = this.#schema.versions[type]!;
    if (record.version > known) throw new NewerSchemaError(id, type, record.version, known);
    let fields = record.fields;
    for (let version = record.version; version < known; version++) {
      const step = this.#step(type, version);
      if (step === undefined) throw new MissingUpgradeError(id, type, version, known);
      fields = step.up(fields);
    }
    return { ...record, version: known, fields } as SchemaRecord;
  };

  #readable(type: string | readonly string[]): string[] {
    const types: readonly string[] = typeof type === "string" ? [type] : type;
    return types.filter((candidate) => {
      if (Object.hasOwn(this.#schema.versions, candidate)) return true;
      if (dotted(candidate)) return false;
      throw new UnknownTypeError(candidate);
    });
  }

  #step(type: string, from: number) {
    return this.#schema.upgrades.find((step) => step.type === type && step.from === from);
  }
}

function writing(options: WriteOptions): Omit<WriteOptions, "outsideRead"> {
  return { ...(options.actor === undefined ? {} : { actor: options.actor }), ...(options.signal === undefined ? {} : { signal: options.signal }) };
}

function dotted(type: string): boolean {
  return type.includes(".");
}

export function unstorable(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.includes("\u0000")) return "a NUL character";
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) return "a lone UTF-16 surrogate";
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) {
      const held = unstorable(member);
      if (held !== undefined) return held;
    }
  }
  return undefined;
}
