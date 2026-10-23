/**
 * Capability 27 · Fixed data questions (the library story): a few questions about the library's data, each one fixed
 * SQL over the project's own tables, so an answer comes back in milliseconds and nothing a caller writes reaches
 * Postgres but a bound value. How many records of each kind and status, and open increments by arc; the latest changes,
 * read by the change log's sequence number (its primary key), never by its unindexed timestamp; the records whose title
 * holds a word starting with each word given; a decision by its number. Health readings are left out of every answer,
 * and no answer holds more than ANSWER_ROWS rows.
 *
 * They read the project's own rows: a product project's records inherited from its factory (ADR-1040 D4) are not
 * among them, and an increment stored on the retired ready step (ADR-0909 D4) counts as the proposal it reads as.
 */
import type { Pool } from "pg";

/** The most rows any answer holds. */
export const ANSWER_ROWS = 20;

/** One kind's live records: how many, and how many in each status, for the kinds that have one. */
export interface KindCount {
  readonly kind: string;
  readonly count: number;
  readonly statuses: readonly { readonly status: string; readonly count: number }[];
}

/** What counts() gives: each kind, and the arcs with the most open increments. */
export interface Counts {
  readonly kinds: readonly KindCount[];
  readonly openByArc: readonly { readonly arc: string; readonly title: string | null; readonly open: number }[];
}

/** One change, newest first in latestChanges(). */
export interface RecentChange {
  readonly seq: number;
  readonly at: string;
  readonly action: string;
  readonly type: string;
  readonly id: string;
  readonly title: string | null;
}

/** A record found by its title or number. */
export interface TitleHit {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
}

/** A record's title: its title, or a definition's term. */
const TITLE = "coalesce(fields->>'title', fields->>'term')";

/** The status a kind keeps, in the field it keeps it in; other kinds have none. */
const STATUS = `CASE type
  WHEN 'increment' THEN CASE fields->>'status' WHEN 'ready' THEN 'proposal' ELSE fields->>'status' END
  WHEN 'question' THEN fields->>'lifecycle'
  WHEN 'decision' THEN fields->>'status'
  WHEN 'friction' THEN fields->>'state'
END`;

/** `words` as Postgres regular expressions, each matching a word that starts with it, its own specials escaped. */
function patterns(words: readonly string[]): string[] {
  return words.map((word) => `\\m${word.replace(/[\\^$.|?*+()[\]{}]/g, (character) => `\\${character}`)}`);
}

/** The fixed data questions, over one project's database. */
export class DataQuestions {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** Every kind's live records, by status where it keeps one, and the ANSWER_ROWS arcs with the most open increments. */
  async counts(): Promise<Counts> {
    const [byStatus, byArc] = await Promise.all([
      this.#pool.query<{ type: string; status: string | null; count: string }>(
        `SELECT type, ${STATUS} AS status, count(*) AS count FROM record WHERE type <> 'health' GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2`,
      ),
      this.#pool.query<{ arc: string; title: string | null; open: string }>(
        `SELECT i.fields->>'arc' AS arc, a.fields->>'title' AS title, count(*) AS open
           FROM record i LEFT JOIN record a ON a.id = i.fields->>'arc'
          WHERE i.type = 'increment' AND i.fields->>'status' <> 'closed'
          GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT ${ANSWER_ROWS}`,
      ),
    ]);
    const kinds = new Map<string, { count: number; statuses: { status: string; count: number }[] }>();
    for (const row of byStatus.rows) {
      const kind = kinds.get(row.type) ?? { count: 0, statuses: [] };
      kind.count += Number(row.count);
      if (row.status !== null) kind.statuses.push({ status: row.status, count: Number(row.count) });
      kinds.set(row.type, kind);
    }
    return {
      kinds: [...kinds].map(([kind, { count, statuses }]) => ({ kind, count, statuses })),
      openByArc: byArc.rows.map((row) => ({ arc: row.arc, title: row.title, open: Number(row.open) })),
    };
  }

  /** The latest `limit` changes (ANSWER_ROWS at most), newest first by sequence number, health readings left out. */
  async latestChanges(limit = ANSWER_ROWS): Promise<RecentChange[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > ANSWER_ROWS) throw new RangeError(`latest changes come ${ANSWER_ROWS} at most, and at least 1; not ${limit}`);
    const { rows } = await this.#pool.query<{ seq: string; at: Date; action: string; type: string; id: string; title: string | null }>(
      `SELECT seq, at, action, type, record_id AS id, coalesce(record->'fields'->>'title', record->'fields'->>'term') AS title
         FROM record_event WHERE type <> 'health' ORDER BY seq DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({ seq: Number(row.seq), at: row.at.toISOString(), action: row.action, type: row.type, id: row.id, title: row.title }));
  }

  /** The live records whose title has a word starting with each of `words`, any case, most recently changed first; ANSWER_ROWS at most. */
  async findByTitle(words: readonly string[]): Promise<TitleHit[]> {
    if (words.length === 0) return [];
    const { rows } = await this.#pool.query<TitleHit>(
      `SELECT id, type, ${TITLE} AS title FROM record
        WHERE type <> 'health' AND ${TITLE} ~* ALL($1::text[])
        ORDER BY updated_at DESC, id LIMIT ${ANSWER_ROWS}`,
      [patterns(words)],
    );
    return rows;
  }

  /** The live decision holding `number`, or null. */
  async decisionNumbered(number: number): Promise<TitleHit | null> {
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const { rows } = await this.#pool.query<TitleHit>(
      `SELECT id, type, ${TITLE} AS title FROM record WHERE type = 'decision' AND fields->'number' = to_jsonb($1::bigint)`,
      [number],
    );
    return rows[0] ?? null;
  }
}
