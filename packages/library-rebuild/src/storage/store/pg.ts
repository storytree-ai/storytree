// Capability 2 · Library transactions
import type { Pool, PoolClient } from "pg";

import { Store, type Backend, type HistoryEntry, type HistoryFilter, type ListFilter, type NewEntry, type RecordEnvelope, type Writer } from "./transactions.js";

export const STORE_TABLES = [
  `CREATE TABLE IF NOT EXISTS record (
    id text PRIMARY KEY,
    type text NOT NULL,
    version integer NOT NULL,
    fields jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS record_type ON record (type)",
  `CREATE TABLE IF NOT EXISTS record_event (
    seq bigserial PRIMARY KEY,
    record_id text NOT NULL,
    type text NOT NULL,
    action text NOT NULL,
    record jsonb NOT NULL,
    reason text,
    actor text,
    outside_read jsonb,
    at timestamptz NOT NULL DEFAULT clock_timestamp(),
    recorded_by text NOT NULL DEFAULT session_user
  )`,
  "CREATE INDEX IF NOT EXISTS record_event_record ON record_event (record_id, seq)",
];

const WRITE_LOCK = 7_301_000;

type Queryable = Pick<Pool, "query">;

interface RecordRow {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  seq: string;
  record_id: string;
  type: string;
  action: HistoryEntry["action"];
  record: RecordEnvelope;
  reason: string | null;
  actor: string | null;
  outside_read?: string[] | null;
  at: Date;
  recorded_by: string;
}

export class PgTransactions extends Store {
  constructor(pool: Pool) {
    super(new PgBackend(pool));
  }
}

class PgBackend implements Backend {
  readonly #pool: Pool;
  readonly reader: Writer;
  #marks: Promise<boolean> | undefined;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.reader = this.#on(pool);
  }

  async write<T>(work: (writer: Writer) => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    signal?.throwIfAborted();
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
        signal?.throwIfAborted();
        const done = await work(this.#on(client));
        await client.query("COMMIT");
        return done;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  #on(db: Queryable | PoolClient): Writer {
    return {
      get: async (id) => {
        const { rows } = await db.query<RecordRow>("SELECT * FROM record WHERE id = $1", [id]);
        return rows[0] === undefined ? null : envelope(rows[0]);
      },
      list: async (types, filter) => this.#list(db, types, filter),
      history: async (filter) => this.#history(db, filter),
      put: async (record) => {
        await db.query(
          `INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, version = EXCLUDED.version, fields = EXCLUDED.fields,
             created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
          [record.id, record.type, record.version, JSON.stringify(record.fields), record.createdAt, record.updatedAt],
        );
      },
      remove: async (id) => {
        await db.query("DELETE FROM record WHERE id = $1", [id]);
      },
      append: async (entry) => this.#append(db, entry),
    };
  }

  async #append(db: Queryable, entry: NewEntry): Promise<void> {
    const values = [entry.recordId, entry.type, entry.action, JSON.stringify(entry.record), entry.reason ?? null, entry.actor ?? null];
    if (await this.#hasMarks(db)) {
      await db.query(
        "INSERT INTO record_event (record_id, type, action, record, reason, actor, outside_read) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [...values, entry.outsideRead === undefined ? null : JSON.stringify(entry.outsideRead)],
      );
    } else {
      await db.query("INSERT INTO record_event (record_id, type, action, record, reason, actor) VALUES ($1, $2, $3, $4, $5, $6)", values);
    }
  }

  async #hasMarks(db: Queryable): Promise<boolean> {
    this.#marks ??= db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'record_event' AND column_name = 'outside_read'",
    ).then(({ rowCount }) => rowCount !== 0);
    return await this.#marks;
  }

  async #list(db: Queryable, types: readonly string[], filter: ListFilter): Promise<RecordEnvelope[]> {
    const values: unknown[] = [types];
    const where = ["type = ANY($1::text[])"];
    const bind = (value: unknown): string => `$${values.push(value)}`;
    if (filter.ids !== undefined) where.push(`id = ANY(${bind(filter.ids)}::text[])`);
    if (filter.where !== undefined) where.push(`fields @> ${bind(JSON.stringify(filter.where))}::jsonb`);
    if (filter.names !== undefined) {
      const named = bind(JSON.stringify(filter.names));
      where.push(`EXISTS (SELECT 1 FROM jsonb_each(fields) AS f WHERE f.value = ${named}::jsonb
        OR (jsonb_typeof(f.value) = 'array' AND f.value @> jsonb_build_array(${named}::jsonb)))`);
    }
    const projection = filter.projection;
    const versions = projection === undefined ? [] : [projection, ...(projection.older ?? [])];
    const fields = versions.length === 0 ? "fields" : `CASE ${versions.map((version) =>
      `WHEN version = ${bind(version.version)}::int THEN (SELECT coalesce(jsonb_object_agg(key, value), '{}') FROM jsonb_each(fields) WHERE key = ANY(${bind(version.fields)}::text[]))`).join(" ")} ELSE fields END`;
    const limit = filter.limit === undefined ? "" : ` LIMIT ${bind(filter.limit)}::int`;
    const { rows } = await db.query<RecordRow>(
      `SELECT id, type, version, ${fields} AS fields, created_at, updated_at FROM record WHERE ${where.join(" AND ")} ORDER BY id COLLATE "C"${limit}`,
      values,
    );
    return rows.map(envelope);
  }

  async #history(db: Queryable, filter: HistoryFilter): Promise<HistoryEntry[]> {
    const values: unknown[] = [];
    const where = ["true"];
    const bind = (value: unknown): string => `$${values.push(value)}`;
    if (filter.id !== undefined) where.push(`record_id = ${bind(filter.id)}`);
    if (filter.since !== undefined) where.push(`seq > ${bind(filter.since)}`);
    if (filter.actor !== undefined) where.push(`actor = ${bind(filter.actor)}`);
    if (filter.from !== undefined) where.push(`at >= ${bind(new Date(filter.from).toISOString())}::timestamptz`);
    if (filter.types !== undefined) where.push(`type = ANY(${bind(filter.types)}::text[])`);
    if (filter.actions !== undefined) where.push(`action = ANY(${bind(filter.actions)}::text[])`);
    const newest = filter.newest !== undefined;
    const limit = filter.newest ?? filter.oldest;
    const { rows } = await db.query<EventRow>(
      `SELECT * FROM record_event WHERE ${where.join(" AND ")} ORDER BY seq ${newest ? "DESC" : ""}${limit === undefined ? "" : ` LIMIT ${bind(limit)}`}`,
      values,
    );
    const entries = rows.map(historyEntry);
    return newest ? entries.reverse() : entries;
  }
}

function envelope(row: RecordRow): RecordEnvelope {
  return { id: row.id, type: row.type, version: row.version, fields: row.fields, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

function historyEntry(row: EventRow): HistoryEntry {
  return {
    seq: Number(row.seq),
    recordId: row.record_id,
    type: row.type,
    action: row.action,
    record: row.record,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.actor === null ? {} : { actor: row.actor }),
    ...(row.outside_read === null || row.outside_read === undefined ? {} : { outsideRead: row.outside_read }),
    at: row.at.toISOString(),
    recordedBy: row.recorded_by,
  };
}
