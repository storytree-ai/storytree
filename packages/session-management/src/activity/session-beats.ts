// Capability 2 · Agent activity log
import type { Pool } from "pg";

import type { Beat } from "../readings.js";

export const BEATS_SCHEMA_FILE = import.meta.url;

export const BEATS_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_beats (
    project  text NOT NULL,
    session  text NOT NULL,
    beat_at  timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    PRIMARY KEY (project, session)
  )`,
  `ALTER TABLE session_beats ADD COLUMN IF NOT EXISTS lane boolean NOT NULL DEFAULT false`,
];

export interface SessionBeats {
  beat(project: string, session: string, options?: { ended?: boolean; lane?: boolean }): Promise<void>;
  of(project: string, sessions: readonly string[]): Promise<Map<string, Beat>>;
}

interface Queries {
  query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
}

export class PgSessionBeats implements SessionBeats {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async beat(project: string, session: string, options: { ended?: boolean; lane?: boolean } = {}): Promise<void> {
    await this.#pool.query(
      `INSERT INTO session_beats (project, session, ended_at, lane) VALUES ($1, $2, CASE WHEN $3 THEN now() END, $4)
        ON CONFLICT (project, session) DO UPDATE SET beat_at = now(), ended_at = EXCLUDED.ended_at, lane = EXCLUDED.lane`,
      [project, session, options.ended === true, options.lane === true],
    );
  }

  of(project: string, sessions: readonly string[]): Promise<Map<string, Beat>> {
    return beatsOf(this.#pool, project, sessions);
  }
}

export async function beatsOf(db: Queries, project: string, sessions: readonly string[]): Promise<Map<string, Beat>> {
  if (sessions.length === 0) return new Map();
  const { rows } = await db.query<{ session: string; beat_at: Date; ended_at: Date | null; lane: boolean }>(
    "SELECT session, beat_at, ended_at, lane FROM session_beats WHERE project = $1 AND session = ANY($2::text[])",
    [project, sessions],
  );
  return new Map(rows.map((row) => [row.session, {
    at: row.beat_at.toISOString(),
    ...(row.ended_at === null ? {} : { ended: row.ended_at.toISOString() }),
    ...(row.lane ? { lane: true as const } : {}),
  }]));
}
