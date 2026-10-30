/**
 * Capability 2 · Library transactions. PgTransactions: a project's records in its own Postgres database (capability 1), in the tables
 * `record` (each record as it is now) and `record_event` (the append-only history).
 */
import type { Pool, PoolClient } from "pg";

import { sqlState } from "../project/connection-error.js";
import { seconds, waitsOf } from "../project/server.js";
import { check, listFilter, editedRecord, historyEntry, historyFilter, now, numbered, outsideReadOf, revertedRecord, revertInput, revertReason, savedRecord, writesReverted, writtenBy } from "./records.js";
import type {
  EditInput,
  HistoryEntry,
  OutsideRead,
  HistoryFilter,
  ListFilter,
  RecordEnvelope,
  RetireInput,
  RevertedWrite,
  RevertInput,
  RevertWritesInput,
  SaveInput,
  Transactions,
} from "./types.js";

const RECORD_COLUMNS = "id, type, version, fields, created_at, updated_at";

/**
 * The project's write lock, held until the transaction ends. Advisory locks belong to one
 * database, so this is per project: writes to one project take turns, writes to two do not.
 */
export const WRITE_LOCK = "SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))";

/**
 * Take the project's write lock in `client`'s open transaction. When another session holds it, the
 * caller hears so once, and waits for it at most `pool`'s wait bound: past that, the write fails
 * with the server's reason, writing nothing (seen 2026-10-07: a close waited 13 minutes, silent,
 * on one connection to a full storytree-pg). The bound holds for every lock the transaction meets.
 */
export async function takeWriteLock(client: PoolClient, pool: Pool): Promise<void> {
  const { rows } = await client.query<{ taken: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('storytree.record-writes')) AS taken");
  if (rows[0]?.taken === true) return;
  const { waitMs, say } = waitsOf(pool);
  say(`another session is writing to this project; waiting up to ${seconds(waitMs)} for it to finish`);
  await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.round(waitMs))}`);
  try {
    await client.query(WRITE_LOCK);
  } catch (error) {
    if (sqlState(error) !== "55P03") throw error;
    throw new Error(`Another session kept writing to this project for ${seconds(waitMs)}, so nothing was written: ${(error as Error).message}. Try again.`, { cause: error });
  }
}

/**
 * Whether the project's history has its column for the outside-text mark (2.20). A shared library takes schema changes
 * only from merged code opened with its owner's rights, so code that knows the mark can meet a history without it: there
 * it writes and reads as before, the mark left off (2.21).
 */
export async function marksOutsideRead(on: Pool | PoolClient): Promise<boolean> {
  const { rows } = await on.query<{ marks: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'record_event' AND column_name = 'outside_read') AS marks`,
  );
  return rows[0]?.marks === true;
}

/** The history's columns, as `marks` says it has the mark's or not. */
function eventColumns(marks: boolean): string {
  return `seq, record_id, type, action, record, reason, actor, ${marks ? "outside_read" : "NULL::jsonb AS outside_read"}, at`;
}

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
  outside_read: string[] | null;
  at: Date;
}

