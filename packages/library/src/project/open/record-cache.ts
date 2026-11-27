// Capability 1 · Opening a project
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { Pool } from "pg";

import { listed, type EditInput, type HistoryEntry, type HistoryFilter, type ListFilter, type RecordEnvelope, type RetireInput, type RevertedWrite, type RevertInput, type RevertWritesInput, type SaveInput, type Transactions } from "../../records/index.js";
import type { VectorDomain } from "../../knowledge/index.js";

interface CachedRow {
  id: string;
  type: string;
  version: number;
  fields: string;
  created_at: string;
  updated_at: string;
}

export class CachedTransactions implements Transactions {
  readonly #inner: Transactions;
  readonly #pool: Pool;
  readonly #file: string;
  readonly #domain: string;
  readonly #inside = new AsyncLocalStorage<true>();
  #db: DatabaseSync | null | undefined;
  #queued: Promise<void> | undefined;
  #running: Promise<void> | undefined;

  constructor(inner: Transactions, pool: Pool, file: string, domain: VectorDomain) {
    this.#inner = inner;
    this.#pool = pool;
    this.#file = file;
    this.#domain = createHash("sha256").update(JSON.stringify(["records", domain.server, domain.database, domain.identity])).digest("hex");
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    const db = await this.#current();
    if (db === null) return this.#inner.get(id);
    try {
      const row = db.prepare("SELECT id, type, version, fields, created_at, updated_at FROM record_v1 WHERE domain = ? AND id = ?").get(this.#domain, id) as CachedRow | undefined;
      return row === undefined ? null : envelopeOf(row);
    } catch {
      return this.#inner.get(id);
    }
  }

  async list(type: string | readonly string[], filter: ListFilter = {}): Promise<RecordEnvelope[]> {
    const db = await this.#current();
    if (db === null) return this.#inner.list(type, filter);
    let rows: CachedRow[];
    try {
      const types = typeof type === "string" ? [type] : [...type];
      rows = types.length === 0 ? [] : db.prepare(
        `SELECT id, type, version, fields, created_at, updated_at FROM record_v1 WHERE domain = ? AND type IN (${types.map(() => "?").join(", ")})`,
      ).all(this.#domain, ...types) as unknown as CachedRow[];
    } catch {
      return this.#inner.list(type, filter);
    }
    return listed(rows.map(envelopeOf), type, filter);
  }

  save(input: SaveInput): Promise<RecordEnvelope> {
    return this.#inner.save(input);
  }

  saveAll(inputs: readonly SaveInput[], signal?: AbortSignal): Promise<RecordEnvelope[]> {
    return this.#inner.saveAll(inputs, signal);
  }

  edit(input: EditInput): Promise<RecordEnvelope | null> {
    return this.#inner.edit(input);
  }

  retire(input: RetireInput): Promise<void> {
    return this.#inner.retire(input);
  }

  revert(input: RevertInput): Promise<RecordEnvelope> {
    return this.#inner.revert(input);
  }

  revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]> {
    return this.#inner.revertWrites(input);
  }

  history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return this.#inner.history(filter);
  }

  inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.#inside.run(true, () => this.#inner.inOneWrite(work, signal));
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  async #current(): Promise<DatabaseSync | null> {
    if (this.#inside.getStore() === true) return null;
    const db = this.#open();
    if (db === null) return null;
    this.#queued ??= (async () => {
      await this.#running?.catch(() => undefined);
      this.#running = this.#queued;
      this.#queued = undefined;
      await this.#catchUp(db);
    })().finally(() => {
      this.#running = undefined;
    });
    await this.#queued;
    return this.#db ?? null;
  }

  #open(): DatabaseSync | null {
    if (this.#db !== undefined) return this.#db;
    try {
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
      mkdirSync(path.dirname(this.#file), { recursive: true });
      const db = new DatabaseSync(this.#file);
      try {
        db.exec("PRAGMA busy_timeout = 20000");
        try {
          db.exec("PRAGMA journal_mode = WAL");
        } catch {
        }
        db.exec(`CREATE TABLE IF NOT EXISTS record_v1 (domain TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL,
          fields TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (domain, id))`);
        db.exec("CREATE INDEX IF NOT EXISTS record_v1_type ON record_v1 (domain, type)");
        db.exec("CREATE TABLE IF NOT EXISTS cursor_v1 (domain TEXT PRIMARY KEY, seq INTEGER NOT NULL)");
      } catch (error) {
        db.close();
        throw error;
      }
      this.#db = db;
    } catch {
      this.#db = null;
    }
    return this.#db;
  }

  async #catchUp(db: DatabaseSync): Promise<void> {
    const cursor = this.#cursor(db);
    if (cursor === undefined) {
      const { seq, records } = await this.#whole();
      this.#keep(db, (stored) => {
        if (stored !== undefined) return;
        db.prepare("DELETE FROM record_v1 WHERE domain = ?").run(this.#domain);
        for (const record of records) this.#put(db, record);
        db.prepare("INSERT INTO cursor_v1 (domain, seq) VALUES (?, ?)").run(this.#domain, seq);
      });
      return;
    }
    const changes = await this.#inner.history({ since: cursor });
    if (changes.length === 0) return;
    this.#keep(db, (stored) => {
      const from = stored ?? cursor;
      for (const change of changes) {
        if (change.seq <= from) continue;
        if (change.action === "retired") db.prepare("DELETE FROM record_v1 WHERE domain = ? AND id = ?").run(this.#domain, change.recordId);
        else this.#put(db, change.record);
      }
      db.prepare("INSERT INTO cursor_v1 (domain, seq) VALUES (?, ?) ON CONFLICT (domain) DO UPDATE SET seq = max(seq, excluded.seq)")
        .run(this.#domain, Math.max(from, changes.at(-1)!.seq));
    });
  }

  #cursor(db: DatabaseSync): number | undefined {
    try {
      const row = db.prepare("SELECT seq FROM cursor_v1 WHERE domain = ?").get(this.#domain) as { seq: number } | undefined;
      return row?.seq;
    } catch {
      this.#lose();
      return undefined;
    }
  }

  #keep(db: DatabaseSync, write: (stored: number | undefined) => void): void {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare("SELECT seq FROM cursor_v1 WHERE domain = ?").get(this.#domain) as { seq: number } | undefined;
        write(row?.seq);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch {
      this.#lose();
    }
  }

  #put(db: DatabaseSync, record: RecordEnvelope): void {
    db.prepare(`INSERT INTO record_v1 (domain, id, type, version, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (domain, id) DO UPDATE SET type = excluded.type, version = excluded.version, fields = excluded.fields,
        created_at = excluded.created_at, updated_at = excluded.updated_at`)
      .run(this.#domain, record.id, record.type, record.version, JSON.stringify(record.fields), iso(record.createdAt), iso(record.updatedAt));
  }

  async #whole(): Promise<{ seq: number; records: RecordEnvelope[] }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const { rows: [newest] } = await client.query<{ seq: string }>("SELECT coalesce(max(seq), 0) AS seq FROM record_event");
        const { rows } = await client.query<{ id: string; type: string; version: number; fields: Record<string, unknown>; created_at: Date; updated_at: Date }>(
          "SELECT id, type, version, fields, created_at, updated_at FROM record",
        );
        return {
          seq: Number(newest?.seq ?? 0),
          records: rows.map((row) => ({ id: row.id, type: row.type, version: row.version, fields: row.fields, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() })),
        };
      } finally {
        await client.query("COMMIT");
      }
    } finally {
      client.release();
    }
  }

  #lose(): void {
    try {
      this.#db?.close();
    } catch {
    }
    this.#db = null;
  }
}

function envelopeOf(row: CachedRow): RecordEnvelope {
  return { id: row.id, type: row.type, version: row.version, fields: JSON.parse(row.fields) as Record<string, unknown>, createdAt: row.created_at, updatedAt: row.updated_at };
}

function iso(at: string): string {
  return new Date(at).toISOString();
}
