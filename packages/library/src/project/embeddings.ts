/**
 * Capability 14 · Ranked search: a project's vectors, kept in its own database's `embedding` table
 * (schema.ts), with an optional machine-local copy. Model + chunk hash is immutable: only keys
 * missing locally need a server read. SQLite serializes writers from independent processes; WAL keeps
 * readers from blocking them, and the wait outlasts a slow runner's lock contention (Windows CI held a
 * writer past 5 s, and the swallowed busy error lost its vectors).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";

import type { VectorStore } from "../knowledge/embedding.js";

export class PgVectors implements VectorStore {
  readonly #pool: Pool;
  readonly #cache: string | null;

  /** No local place means plain Postgres, as before. A failed local cache is also expendable. */
  constructor(pool: Pool, cache: string | null = null) {
    this.#pool = pool;
    this.#cache = cache;
  }

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    if (keys.length === 0) return found;
    await this.#locally((db) => {
      const select = db.prepare("SELECT vector FROM embedding WHERE model = ? AND key = ?");
      for (const key of keys) {
        const row = select.get(model, key);
        if (row?.vector instanceof Uint8Array && row.vector.byteLength > 0 && row.vector.byteLength % 4 === 0) {
          found.set(key, floats(row.vector));
        }
      }
    });
    const missing = [...new Set(keys)].filter((key) => !found.has(key));
    if (missing.length === 0) return found;
    const { rows } = await this.#pool.query<{ key: string; vector: Buffer }>(
      "SELECT key, vector FROM embedding WHERE model = $1 AND key = ANY($2::text[])",
      [model, missing],
    );
    const fetched = new Map<string, Float32Array>();
    for (const { key, vector } of rows) {
      fetched.set(key, floats(vector));
    }
    await this.#keep(model, fetched);
    for (const [key, vector] of fetched) found.set(key, vector);
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
    await this.#keep(model, vectors);
  }

  async #keep(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    if (vectors.size === 0) return;
    await this.#locally((db) => {
      db.exec("BEGIN IMMEDIATE");
      const insert = db.prepare("INSERT OR IGNORE INTO embedding (model, key, vector) VALUES (?, ?, ?)");
      for (const [key, vector] of vectors) {
        insert.run(model, key, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
      }
      db.exec("COMMIT");
    });
  }

  /** Open only while using it, so idle projects hold no handles and callers need no new close step. */
  async #locally(use: (db: DatabaseSync) => void): Promise<void> {
    if (this.#cache === null) return;
    let db: DatabaseSync | undefined;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      await mkdir(path.dirname(this.#cache), { recursive: true });
      db = new DatabaseSync(this.#cache);
      db.exec("PRAGMA busy_timeout = 20000");
      try {
        db.exec("PRAGMA journal_mode = WAL");
      } catch {
        // Another process switching the mode at the same moment: the file still works in its current mode.
      }
      db.exec("CREATE TABLE IF NOT EXISTS embedding (model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (model, key))");
      use(db);
    } catch {
      // A missing, read-only, busy or damaged cache cannot make a shared-library search fail.
      // Remote reads and writes are outside this catch: their errors still reach the caller.
    } finally {
      db?.close();
    }
  }
}

function floats(bytes: Uint8Array): Float32Array {
  return new Float32Array(Uint8Array.from(bytes).buffer);
}
