/**
 * Capability 2 · Agent activity log. Sessions' heartbeats (ADR-1056 D3): the latest beat of each session whose harness keeps
 * one (Claude Code's mod, from its own timer), and when it said the session ended, beside the activity log in the same
 * database. One row per session, overwritten at each beat, so the beats never grow the log the claims reading folds.
 */
import type { Pool } from "pg";

import type { Beat } from "../readings.js";

/** The table, appended to the activity log's schema. */
export const BEATS_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_beats (
    project  text NOT NULL,
    session  text NOT NULL,
    beat_at  timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    PRIMARY KEY (project, session)
  )`,
];

/** The heartbeats of every project's sessions. */
export interface SessionBeats {
  /** `session` of `project` beats now, by the database's clock; with `ended`, it says it ended now. A beat after an end opens it again. */
  beat(project: string, session: string, options?: { ended?: boolean }): Promise<void>;
  /** The latest beat of each of `sessions` that has one. */
  of(project: string, sessions: readonly string[]): Promise<Map<string, Beat>>;
}

/** The beat statement and the read, for a pool or a client holding the project's lock alike. */
interface Queries {
  query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
}

export class PgSessionBeats implements SessionBeats {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async beat(project: string, session: string, options: { ended?: boolean } = {}): Promise<void> {
    await this.#pool.query(
      `INSERT INTO session_beats (project, session, ended_at) VALUES ($1, $2, CASE WHEN $3 THEN now() END)
        ON CONFLICT (project, session) DO UPDATE SET beat_at = now(), ended_at = EXCLUDED.ended_at`,
      [project, session, options.ended === true],
    );
  }

  of(project: string, sessions: readonly string[]): Promise<Map<string, Beat>> {
    return beatsOf(this.#pool, project, sessions);
  }
}

/** The latest beat of each of `sessions` of `project` that has one, read through `db`. */
export async function beatsOf(db: Queries, project: string, sessions: readonly string[]): Promise<Map<string, Beat>> {
  if (sessions.length === 0) return new Map();
  const { rows } = await db.query<{ session: string; beat_at: Date; ended_at: Date | null }>(
    "SELECT session, beat_at, ended_at FROM session_beats WHERE project = $1 AND session = ANY($2::text[])",
    [project, sessions],
  );
  return new Map(rows.map((row) => [row.session, { at: row.beat_at.toISOString(), ...(row.ended_at === null ? {} : { ended: row.ended_at.toISOString() }) }]));
}
