// Capability 14 · Ranked search
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface VectorDomain {
  readonly server: string;
  readonly database: string;
  readonly identity: string;
}

const WAIT_MS = 60_000;
const RETRY_MS = 20;

const TABLE = `CREATE TABLE IF NOT EXISTS embedding_v2 (
  server TEXT NOT NULL, database TEXT NOT NULL, identity TEXT NOT NULL, model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (server, database, identity, model, key)
)`;

class Busy extends Error {}

export class LocalVectors {
  readonly #file: string;
  readonly #domain: VectorDomain;
  #unusable = false;

  constructor(file: string, domain: VectorDomain) {
    this.#file = file;
    this.#domain = domain;
  }

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = await this.#use((db) => {
      const { server, database, identity } = this.#domain;
      const rows = db.prepare(
        "SELECT key, vector FROM embedding_v2 WHERE server = ? AND database = ? AND identity = ? AND model = ? AND key IN (SELECT value FROM json_each(?))",
      ).all(server, database, identity, model, JSON.stringify(keys)) as { key: string; vector: Uint8Array }[];
      return new Map(rows.map(({ key, vector }) => [key, new Float32Array(new Uint8Array(vector).buffer)]));
    });
    return found ?? new Map();
  }

  async put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    await this.#use((db) => {
      const { server, database, identity } = this.#domain;
      db.exec("BEGIN IMMEDIATE");
      try {
        const insert = db.prepare("INSERT OR REPLACE INTO embedding_v2 (server, database, identity, model, key, vector) VALUES (?, ?, ?, ?, ?, ?)");
        for (const [key, vector] of vectors) {
          insert.run(server, database, identity, model, key, new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async #use<T>(work: (db: DatabaseSync) => T): Promise<T | undefined> {
    const deadline = Date.now() + WAIT_MS;
    while (!this.#unusable) {
      let db: DatabaseSync | undefined;
      try {
        mkdirSync(path.dirname(this.#file), { recursive: true });
        db = new DatabaseSync(this.#file, { timeout: 0 });
        const { journal_mode: mode } = db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
        if (mode !== "wal") throw new Busy(`the vector cache is in ${mode} mode`);
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'embedding_v2'").get() === undefined) db.exec(TABLE);
        return work(db);
      } catch (error) {
        if (!busy(error)) this.#unusable = true;
        else if (Date.now() >= deadline) return undefined;
      } finally {
        db?.close();
      }
      if (!this.#unusable) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    return undefined;
  }
}

function busy(error: unknown): boolean {
  if (error instanceof Busy) return true;
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === "number" && ((code & 0xff) === 5 || (code & 0xff) === 6);
}
