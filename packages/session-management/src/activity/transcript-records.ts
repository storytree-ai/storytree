// Capability 2 · Agent activity log
import type { Pool } from "pg";

export const TRANSCRIPT_SCHEMA_FILE = import.meta.url;

export const TRANSCRIPT_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS transcript_records (
    project text NOT NULL,
    session text NOT NULL,
    part    text NOT NULL,
    start   bigint NOT NULL,
    finish  bigint NOT NULL,
    at      timestamptz NOT NULL DEFAULT now(),
    record  text NOT NULL,
    PRIMARY KEY (project, session, part, start)
  )`,
  `CREATE INDEX IF NOT EXISTS transcript_records_at_idx ON transcript_records (at)`,
  `CREATE TABLE IF NOT EXISTS transcript_readings (
    project text NOT NULL,
    session text NOT NULL,
    at      timestamptz NOT NULL DEFAULT now(),
    reading jsonb NOT NULL,
    PRIMARY KEY (project, session)
  )`,
];

export interface TranscriptRecord {
  readonly part: string;
  readonly start: number;
  readonly finish: number;
  readonly record: string;
}

export interface StoredSession {
  readonly project: string;
  readonly session: string;
}

export interface StampedRecord {
  readonly session: string;
  readonly part: string;
  readonly at: Date;
  readonly record: string;
}

export interface TranscriptRecords {
  cursors(project: string, session: string): Promise<Map<string, number>>;
  store(project: string, session: string, records: readonly TranscriptRecord[]): Promise<void>;
  text(project: string, session: string, part?: string): Promise<string | undefined>;
  since(project: string, session: string, from: number, part?: string): Promise<{ records: string[]; finish: number }>;
  storedUpTo(project: string, upTo: Date, after?: Date): Promise<StampedRecord[]>;
  storedBefore(before: Date): Promise<StoredSession[]>;
  deleteBefore(before: Date): Promise<number>;
  keep(project: string, session: string, reading: unknown): Promise<void>;
  kept(project: string, session: string): Promise<unknown>;
}

export class PgTranscriptRecords implements TranscriptRecords {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async cursors(project: string, session: string): Promise<Map<string, number>> {
    const { rows } = await this.#pool.query<{ part: string; finish: string }>(
      "SELECT part, max(finish) AS finish FROM transcript_records WHERE project = $1 AND session = $2 GROUP BY part",
      [project, session],
    );
    return new Map(rows.map((row) => [row.part, Number(row.finish)]));
  }

  async store(project: string, session: string, records: readonly TranscriptRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#pool.query(
      `INSERT INTO transcript_records (project, session, part, start, finish, record)
        SELECT $1, $2, * FROM unnest($3::text[], $4::bigint[], $5::bigint[], $6::text[])
        ON CONFLICT DO NOTHING`,
      [project, session, records.map((one) => one.part), records.map((one) => one.start), records.map((one) => one.finish), records.map((one) => one.record)],
    );
  }

  async text(project: string, session: string, part = ""): Promise<string | undefined> {
    const { rows } = await this.#pool.query<{ record: string }>(
      "SELECT record FROM transcript_records WHERE project = $1 AND session = $2 AND part = $3 ORDER BY start",
      [project, session, part],
    );
    return rows.length === 0 ? undefined : rows.map((row) => row.record).join("\n");
  }

  async since(project: string, session: string, from: number, part = ""): Promise<{ records: string[]; finish: number }> {
    const { rows } = await this.#pool.query<{ record: string; finish: string }>(
      "SELECT record, finish FROM transcript_records WHERE project = $1 AND session = $2 AND part = $4 AND start >= $3 ORDER BY start",
      [project, session, from, part],
    );
    return { records: rows.map((row) => row.record), finish: rows.length === 0 ? from : Number(rows.at(-1)!.finish) };
  }

  async storedUpTo(project: string, upTo: Date, after?: Date): Promise<StampedRecord[]> {
    const { rows } = await this.#pool.query<StampedRecord>(
      `SELECT session, part, at, record FROM transcript_records t WHERE project = $1 AND at <= $2
        AND ($3::timestamptz IS NULL OR EXISTS (SELECT 1 FROM transcript_records n
          WHERE n.project = t.project AND n.session = t.session AND n.part = t.part AND n.at > $3 AND n.at <= $2))
        ORDER BY session, part, start`,
      [project, upTo, after ?? null],
    );
    return rows;
  }

  async storedBefore(before: Date): Promise<StoredSession[]> {
    const { rows } = await this.#pool.query<StoredSession>(
      "SELECT DISTINCT project, session FROM transcript_records WHERE at < $1 ORDER BY project, session",
      [before],
    );
    return rows;
  }

  async deleteBefore(before: Date): Promise<number> {
    return (await this.#pool.query("DELETE FROM transcript_records WHERE at < $1", [before])).rowCount ?? 0;
  }

  async keep(project: string, session: string, reading: unknown): Promise<void> {
    await this.#pool.query(
      `INSERT INTO transcript_readings (project, session, reading) VALUES ($1, $2, $3)
        ON CONFLICT (project, session) DO UPDATE SET reading = EXCLUDED.reading, at = now()`,
      [project, session, JSON.stringify(reading)],
    );
  }

  async kept(project: string, session: string): Promise<unknown> {
    const { rows } = await this.#pool.query<{ reading: unknown }>(
      "SELECT reading FROM transcript_readings WHERE project = $1 AND session = $2",
      [project, session],
    );
    return rows[0]?.reading;
  }
}
