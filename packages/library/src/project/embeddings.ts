/**
 * Capability 14 · Ranked search: a project's vectors, kept in its own database's `embedding` table
 * (schema.ts), with an optional machine-local copy. Remote vectors are authoritative only inside
 * their server and project database: a model + chunk hash does not authenticate the vector's source.
 * Only keys missing in that domain need a server read. SQLite serializes writers from independent processes; WAL keeps
 * readers from blocking them, and the wait outlasts a slow runner's lock contention (Windows CI held a
 * writer past 5 s, and the swallowed busy error lost its vectors).
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ConnectionOptions } from "node:tls";
import pg from "pg";
import type { Pool } from "pg";

import type { VectorStore } from "../knowledge/embedding.js";

/** Established by the connection, never by an embedding row or a note. */
export interface VectorDomain {
  readonly server: string;
  readonly database: string;
  /** The database's identity, not just its reusable name (Project.identity). */
  readonly identity: string;
}

/**
 * The connection's server, without passwords or connection strings. Use pg's own resolved
 * settings: URL query parameters and PGHOST/PGPORT can override the URL's apparent endpoint.
 * Cloud SQL's authenticated instance is authoritative; its pools' placeholder host is not.
 * A cache namespace does not add authentication to an otherwise unauthenticated connection.
 */
export function vectorServerIdentity(pool: Pool, cloudInstance?: string): string {
  let identity: unknown;
  if (cloudInstance !== undefined) {
    identity = ["cloud-sql", cloudInstance, pool.options.user];
  } else {
    // Construction parses settings only: this client is never connected and holds no socket fd.
    const client = new pg.Client(pool.options);
    const ssl = client.ssl as boolean | ConnectionOptions;
    identity = ["postgres", client.host, client.port, client.user, !ssl ? null : {
      verify: typeof ssl === "boolean" || ssl.rejectUnauthorized !== false,
      ca: typeof ssl === "boolean" ? null : ssl.ca ?? null,
      servername: typeof ssl === "boolean" ? null : ssl.servername ?? null,
      checkServerIdentity: typeof ssl === "boolean" ? null : ssl.checkServerIdentity?.toString() ?? null,
    }];
  }
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export class PgVectors implements VectorStore {
  readonly #pool: Pool;
  readonly #cache: string | null;
  readonly #domain: string | null;

  /** Without an explicit domain, shared storage is unsafe: use plain Postgres. */
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

  /** Open only while using it, so idle projects hold no handles and callers need no new close step. */
  async #locally(use: (db: DatabaseSync) => void): Promise<void> {
    if (this.#cache === null || this.#domain === null) return;
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
      // Never copy from the old table: its rows have no trustworthy source identity. A distinct
      // table also lets an older process finish without its writes entering the new namespace.
      db.exec("CREATE TABLE IF NOT EXISTS embedding_v2 (domain TEXT NOT NULL, model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (domain, model, key))");
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