export class PgTransactions implements Transactions {
  readonly #pool: Pool;
  /** Whether the history has the mark's column: looked up once, at the first write or history read. */
  #marks: Promise<boolean> | undefined;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  save(input: SaveInput): Promise<RecordEnvelope> {
    return this.#write(async (client) => {
      if (input.onlyIfNew) {
        const held = await client.query("SELECT 1 FROM record_event WHERE record_id = $1 AND type <> 'health' LIMIT 1", [input.id]);
        if (held.rows.length > 0) throw new RangeError(`${input.id} already exists in history; this setting can only be written once`);
      }
      const current = await lockCurrent(client, input.id);
      const record = savedRecord(await numberedIn(client, input), current, now());
      check(record, input.validate);
      await appendEvent(client, current === undefined ? "created" : "updated", record, record.updatedAt, input.actor, undefined, await this.#mark(input.outsideRead, record.type));
      await putRecord(client, record);
      return record;
    }, input.signal);
  }

  async get(id: string): Promise<RecordEnvelope | null> {
    const { rows } = await this.#pool.query<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM record WHERE id = $1`, [id]);
    const row = rows[0];
    return row === undefined ? null : recordOf(row);
  }

  async list(type: string | readonly string[], filter: ListFilter = {}): Promise<RecordEnvelope[]> {
    filter = listFilter(filter);
    const params: unknown[] = [type];
    const bind = (value: unknown): string => { params.push(value); return `$${params.length}`; };
    const clauses = [typeof type === "string" ? "type = $1" : "type = ANY($1::text[])"];
    if (filter.after !== undefined) clauses.push(`id COLLATE "C" > ${bind(filter.after)}`);
    if (filter.phrase !== undefined) {
      const text = bind(filter.phrase.text);
      const fields = filter.phrase.fields === undefined ? "" : ` AND key = ANY(${bind(filter.phrase.fields)}::text[])`;
      clauses.push(`EXISTS (SELECT 1 FROM jsonb_each(fields) WHERE jsonb_typeof(value) = 'string'
        AND strpos(value #>> '{}', ${text}) > 0${fields})`);
    }
    if (filter.ids !== undefined) clauses.push(`id = ANY(${bind(filter.ids)}::text[])`);
    for (const [matches, operator] of [[filter.where, "="], [filter.not, "IS DISTINCT FROM"]] as const) {
      for (const [path, value] of Object.entries(matches ?? {})) {
        clauses.push(`(fields #> ${bind(path.split("."))}::text[]) ${operator} ${bind(JSON.stringify(value))}::jsonb`);
      }
    }
    let columns = RECORD_COLUMNS;
    if (filter.projection !== undefined) {
      const version = bind(filter.projection.version);
      const names = bind(filter.projection.fields);
      columns = `id, type, version, CASE WHEN version = ${version} THEN
        (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(fields) WHERE key = ANY(${names}::text[]))
        ELSE fields END AS fields, created_at, updated_at`;
    }
    const limit = filter.limit === undefined ? "" : ` LIMIT ${bind(filter.limit)}`;
    // Every path, field name and value is bound; caller text never becomes SQL.
    const { rows } = await this.#pool.query<RecordRow>(
      `SELECT ${columns} FROM record WHERE ${clauses.join(" AND ")} ORDER BY id COLLATE "C"${limit}`, params,
    );
    return rows.map(recordOf);
  }

  edit(input: EditInput): Promise<RecordEnvelope | null> {
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      if (current === undefined) return null;
      const record = editedRecord(current, input.fields, now(), input.upgrade);
      if (input.sequence !== undefined) {
        record.fields = (await numberedIn(client, { ...record, sequence: input.sequence, sequenceNeverHeld: input.sequenceNeverHeld === true })).fields;
      }
      check(record, input.validate);
      await appendEvent(client, "updated", record, record.updatedAt, input.actor, input.reason, await this.#mark(input.outsideRead, record.type));
      await putRecord(client, record);
      return record;
    }, input.signal);
  }

  retire(input: RetireInput): Promise<void> {
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      if (current === undefined) return;
      await appendEvent(client, "retired", current, now(), input.actor, input.reason, await this.#mark(input.outsideRead, current.type));
      await client.query("DELETE FROM record WHERE id = $1", [input.id]);
    }, input.signal);
  }

  revert(given: RevertInput): Promise<RecordEnvelope> {
    const input = revertInput(given);
    return this.#write(async (client) => {
      const current = await lockCurrent(client, input.id);
      const { rows } = await client.query<{ action: HistoryEntry["action"]; record: RecordEnvelope; newest: string }>(
        `SELECT action, record, (SELECT MAX(seq) FROM record_event WHERE record_id = $1) AS newest
         FROM record_event WHERE record_id = $1 AND seq = $2`,
        [input.id, input.to],
      );
      const target = rows[0];
      const record = revertedRecord(input, target, target === undefined ? undefined : Number(target.newest), current, now());
      check(record, input.validate);
      await appendEvent(client, "updated", record, record.updatedAt, input.actor, revertReason(input), await this.#mark(input.outsideRead, record.type));
      await putRecord(client, record);
      return record;
    }, input.signal);
  }

  revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]> {
    return this.#write(async (client) => {
      const { rows } = await client.query<EventRow>(
        `SELECT ${eventColumns(await this.#marksIt())} FROM record_event
         WHERE record_id IN (SELECT record_id FROM record_event WHERE actor = $1 AND type <> 'health') ORDER BY seq`,
        [input.of],
      );
      const written = writtenBy(input.of, rows.map(entryOf));
      const current = new Map<string, RecordEnvelope>();
      for (const { id } of written) {
        const live = await lockCurrent(client, id);
        if (live !== undefined) current.set(id, live);
      }
      const at = now();
      const writes = writesReverted(input, written, (id) => current.get(id), at);
      for (const { reverted, record, reason } of writes) {
        await appendEvent(client, reverted.action, record, at, input.actor, reason);
        if (reverted.action === "retired") await client.query("DELETE FROM record WHERE id = $1", [record.id]);
        else await putRecord(client, record);
      }
      return writes.map(({ reverted }) => reverted);
    }, input.signal);
  }

  async history(given: HistoryFilter = {}): Promise<HistoryEntry[]> {
    const filter = historyFilter(given);
    const conditions: string[] = [];
    const params: unknown[] = [];
    const narrow = (condition: (param: string) => string, value: unknown) => {
      params.push(value);
      conditions.push(condition(`$${params.length}`));
    };
    if (filter.id !== undefined) narrow((param) => `record_id = ${param}`, filter.id);
    if (filter.since !== undefined) narrow((param) => `seq > ${param}`, filter.since);
    if (filter.actor !== undefined) narrow((param) => `actor = ${param}`, filter.actor);
    if (filter.from !== undefined) narrow((param) => `at >= ${param}::timestamptz`, filter.from);
    if (filter.types !== undefined) narrow((param) => `type = ANY(${param}::text[])`, filter.types);
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const columns = eventColumns(await this.#marksIt());
    // Only the changes kept leave the server: a limit is applied there, the newest read backwards and turned round.
    if (filter.oldest !== undefined) params.push(filter.oldest);
    if (filter.newest !== undefined) params.push(filter.newest);
    const query =
      filter.oldest !== undefined ? `SELECT ${columns} FROM record_event ${where} ORDER BY seq LIMIT $${params.length}`
      : filter.newest !== undefined ? `SELECT * FROM (SELECT ${columns} FROM record_event ${where} ORDER BY seq DESC LIMIT $${params.length}) AS newest ORDER BY seq`
      : `SELECT ${columns} FROM record_event ${where} ORDER BY seq`;
    const { rows } = await this.#pool.query<EventRow>(query, params);
    return rows.map(entryOf);
  }

  /** Whether the history has the mark's column, looked up once. */
  #marksIt(): Promise<boolean> {
    return (this.#marks ??= marksOutsideRead(this.#pool).catch((error: unknown) => {
      this.#marks = undefined;
      throw error;
    }));
  }

  /** The mark a write's entry keeps: none where the history has no place for it yet (2.21). */
  async #mark(outsideRead: OutsideRead | undefined, type: string): Promise<string[] | undefined> {
    const mark = outsideReadOf(outsideRead, type);
    return mark === undefined || !(await this.#marksIt()) ? undefined : mark;
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
  async #write<T>(work: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      await takeWriteLock(client, this.#pool);
      // Cancellation while queued writes nothing. Once admitted, finish the transaction and
      // its history normally: cancellation cannot undo a write that has already started.
      signal?.throwIfAborted();
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
  // Keep every non-health legacy reservation. RLS constrains the event type for health-only
  // writers, but permits arbitrary JSON fields, which cannot grant numbering authority.
  const { rows } = await client.query<{ highest: string }>(
    `SELECT COALESCE(MAX((record->'fields'->>$2::text)::numeric), 0) AS highest FROM record_event
     WHERE (CASE WHEN $3::boolean THEN type <> 'health' ELSE type = $1 END)
       AND jsonb_typeof(record->'fields'->$2::text) = 'number'`,
    [input.type, field, input.sequenceNeverHeld === true],
  );
  const given = input.fields[field];
  let taken = false;
  if (typeof given === "number") {
    const found = await client.query(
      `SELECT 1 FROM record_event
       WHERE (CASE WHEN $5::boolean THEN type <> 'health' ELSE type = $1 AND record_id <> $3 END)
         AND record->'fields'->$2::text = to_jsonb($4::numeric) LIMIT 1`,
      [input.type, field, input.id, given, input.sequenceNeverHeld === true],
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
  outsideRead?: string[],
): Promise<void> {
  // The mark's column is named only for a marked write, which the caller makes only where the history has it (2.21).
  const marked = outsideRead === undefined ? [] : [JSON.stringify(outsideRead)];
  await client.query(
    `INSERT INTO record_event (record_id, type, action, record, reason, actor, at${marked.length === 0 ? "" : ", outside_read"})
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7${marked.length === 0 ? "" : ", $8::jsonb"})`,
    [record.id, record.type, action, JSON.stringify(record), reason ?? null, actor ?? null, at, ...marked],
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

function entryOf(row: EventRow): HistoryEntry {
  return historyEntry({
    seq: Number(row.seq),
    recordId: row.record_id,
    type: row.type,
    action: row.action,
    record: row.record,
    reason: row.reason,
    actor: row.actor,
    outsideRead: row.outside_read,
    at: row.at.toISOString(),
  });
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
