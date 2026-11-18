// Capability 1 · Project libraries
import { createHash } from "node:crypto";
import type { Pool } from "pg";

import { marksOutsideRead, takeWriteLock } from "../transactions/index.js";

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
  seq: string;
  record_id: string;
  type: string;
  action: SnapshotEvent["action"];
  record: unknown;
  reason: string | null;
  actor: string | null;
  outside_read: string[] | null;
  at: string;
}

interface MediaRow {
  record_id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  added_at: string;
  added_by: string | null;
  bytes: string;
}

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
      const outsideRead = (await marksOutsideRead(client)) ? "outside_read" : "NULL::jsonb AS outside_read";
      const events = await client.query<EventRow>(
        `SELECT seq, record_id, type, action, record, reason, actor, ${outsideRead}, to_json(at) #>> '{}' AS at
           FROM record_event ORDER BY seq`,
      );
      const media = (await client.query<{ held: boolean }>("SELECT to_regclass('media') IS NOT NULL AS held")).rows[0]?.held === true
        ? (await client.query<MediaRow>(
          `SELECT record_id, name, type, size, sha256, to_json(added_at) #>> '{}' AS added_at, added_by, encode(bytes, 'base64') AS bytes
             FROM media ORDER BY record_id COLLATE "C", name COLLATE "C"`,
        )).rows
        : [];
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
          ...(row.outside_read === null ? {} : { outsideRead: row.outside_read }),
          at: row.at,
        })),
        ...(media.length === 0 ? {} : {
          media: media.map((row) => ({
            recordId: row.record_id, name: row.name, type: row.type, size: row.size, sha256: row.sha256, addedAt: row.added_at,
            ...(row.added_by === null ? {} : { addedBy: row.added_by }),
            bytes: row.bytes.replaceAll("\n", ""),
          })),
        }),
      };
    } finally {
      await client.query("COMMIT");
    }
  } finally {
    client.release();
  }
}

export async function writeSnapshot(pool: Pool, project: string, snapshot: ProjectSnapshot): Promise<void> {
  if (snapshot?.format !== "storytree-project-snapshot" || snapshot.version !== 1) {
    throw new Error("This is not a storytree project snapshot this library can restore (storytree-project-snapshot, version 1).");
  }
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await takeWriteLock(client, pool);
    const held = await client.query<{ held: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM record) OR EXISTS (SELECT 1 FROM record_event) OR EXISTS (SELECT 1 FROM media) AS held",
    );
    if (held.rows[0]?.held === true) throw new RestoreRefusedError(project);
    for (const batch of batches(snapshot.records)) {
      await client.query(
        `INSERT INTO record (id, type, version, fields, created_at, updated_at)
         SELECT id, type, version, fields, created_at, updated_at
           FROM jsonb_to_recordset($1::jsonb)
             AS r(id text, type text, version int, fields jsonb, created_at timestamptz, updated_at timestamptz)`,
        [JSON.stringify(batch.map((record) => ({
          id: record.id, type: record.type, version: record.version, fields: record.fields, created_at: record.createdAt, updated_at: record.updatedAt,
        })))],
      );
    }
    for (const batch of batches(snapshot.history)) {
      await client.query(
        `INSERT INTO record_event (seq, record_id, type, action, record, reason, actor, outside_read, at)
         SELECT seq, record_id, type, action, record, reason, actor, outside_read, at
           FROM jsonb_to_recordset($1::jsonb)
             AS e(seq bigint, record_id text, type text, action text, record jsonb, reason text, actor text, outside_read jsonb, at timestamptz)`,
        [JSON.stringify(batch.map((event) => ({
          seq: event.seq, record_id: event.recordId, type: event.type, action: event.action, record: event.record,
          reason: event.reason ?? null, actor: event.actor ?? null, outside_read: event.outsideRead ?? null, at: event.at,
        })))],
      );
    }
    for (const file of snapshot.media ?? []) {
      const bytes = Buffer.from(file.bytes, "base64");
      if (bytes.length !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error(`The snapshot's ${file.name} beside ${file.recordId} is not the file its SHA-256 and size say it is, so nothing was restored.`);
      }
      await client.query(
        "INSERT INTO media (record_id, name, type, size, sha256, bytes, added_at, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [file.recordId, file.name, file.type, file.size, file.sha256, bytes, file.addedAt, file.addedBy ?? null],
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

const RESTORE_BATCH = 500;

function* batches<T>(rows: readonly T[]): Generator<readonly T[]> {
  for (let at = 0; at < rows.length; at += RESTORE_BATCH) yield rows.slice(at, at + RESTORE_BATCH);
}
