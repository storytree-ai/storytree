/**
 * Transcript records in the shared log (ADR-0749 D3, D4): each session's transcript, one record per
 * line of its file, as its own machine's hooks stream it in, beside the activity log in the same
 * database. Records arrive already scrubbed; this only stores, reads and expires them, and keeps
 * what was worked out from a session's records once they expire.
 */
import type { Pool } from "pg";

/** The tables, appended to the activity log's schema. */
export const TRANSCRIPT_SCHEMA: readonly string[] = [
  // `part` is '' for the session's own transcript, or a subagent's id for that subagent's; `start` and
  // `finish` are the record's bytes in its file, so a record already stored is never stored twice.
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

/** One line of a transcript file, scrubbed, and the bytes it took in the file (its newline included). */
export interface TranscriptRecord {
  /** '' for the session's own transcript; a subagent's id for that subagent's. */
  readonly part: string;
  readonly start: number;
  readonly finish: number;
  readonly record: string;
}

/** A session, by the project it is logged under. */
export interface StoredSession {
  readonly project: string;
  readonly session: string;
}

/** The transcript records of every project's sessions. */
export interface TranscriptRecords {
  /** How far each part of a session's transcript is stored: the byte its next record starts at. */
  cursors(project: string, session: string): Promise<Map<string, number>>;
  /** Store records; one already stored at its place is left as it was. */
  store(project: string, session: string, records: readonly TranscriptRecord[]): Promise<void>;
  /** A part of a session's transcript as stored (by default its own), one record per line in file order; undefined when none is. */
  text(project: string, session: string, part?: string): Promise<string | undefined>;
  /** The sessions with a record stored before `before`. */
  storedBefore(before: Date): Promise<StoredSession[]>;
  /** Delete every record stored before `before`, and say how many went. */
  deleteBefore(before: Date): Promise<number>;
  /** Keep what was worked out from a session's records, to outlast them. */
  keep(project: string, session: string, reading: unknown): Promise<void>;
  /** What was kept for a session, or undefined. */
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
