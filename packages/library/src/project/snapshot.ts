/**
 * A project's snapshot (capability 1, contracts 1.6 to 1.8; ADR-0641 D2 step 4, choice B1): its
 * tables as plain data, the backup of a library that is the only copy of its plan.
 */
import type { Pool } from "pg";

import { WRITE_LOCK } from "../transactions/pg.js";

/** A record as it is now: a row of the project's `record` table. */
export interface SnapshotRecord {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** One entry of the project's append-only history: a row of its `record_event` table. */
export interface SnapshotEvent {
  seq: number;
  recordId: string;
  type: string;
  action: "created" | "updated" | "retired";
  record: unknown;
  reason?: string;
  actor?: string;
  at: string;
}

/** Every record of a project and its whole history, as they stood at one moment. Plain data. */
export interface ProjectSnapshot {
  format: "storytree-project-snapshot";
  version: 1;
  project: string;
  takenAt: string;
  records: SnapshotRecord[];
  history: SnapshotEvent[];
}

/** A restore into a project that already holds records or history, refused so that no live edit is overwritten. */
export class RestoreRefusedError extends Error {
  readonly project: string;

  constructor(project: string) {
    super(
      `The project "${project}" already holds records or history, so a snapshot is not restored into it: ` +
        "a restore goes only into an empty project, so that it never overwrites live edits.",
    );
    this.name = "RestoreRefusedError";
    this.project = project;
  }
}

interface RecordRow {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  seq: string; // bigint: pg hands it over as a string
  record_id: string;
  type: string;
  action: SnapshotEvent["action"];
  record: unknown;
  reason: string | null;
  actor: string | null;
  at: string;
}

/**
 * Read `pool`'s project as a snapshot, in one read-only transaction that sees a single moment, so a
 * write landing meanwhile is either wholly in it or wholly out. Times are read as Postgres writes
 * them, to the microsecond, so a restore gives them back exactly.
 */
export async function readSnapshot(pool: Pool, project: string): Promise<ProjectSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const records = await client.query<RecordRow>(
        `SELECT id, type, version, fields,
                to_json(created_at) #>> '{}' AS created_at, to_json(updated_at) #>> '{}' AS updated_at
           FROM record ORDER BY id COLLATE "C"`,
      );
      const events = await client.query<EventRow>(
        `SELECT seq, record_id, type, action, record, reason, actor, to_json(at) #>> '{}' AS at
           FROM record_event ORDER BY seq`,
      );
      return {
        format: "storytree-project-snapshot",
        version: 1,
        project,
        takenAt: new Date().toISOString(),
        records: records.rows.map((row) => ({
          id: row.id,
          type: row.type,
          version: row.version,
          fields: row.fields,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        history: events.rows.map((row) => ({
          seq: Number(row.seq),
          recordId: row.record_id,
          type: row.type,
          action: row.action,
          record: row.record,
          ...(row.reason === null ? {} : { reason: row.reason }),
          ...(row.actor === null ? {} : { actor: row.actor }),
          at: row.at,
        })),
      };
    } finally {
      await client.query("COMMIT");
    }
  } finally {
    client.release();
  }
}

/**
 * Write `snapshot` into `pool`'s project, which must hold no record and no history. Under the
 * project's write lock it checks, then writes every record and history entry as they were (the
 * history keeping its sequence numbers), and moves the history's numbering past the last one, all
 * in one transaction. A project that is not empty is refused (RestoreRefusedError), writing nothing.
 */
export async function writeSnapshot(pool: Pool, project: string, snapshot: ProjectSnapshot): Promise<void> {
  if (snapshot?.format !== "storytree-project-snapshot" || snapshot.version !== 1) {
    throw new Error("This is not a storytree project snapshot this library can restore (storytree-project-snapshot, version 1).");
  }
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query(WRITE_LOCK);
    const held = await client.query<{ held: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM record) OR EXISTS (SELECT 1 FROM record_event) AS held",
    );
    if (held.rows[0]?.held === true) throw new RestoreRefusedError(project);
    for (const record of snapshot.records) {
      await client.query(
        `INSERT INTO record (id, type, version, fields, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)`,
        [record.id, record.type, record.version, JSON.stringify(record.fields), record.createdAt, record.updatedAt],
      );
    }
    for (const event of snapshot.history) {
      await client.query(
        `INSERT INTO record_event (seq, record_id, type, action, record, reason, actor, at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz)`,
        [event.seq, event.recordId, event.type, event.action, JSON.stringify(event.record), event.reason ?? null, event.actor ?? null, event.at],
      );
    }
    if (snapshot.history.length > 0) {
      await client.query("SELECT setval(pg_get_serial_sequence('record_event', 'seq'), (SELECT max(seq) FROM record_event))");
    }
    await client.query("COMMIT");
  } catch (error) {
    failed = !(error instanceof RestoreRefusedError);
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(failed);
  }
}
