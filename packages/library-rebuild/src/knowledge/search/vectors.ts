// Capability 14 · Ranked search
import { createHash } from "node:crypto";

import pg from "pg";

import { LocalVectors, type VectorDomain } from "./local-vectors.js";

export type { VectorDomain } from "./local-vectors.js";

export interface VectorStore {
  get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>>;
  put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void>;
}

export const VECTOR_TABLES = [
  "CREATE TABLE IF NOT EXISTS embedding (model text NOT NULL, key text NOT NULL, vector bytea NOT NULL, PRIMARY KEY (model, key))",
];

export class MemoryVectors implements VectorStore {
  readonly #models = new Map<string, Map<string, Float32Array>>();

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const kept = this.#models.get(model);
    const found = new Map<string, Float32Array>();
    for (const key of keys) {
      const vector = kept?.get(key);
      if (vector !== undefined) found.set(key, vector);
    }
    return found;
  }

  async put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    const kept = this.#models.get(model) ?? new Map<string, Float32Array>();
    for (const [key, vector] of vectors) kept.set(key, vector);
    this.#models.set(model, kept);
  }
}

interface Queryable {
  query(sql: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

const BATCH = 500;

export class PgVectors implements VectorStore {
  readonly #pool: Queryable;
  readonly #local: LocalVectors | undefined;

  constructor(pool: Pick<pg.Pool, "query"> | Queryable, file: string | null = null, domain?: VectorDomain) {
    this.#pool = pool as Queryable;
    this.#local = file === null || domain === undefined ? undefined : new LocalVectors(file, domain);
  }

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = (await this.#local?.get(model, keys)) ?? new Map<string, Float32Array>();
    const missing = keys.filter((key) => !found.has(key));
    if (missing.length === 0) return found;
    const { rows } = await this.#pool.query("SELECT key, vector FROM embedding WHERE model = $1 AND key = ANY($2::text[])", [model, missing]);
    const fetched = new Map((rows as { key: string; vector: Uint8Array }[]).map(({ key, vector }) => [key, toVector(vector)]));
    if (fetched.size > 0) await this.#local?.put(model, fetched);
    for (const [key, vector] of fetched) found.set(key, vector);
    return found;
  }

  async put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    const entries = [...vectors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (let start = 0; start < entries.length; start += BATCH) {
      const batch = entries.slice(start, start + BATCH);
      const values: unknown[] = [model];
      const rows = batch.map(([key, vector]) => `($1, $${values.push(key)}, $${values.push(toBytes(vector))})`);
      await this.#pool.query(`INSERT INTO embedding (model, key, vector) VALUES ${rows.join(", ")} ON CONFLICT (model, key) DO NOTHING`, values);
    }
    if (entries.length > 0) await this.#local?.put(model, vectors);
  }
}

export function toBytes(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function toVector(bytes: Uint8Array): Float32Array {
  return new Float32Array(new Uint8Array(bytes).buffer);
}

interface ConnectionParameters {
  readonly host?: unknown;
  readonly port?: unknown;
  readonly user?: unknown;
  readonly ssl?: unknown;
}

export function vectorServerIdentity(pool: pg.Pool): string {
  const { host, port, user, ssl } = (new pg.Client(pool.options) as unknown as { connectionParameters: ConnectionParameters }).connectionParameters;
  const described = JSON.stringify({ host, port, user, ssl }, (_key, value: unknown) => (typeof value === "function" ? `function ${String(value)}` : value));
  return createHash("sha256").update(described).digest("hex");
}
