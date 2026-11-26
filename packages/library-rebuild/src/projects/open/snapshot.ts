// Capability 1 · Project libraries
import type { Pool } from "pg";

export interface SnapshotRecord {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotEvent {
  seq: number;
  recordId: string;
  type: string;
  action: "created" | "updated" | "retired";
  record: unknown;
  reason?: string;
  actor?: string;
  outsideRead?: string[];
  at: string;
}

export interface ProjectSnapshot {
  format: "storytree-project-snapshot";
  version: 1;
  project: string;
  takenAt: string;
  records: SnapshotRecord[];
  history: SnapshotEvent[];
}

export class RestoreRefusedError extends Error {
  override readonly name = "RestoreRefusedError";
  readonly project: string;

  constructor(project: string) {
    super(`a snapshot is restored only into an empty project, and "${project}" already holds records or history: nothing was written`);
    this.project = project;
  }
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
  seq: string;
  record_id: string;
  type: string;
  action: SnapshotEvent["action"];
  record: unknown;
  reason: string | null;
  actor: string | null;
  outside_read?: string[] | null;
  at: Date;
}

export async function takeSnapshot(pool: Pool, project: string): Promise<ProjectSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const takenAt = (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0]!.now.toISOString();
    const records = (await client.query<RecordRow>('SELECT * FROM record ORDER BY id COLLATE "C"')).rows.map((row) => ({
      id: row.id,
      type: row.type,
      version: row.version,
      fields: row.fields,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
    const history = (await client.query<EventRow>("SELECT * FROM record_event ORDER BY seq")).rows.map((row): SnapshotEvent => ({
      seq: Number(row.seq),
      recordId: row.record_id,
      type: row.type,
      action: row.action,
      record: row.record,
      ...(row.reason === null ? {} : { reason: row.reason }),
      ...(row.actor === null ? {} : { actor: row.actor }),
      ...(row.outside_read === null || row.outside_read === undefined ? {} : { outsideRead: row.outside_read }),
      at: row.at.toISOString(),
    }));
    return { format: "storytree-project-snapshot", version: 1, project, takenAt, records, history };
  } finally {
    client.release();
  }
}

export async function restoreSnapshot(pool: Pool, project: string, snapshot: ProjectSnapshot): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      const { rows } = await client.query<{ held: boolean }>("SELECT EXISTS (SELECT 1 FROM record) OR EXISTS (SELECT 1 FROM record_event) AS held");
      if (rows[0]!.held) throw new RestoreRefusedError(project);
      for (const record of snapshot.records) {
        await client.query(
          "INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [record.id, record.type, record.version, JSON.stringify(record.fields), record.createdAt, record.updatedAt],
        );
      }
      for (const event of snapshot.history) {
        await client.query(
          "INSERT INTO record_event (seq, record_id, type, action, record, reason, actor, outside_read, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [event.seq, event.recordId, event.type, event.action, JSON.stringify(event.record), event.reason ?? null, event.actor ?? null,
            event.outsideRead === undefined ? null : JSON.stringify(event.outsideRead), event.at],
        );
      }
      await client.query("SELECT setval(pg_get_serial_sequence('record_event', 'seq'), max(seq)) FROM record_event HAVING count(*) > 0");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
