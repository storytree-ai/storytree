// Capability 3 · Measure readings recorded on the box
import type { Storytree } from "@storytree/library";

export const MEASURE_READINGS_DATABASE = "storytree-measure-readings";

export const MEASURE_READINGS_SCHEMA: readonly string[] = [
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
  `CREATE TABLE IF NOT EXISTS measure_recordings (
    project      text NOT NULL,
    machine      text NOT NULL,
    commit       text NOT NULL,
    recorded_at  timestamptz NOT NULL,
    PRIMARY KEY (project, machine, commit)
  )`,
];

export interface MeasureReadingsDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

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

export function measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<MeasureReadingsDb> {
  return server.ownDatabase(MEASURE_READINGS_DATABASE, { tables: MEASURE_READINGS_SCHEMA, declaredIn: [import.meta.url] });
}

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

export async function measureSeries(db: MeasureReadingsDb, of: { readonly project: string; readonly story: string; readonly measure: string; readonly version: number }): Promise<MeasureReadingRow[]> {
  const { rows } = await db.query<Omit<MeasureReadingRow, "committed" | "readAt"> & { committed: Date; readAt: Date }>(
    `SELECT project, story, measure, version, value, unit, commit, committed, machine, runs, spread, read_at AS "readAt"
      FROM measure_readings WHERE project = $1 AND story = $2 AND measure = $3 AND version = $4
      ORDER BY committed, commit, machine`,
    [of.project, of.story, of.measure, of.version],
  );
  return rows.map((row) => ({ ...row, committed: row.committed.toISOString(), readAt: row.readAt.toISOString() }));
}
