// Capability 1 · Project libraries
import { createHash } from "node:crypto";

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

export interface SnapshotMedia {
  recordId: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  addedAt: string;
  addedBy?: string;
  bytes: string;
}

export interface ProjectSnapshot {
  format: "storytree-project-snapshot";
  version: 1;
  project: string;
  takenAt: string;
  records: SnapshotRecord[];
  history: SnapshotEvent[];
  media?: SnapshotMedia[];
}

export class RestoreRefusedError extends Error {
  override name = "RestoreRefusedError";
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

interface MediaRow {
  record_id: string;
  name: string;
  type: string;
  size: string;
  sha256: string;
  added_at: Date;
  added_by: string | null;
  bytes: Buffer;
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
    const media = (await client.query<MediaRow>('SELECT * FROM media ORDER BY record_id COLLATE "C", name COLLATE "C"')).rows.map((row): SnapshotMedia => ({
      recordId: row.record_id,
      name: row.name,
      type: row.type,
      size: Number(row.size),
      sha256: row.sha256,
      addedAt: row.added_at.toISOString(),
      ...(row.added_by === null ? {} : { addedBy: row.added_by }),
      bytes: row.bytes.toString("base64"),
    }));
    await client.query("COMMIT");
    return { format: "storytree-project-snapshot", version: 1, project, takenAt, records, history, media };
  } finally {
    client.release();
  }
}

export async function restoreSnapshot(pool: Pool, project: string, snapshot: ProjectSnapshot): Promise<void> {
  const files = (snapshot.media ?? []).map((file) => {
    const bytes = Buffer.from(file.bytes, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error(`the snapshot's ${file.name} on ${file.recordId} does not match its SHA-256, so nothing was restored`);
    }
    return { ...file, bytes };
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      const { rows } = await client.query<{ held: boolean }>("SELECT EXISTS (SELECT 1 FROM record) OR EXISTS (SELECT 1 FROM record_event) OR EXISTS (SELECT 1 FROM media) AS held");
      if (rows[0]!.held) throw new RestoreRefusedError(project);
      await client.query(
        `INSERT INTO record (id, type, version, fields, created_at, updated_at)
         SELECT id, type, version, fields, "createdAt", "updatedAt"
         FROM jsonb_to_recordset($1::jsonb) AS given(id text, type text, version int, fields jsonb, "createdAt" timestamptz, "updatedAt" timestamptz)`,
        [JSON.stringify(snapshot.records)],
      );
      await client.query(
        `INSERT INTO record_event (seq, record_id, type, action, record, reason, actor, outside_read, at)
         SELECT seq, "recordId", type, action, record, reason, actor, "outsideRead", at
         FROM jsonb_to_recordset($1::jsonb) AS given(seq bigint, "recordId" text, type text, action text, record jsonb, reason text, actor text, "outsideRead" jsonb, at timestamptz)`,
        [JSON.stringify(snapshot.history)],
      );
      for (const file of files) {
        await client.query(
          "INSERT INTO media (record_id, name, type, size, sha256, added_at, added_by, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [file.recordId, file.name, file.type, file.size, file.sha256, file.addedAt, file.addedBy ?? null, file.bytes],
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
