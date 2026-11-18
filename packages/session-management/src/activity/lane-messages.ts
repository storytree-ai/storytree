// Capability 2 · Agent activity log
import type { Pool } from "pg";

export const LANE_MESSAGES_SCHEMA_FILE = import.meta.url;

export const LANE_MESSAGES_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS lane_messages (
    id        bigserial PRIMARY KEY,
    project   text NOT NULL,
    session   text NOT NULL,
    increment text NOT NULL,
    mode      text NOT NULL,
    text      text NOT NULL,
    sender    text NOT NULL,
    sent_at   timestamptz NOT NULL DEFAULT now(),
    taken_at  timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS lane_messages_waiting_idx ON lane_messages (project, session, id) WHERE taken_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS lane_sessions (
    project   text NOT NULL,
    session   text NOT NULL,
    marked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project, session)
  )`,
];

export const TAKE_MARGIN_MS = 500;

export type QueuedMode = "steer" | "follow-up";

export type TakenAt = "tool" | "stop";

export interface LaneMessage {
  readonly session: string;
  readonly increment: string;
  readonly mode: QueuedMode;
  readonly text: string;
  readonly sender: string;
  readonly sent: string;
}

export interface LaneMessages {
  queue(project: string, message: Omit<LaneMessage, "sent">): Promise<void>;
  take(project: string, session: string, at: TakenAt, before?: number): Promise<LaneMessage[]>;
  mark(project: string, session: string): Promise<void>;
  marked(project: string, session: string): Promise<boolean>;
}

interface Row {
  id: string;
  session: string;
  increment: string;
  mode: QueuedMode;
  text: string;
  sender: string;
  sent_at: Date;
}

export class PgLaneMessages implements LaneMessages {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async queue(project: string, { session, increment, mode, text, sender }: Omit<LaneMessage, "sent">): Promise<void> {
    await this.#pool.query(
      "INSERT INTO lane_messages (project, session, increment, mode, text, sender) VALUES ($1, $2, $3, $4, $5, $6)",
      [project, session, increment, mode, text, sender],
    );
  }

  async mark(project: string, session: string): Promise<void> {
    await this.#pool.query("INSERT INTO lane_sessions (project, session) VALUES ($1, $2) ON CONFLICT (project, session) DO NOTHING", [project, session]);
  }

  async marked(project: string, session: string): Promise<boolean> {
    const { rows } = await this.#pool.query("SELECT 1 FROM lane_sessions WHERE project = $1 AND session = $2", [project, session]);
    return rows.length > 0;
  }

  async take(project: string, session: string, at: TakenAt, before?: number): Promise<LaneMessage[]> {
    const modes: readonly QueuedMode[] = at === "tool" ? ["steer"] : ["steer", "follow-up"];
    const left = before === undefined ? undefined : Math.floor(before - Date.now() - TAKE_MARGIN_MS);
    if (left !== undefined && left <= 0) return [];
    const client = await this.#pool.connect();
    let rows: Row[];
    try {
      await client.query("BEGIN");
      if (left !== undefined) await client.query(`SET LOCAL statement_timeout = ${left}`);
      ({ rows } = await client.query<Row>(
        `UPDATE lane_messages SET taken_at = now()
          WHERE id IN (SELECT id FROM lane_messages
                        WHERE project = $1 AND session = $2 AND taken_at IS NULL AND mode = ANY($3::text[])
                        FOR UPDATE SKIP LOCKED)
            AND taken_at IS NULL
          RETURNING id, session, increment, mode, text, sender, sent_at`,
        [project, session, modes],
      ));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return rows
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((row) => ({ session: row.session, increment: row.increment, mode: row.mode, text: row.text, sender: row.sender, sent: row.sent_at.toISOString() }));
  }
}
