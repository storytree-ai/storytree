// Capability 14 · Ranked search
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ConnectionOptions } from "node:tls";
import pg from "pg";
import type { Pool } from "pg";

import type { VectorStore } from "./embedding.js";

export interface VectorDomain {
  readonly server: string;
  readonly database: string;
  readonly identity: string;
}

export function vectorServerIdentity(pool: Pool): string {
  const client = new pg.Client(pool.options);
  const ssl = client.ssl as boolean | ConnectionOptions;
  const identity = ["postgres", client.host, client.port, client.user, !ssl ? null : {
    verify: typeof ssl === "boolean" || ssl.rejectUnauthorized !== false,
    ca: typeof ssl === "boolean" ? null : ssl.ca ?? null,
    servername: typeof ssl === "boolean" ? null : ssl.servername ?? null,
    checkServerIdentity: typeof ssl === "boolean" ? null : ssl.checkServerIdentity?.toString() ?? null,
  }];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export class PgVectors implements VectorStore {
  readonly #pool: Pool;
  readonly #cache: string | null;
  readonly #domain: string | null;

  constructor(pool: Pool, cache: string | null = null, domain: VectorDomain | null = null) {
    this.#pool = pool;
    this.#cache = cache;
    this.#domain = domain === null ? null : createHash("sha256")
      .update(JSON.stringify([domain.server, domain.database, domain.identity])).digest("hex");
  }

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    if (keys.length === 0) return found;
    await this.#locally((db) => {
      const select = db.prepare("SELECT vector FROM embedding_v2 WHERE domain = ? AND model = ? AND key = ?");
      for (const key of keys) {
        const row = select.get(this.#domain!, model, key);
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
      const insert = db.prepare("INSERT OR IGNORE INTO embedding_v2 (domain, model, key, vector) VALUES (?, ?, ?, ?)");
      for (const [key, vector] of vectors) {
        insert.run(this.#domain!, model, key, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
      }
      db.exec("COMMIT");
    });
  }

  async #locally(use: (db: DatabaseSync) => void): Promise<void> {
    if (this.#cache === null || this.#domain === null) return;
    const deadline = Date.now() + 60_000;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.#open(this.#cache, use);
        return;
      } catch (error) {
        if (!busy(error) || Date.now() >= deadline) return;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(100, 5 * 2 ** attempt)));
      }
    }
  }

  async #open(cache: string, use: (db: DatabaseSync) => void): Promise<void> {
    let db: DatabaseSync | undefined;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      await mkdir(path.dirname(cache), { recursive: true });
      db = new DatabaseSync(cache);
      db.exec("PRAGMA busy_timeout = 50");
      try {
        db.exec("PRAGMA journal_mode = WAL");
      } catch (error) {
        if (busy(error)) throw error;
      }
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec("CREATE TABLE IF NOT EXISTS embedding_v2 (domain TEXT NOT NULL, model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (domain, model, key))");
      use(db);
    } finally {
      db?.close();
    }
  }
}

function busy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}

function floats(bytes: Uint8Array): Float32Array {
  return new Float32Array(Uint8Array.from(bytes).buffer);
}
