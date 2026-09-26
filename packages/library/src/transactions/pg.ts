/**
 * PgTransactions: a project's records in its own Postgres database (capability 1), in the tables
 * `record` (each record as it is now) and `record_event` (the append-only history).
 */
import type { Pool, PoolClient } from "pg";

import { check, editedRecord, historyEntry, now, numbered, savedRecord } from "./records.js";
import type {
  EditInput,
  HistoryEntry,
  HistoryFilter,
  RecordEnvelope,
  RetireInput,
  SaveInput,
  Transactions,
} from "./types.js";

const RECORD_COLUMNS = "id, type, version, fields, created_at, updated_at";

/**
 * The project's write lock, held until the transaction ends. Advisory locks belong to one
 * database, so this is per project: writes to one project take turns, writes to two do not.
 */
const WRITE_LOCK = "SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))";

interface RecordRow {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  seq: string; // bigint: pg hands it over as a string
  record_id: string;
  type: string;
  action: HistoryEntry["action"];
  record: RecordEnvelope;
  reason: string | null;
  actor: string | null;
  at: Date;
}

export class PgTransactions implements Transactions {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  save(input: SaveInput): Promise<RecordEnvelope> {
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      const record = savedRecord(await numberedIn(client, input), current, now());
      check(record, input.validate);
      await appendEvent(client, current === undefined ? "created" : "updated", record, record.updatedAt, input.actor);
      await putRecord(client, record);
      return record;
    });
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    const { rows } = await this.#pool.query<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM record WHERE id = $1`, [id]);
    const row = rows[0];
    return row === undefined ? null : recordOf(row);
  }

  async list(type: string): Promise<RecordEnvelope[]> {
    // COLLATE "C": code-point order, the same on every server whatever its default collation.
    const { rows } = await this.#pool.query<RecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM record WHERE type = $1 ORDER BY id COLLATE "C"`,
      [type],
    );
    return rows.map(recordOf);
  }

  edit(input: EditInput): Promise<RecordEnvelope | null> {
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      if (current === undefined) return null;
      const record = editedRecord(current, input.fields, now(), input.upgrade);
      check(record, input.validate);
      await appendEvent(client, "updated", record, record.updatedAt, input.actor);
      await putRecord(client, record);
      return record;
    });
  }

  retire(input: RetireInput): Promise<void> {
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      if (current === undefined) return;
      await appendEvent(client, "retired", current, now(), input.actor, input.reason);
      await client.query("DELETE FROM record WHERE id = $1", [input.id]);
    });
  }

  async history(filter: HistoryFilter = {}): Promise<HistoryEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.id !== undefined) {
      params.push(filter.id);
      conditions.push(`record_id = $${params.length}`);
    }
    if (filter.since !== undefined) {
      params.push(filter.since);
      conditions.push(`seq > $${params.length}`);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const { rows } = await this.#pool.query<EventRow>(
      `SELECT seq, record_id, type, action, record, reason, actor, at FROM record_event ${where} ORDER BY seq`,
      params,
    );
    return rows.map((row) =>
      historyEntry({
        seq: Number(row.seq),
        recordId: row.record_id,
        type: row.type,
        action: row.action,
        record: row.record,
        reason: row.reason,
        actor: row.actor,
        at: row.at.toISOString(),
      }),
    );
  }

  /**
   * Run one write as ONE SQL transaction on one connection. Any throw, from validate or from
   * Postgres, rolls the whole of it back, so a failed write leaves nothing behind. A connection
   * whose rollback fails is discarded rather than handed back to the pool.
   *
   * Every write first takes the project's write lock, so a project's writes happen one at a time,
   * as they do in the in-memory twin. The row lock alone (SELECT ... FOR UPDATE) is not enough:
   * - it cannot lock a record that does not exist yet, so two racing first saves of one id would
   *   both record "created" (contract 2.1);
   * - a history number is handed out when the entry is inserted, not when it commits. Two writes
   *   to different records could commit out of order, and a reader following along with `since`
   *   would miss the entry that committed late (2.8). One writer at a time makes seq order commit
   *   order.
   */
  async #write<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      await client.query(WRITE_LOCK);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }
}

/**
 * The record stored now, or undefined if there is none. Its row stays locked until the transaction
 * ends: the write lock already orders writes made through PgTransactions, and the row lock also
 * holds off any other writer of that row.
 */
async function lockCurrent(client: PoolClient, id: string): Promise<RecordEnvelope | undefined> {
  const { rows } = await client.query<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM record WHERE id = $1 FOR UPDATE`, [id]);
  const row = rows[0];
  return row === undefined ? undefined : recordOf(row);
}

/**
 * `input` numbered from every number its type's records have held, as the history keeps them. It
 * runs under the project's write lock, so no other write can take a number between this read and
 * the save's own write.
 */
async function numberedIn(client: PoolClient, input: SaveInput): Promise<SaveInput> {
  const field = input.sequence;
  if (field === undefined) return input;
  const { rows } = await client.query<{ highest: string }>(
    `SELECT COALESCE(MAX((record->'fields'->>$2::text)::numeric), 0) AS highest FROM record_event
     WHERE type = $1 AND jsonb_typeof(record->'fields'->$2::text) = 'number'`,
    [input.type, field],
  );
  const given = input.fields[field];
  let taken = false;
  if (typeof given === "number") {
    const found = await client.query(
      `SELECT 1 FROM record_event WHERE type = $1 AND record_id <> $3 AND record->'fields'->$2::text = to_jsonb($4::numeric) LIMIT 1`,
      [input.type, field, input.id, given],
    );
    taken = found.rows.length > 0;
  }
  return numbered(input, Number(rows[0]?.highest ?? 0), () => taken);
}

/** Write one change to the history: always first, before the record itself changes. */
async function appendEvent(
  client: PoolClient,
  action: HistoryEntry["action"],
  record: RecordEnvelope,
  at: string,
  actor: string | undefined,
  reason?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO record_event (record_id, type, action, record, reason, actor, at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [record.id, record.type, action, JSON.stringify(record), reason ?? null, actor ?? null, at],
  );
}

/** Store the record as it is now, replacing whatever row it had. */
async function putRecord(client: PoolClient, record: RecordEnvelope): Promise<void> {
  await client.query(
    `INSERT INTO record (${RECORD_COLUMNS}) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (id) DO UPDATE SET type = excluded.type, version = excluded.version, fields = excluded.fields,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
    [record.id, record.type, record.version, JSON.stringify(record.fields), record.createdAt, record.updatedAt],
  );
}

function recordOf(row: RecordRow): RecordEnvelope {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    fields: row.fields,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
