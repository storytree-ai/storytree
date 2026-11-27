// Capability 1 · Project libraries
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Pool } from "pg";

import { project as projected, type Backend, type ListFilter, type Reader, type RecordEnvelope } from "../../storage/store/index.js";

const TABLES = `
  CREATE TABLE IF NOT EXISTS record_v1 (domain TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY (domain, id));
  CREATE TABLE IF NOT EXISTS cursor_v1 (domain TEXT PRIMARY KEY, seq INTEGER NOT NULL);
`;

export class RecordCache {
  readonly #file: string;
  #db: DatabaseSync | undefined;

  constructor(file: string) {
    this.#file = file;
  }

  backend(server: Backend, pool: Pool, key: string): Backend {
    const reader: Reader = {
      get: async (id) => {
        try {
          await this.#sync(pool, key);
          const row = this.#open().prepare("SELECT envelope FROM record_v1 WHERE domain = ? AND id = ?").get(key, id) as { envelope: string } | undefined;
          return row === undefined ? null : (JSON.parse(row.envelope) as RecordEnvelope);
        } catch {
          return await server.reader.get(id);
        }
      },
      list: async (types, filter) => {
        try {
          await this.#sync(pool, key);
          return this.#list(key, types, filter);
        } catch {
          return await server.reader.list(types, filter);
        }
      },
      history: (filter) => server.reader.history(filter),
    };
    return { reader, write: (work, signal) => server.write(work, signal) };
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  #open(): DatabaseSync {
    if (this.#db === undefined) {
      mkdirSync(path.dirname(this.#file), { recursive: true });
      const db = new DatabaseSync(this.#file);
      db.exec(TABLES);
      this.#db = db;
    }
    return this.#db;
  }

  #cursor(key: string): number {
    const row = this.#open().prepare("SELECT seq FROM cursor_v1 WHERE domain = ?").get(key) as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  async #sync(pool: Pool, key: string): Promise<void> {
    const { rows } = await pool.query<{ seq: string; record_id: string; action: string; record: RecordEnvelope }>(
      "SELECT seq, record_id, action, record FROM record_event WHERE seq > $1 ORDER BY seq",
      [this.#cursor(key)],
    );
    if (rows.length === 0) return;
    const db = this.#open();
    db.exec("BEGIN");
    try {
      const after = this.#cursor(key);
      const put = db.prepare("INSERT OR REPLACE INTO record_v1 (domain, id, type, envelope) VALUES (?, ?, ?, ?)");
      const remove = db.prepare("DELETE FROM record_v1 WHERE domain = ? AND id = ?");
      for (const row of rows) {
        if (Number(row.seq) <= after) continue;
        if (row.action === "retired") remove.run(key, row.record_id);
        else put.run(key, row.record_id, row.record.type, JSON.stringify(row.record));
      }
      db.prepare("INSERT INTO cursor_v1 (domain, seq) VALUES (?, ?) ON CONFLICT (domain) DO UPDATE SET seq = max(seq, excluded.seq)").run(key, Number(rows.at(-1)!.seq));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  #list(key: string, types: readonly string[], filter: ListFilter): RecordEnvelope[] {
    const rows = this.#open()
      .prepare(`SELECT envelope FROM record_v1 WHERE domain = ? AND type IN (${types.map(() => "?").join(", ")})`)
      .all(key, ...types) as { envelope: string }[];
    const named = filter.names;
    const records = rows
      .map((row) => JSON.parse(row.envelope) as RecordEnvelope)
      .filter((record) => filter.ids === undefined || filter.ids.includes(record.id))
      .filter((record) => Object.entries(filter.where ?? {}).every(([field, value]) => Object.hasOwn(record.fields, field) && record.fields[field] === value))
      .filter((record) => named === undefined || Object.values(record.fields).some((value) => value === named || (Array.isArray(value) && value.includes(named))))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return (filter.limit === undefined ? records : records.slice(0, filter.limit)).map((record) => projected(record, filter.projection));
  }
}
