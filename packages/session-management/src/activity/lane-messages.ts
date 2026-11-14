/**
 * Capability 2 · Agent activity log. Messages waiting for a running pool lane (contract 4.49, increment_783a63fe5b16): queued
 * against the lane's session beside the log, in the same database, and taken by its hooks, each once. A row is marked taken in
 * the statement that hands it over, so two hooks taking at the same moment never both deliver one message; and a take given the
 * time its hook stops waiting finishes before it or takes nothing, so no message is marked taken that the hook never handed on.
 */
import type { Pool } from "pg";

/** The file declaring LANE_MESSAGES_SCHEMA, which a shared library reads for being merged before it takes the table. */
export const LANE_MESSAGES_SCHEMA_FILE = import.meta.url;

/** The table, appended to the activity log's schema. */
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
];

/** How long before a take's deadline its statement must finish: the answer's way back to the hook. */
export const TAKE_MARGIN_MS = 500;

/** How a message reaches the lane's model: after its current tool call (steer), or when it would end its turn (follow-up). */
export type QueuedMode = "steer" | "follow-up";

/** Where the lane is when it takes its messages: at a tool call's end, which takes steers, or at its turn's end, which takes all. */
export type TakenAt = "tool" | "stop";

/** One message for a lane, as it was sent. */
export interface LaneMessage {
  readonly session: string;
  readonly increment: string;
  readonly mode: QueuedMode;
  readonly text: string;
  /** The session that sent it. */
  readonly sender: string;
  /** When it was sent, ISO 8601. */
  readonly sent: string;
}

/** The messages waiting for every project's lanes. */
export interface LaneMessages {
  /** Queue `message` for its lane's session. */
  queue(project: string, message: Omit<LaneMessage, "sent">): Promise<void>;
  /**
   * Take the messages waiting for `session` that its place `at` delivers, in the order sent: each is taken once. Given `before`
   * (ms since the epoch), when the taker stops waiting, it takes them only if it finishes TAKE_MARGIN_MS before then, else none.
   */
  take(project: string, session: string, at: TakenAt, before?: number): Promise<LaneMessage[]>;
}

/** A message's row, as a take hands it back. */
interface Row {
  id: string; // bigint: pg hands it over as a string
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

  async take(project: string, session: string, at: TakenAt, before?: number): Promise<LaneMessage[]> {
    const modes: readonly QueuedMode[] = at === "tool" ? ["steer"] : ["steer", "follow-up"];
    const left = before === undefined ? undefined : Math.floor(before - Date.now() - TAKE_MARGIN_MS);
    if (left !== undefined && left <= 0) return [];
    const client = await this.#pool.connect();
    let rows: Row[];
    try {
      await client.query("BEGIN");
      // Past the taker's deadline the statement is cancelled and rolled back: the messages stay waiting.
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
