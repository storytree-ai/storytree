/**
 * Capability 14 · Ranked search: a project's vectors, kept in its own database's `embedding` table
 * (schema.ts), so a search in a new process reads what an earlier one embedded.
 */
import type { Pool } from "pg";

import type { VectorStore } from "../knowledge/embedding.js";

export class PgVectors implements VectorStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    if (keys.length === 0) return found;
    const { rows } = await this.#pool.query<{ key: string; vector: Buffer }>(
      "SELECT key, vector FROM embedding WHERE model = $1 AND key = ANY($2::text[])",
      [model, keys],
    );
    for (const { key, vector } of rows) {
      found.set(key, new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)));
    }
    return found;
  }

  async put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    if (vectors.size === 0) return;
    const keys = [...vectors.keys()];
    const blobs = keys.map((key) => {
      const vector = vectors.get(key)!;
      return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    });
    await this.#pool.query(
      `INSERT INTO embedding (model, key, vector)
       SELECT $1, key, vector FROM unnest($2::text[], $3::bytea[]) AS t(key, vector)
       ON CONFLICT (model, key) DO NOTHING`,
      [model, keys, blobs],
    );
  }
}
