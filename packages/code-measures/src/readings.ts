/**
 * Capability 3 · Measure readings recorded on the box (contract 3.1, ADR-1354 D3). Where they are kept: a database of
 * their own on the library's server (`storytree-measure-readings`), beside the projects, keyed by project. A reading is
 * one row per project, story, measure, version, origin/main commit and machine, and writing that key again replaces it,
 * so a recording run twice counts nothing twice. A series is one version's readings only, oldest commit first.
 */
import type { Storytree } from "@storytree/library";

/** The database the measure readings are kept in. */
export const MEASURE_READINGS_DATABASE = "storytree-measure-readings";

/** Its tables, in order, each idempotent; only ever appended to. */
export const MEASURE_READINGS_SCHEMA: readonly string[] = [
  // One row per reading: its value in its measure's unit, the commit's date, the runs it took and their spread (none for one).
  `CREATE TABLE IF NOT EXISTS measure_readings (
    project     text NOT NULL,
    story       text NOT NULL,
    measure     text NOT NULL,
    version     integer NOT NULL,
    commit      text NOT NULL,
    machine     text NOT NULL,
    value       double precision NOT NULL,
    unit        text NOT NULL,
    committed   timestamptz NOT NULL,
    runs        integer NOT NULL,
    spread      double precision,
    read_at     timestamptz NOT NULL,
    PRIMARY KEY (project, story, measure, version, commit, machine)
  )`,
  // One row per recording a machine made of a project, at the origin/main commit it read: once a head, once a day (3.2).
  `CREATE TABLE IF NOT EXISTS measure_recordings (
    project      text NOT NULL,
    machine      text NOT NULL,
    commit       text NOT NULL,
    recorded_at  timestamptz NOT NULL,
    PRIMARY KEY (project, machine, commit)
  )`,
];

/** What the readings are read and written through: the database's pool. */
export interface MeasureReadingsDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** One reading as the store keeps it; `committed` and `readAt` are ISO times. */
export interface MeasureReadingRow {
  readonly project: string;
  readonly story: string;
  readonly measure: string;
  readonly version: number;
  readonly value: number;
  readonly unit: string;
  readonly commit: string;
  readonly committed: string;
  readonly machine: string;
  readonly runs: number;
  readonly spread: number | null;
  readonly readAt: string;
}

/** The readings' database on `server`, its tables set up; a shared library takes them only once this file is merged. */
export function measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<MeasureReadingsDb> {
  return server.ownDatabase(MEASURE_READINGS_DATABASE, { tables: MEASURE_READINGS_SCHEMA, declaredIn: [import.meta.url] });
}

/** Write `rows`, each replacing any reading at its key. */
export async function writeReadings(db: MeasureReadingsDb, rows: readonly MeasureReadingRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `INSERT INTO measure_readings (project, story, measure, version, commit, machine, value, unit, committed, runs, spread, read_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (project, story, measure, version, commit, machine) DO UPDATE SET
          value = EXCLUDED.value, unit = EXCLUDED.unit, committed = EXCLUDED.committed, runs = EXCLUDED.runs,
          spread = EXCLUDED.spread, read_at = EXCLUDED.read_at`,
      [row.project, row.story, row.measure, row.version, row.commit, row.machine, row.value, row.unit, row.committed, row.runs, row.spread, row.readAt],
    );
  }
}

/** A story's readings of one measure at one version, oldest commit first (by its date), then by machine. */
export async function measureSeries(db: MeasureReadingsDb, of: { readonly project: string; readonly story: string; readonly measure: string; readonly version: number }): Promise<MeasureReadingRow[]> {
  const { rows } = await db.query<Omit<MeasureReadingRow, "committed" | "readAt"> & { committed: Date; readAt: Date }>(
    `SELECT project, story, measure, version, value, unit, commit, committed, machine, runs, spread, read_at AS "readAt"
      FROM measure_readings WHERE project = $1 AND story = $2 AND measure = $3 AND version = $4
      ORDER BY committed, commit, machine`,
    [of.project, of.story, of.measure, of.version],
  );
  return rows.map((row) => ({ ...row, committed: row.committed.toISOString(), readAt: row.readAt.toISOString() }));
}
