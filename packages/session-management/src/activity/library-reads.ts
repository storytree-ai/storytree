/**
 * Capability 2 · Agent activity log. What the library's readers pulled from it (contract 2.15, increment_28a5cea44ef7):
 * the bytes each process's library connections counted per reader (`@storytree/library/reads`), kept beside the log in
 * the same database as one total per machine, reader and UTC day, added to by every process that records, never a
 * line per statement, so the table grows with readers and days, not with reads.
 */
import { atEnd, giveBackReads, takeReads } from "@storytree/library/reads";
import type { Pool } from "pg";

/** The file declaring READS_SCHEMA, which a shared library reads for being merged before it takes the table. */
export const READS_SCHEMA_FILE = import.meta.url;

/** The table, appended to the activity log's schema. */
export const READS_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS library_reads (
    day        date NOT NULL,
    machine    text NOT NULL,
    reader     text NOT NULL,
    bytes      bigint NOT NULL,
    statements bigint NOT NULL,
    PRIMARY KEY (day, machine, reader)
  )`,
];

/** One machine's reader's total on one day. */
export interface DayRead {
  /** The UTC day, YYYY-MM-DD. */
  readonly day: string;
  readonly machine: string;
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

/** What the library's readers read, per machine, reader and day. */
export interface LibraryReads {
  /** Add what this process's connections read since the last record to today's totals for this log's machine. */
  record(): Promise<void>;
  /** Every machine's readers' totals on `day` (YYYY-MM-DD, UTC), by machine and then the most bytes first. */
  day(day: string): Promise<DayRead[]>;
}

/** How often a log left open records what was read (a tool server runs for hours): an unrecorded total dies with its process. */
const RECORD_EVERY_MS = 5 * 60_000;

export class PgLibraryReads implements LibraryReads {
  readonly #pool: Pool;
  readonly #machine: string;
  readonly #timer: NodeJS.Timeout;

  constructor(pool: Pool, machine: string) {
    this.#pool = pool;
    this.#machine = machine;
    this.#timer = setInterval(() => void this.record().catch(() => {}), RECORD_EVERY_MS);
    this.#timer.unref();
    // What is left is recorded as the log's pool ends, however its closer and this log's close are ordered.
    atEnd(pool, () => this.record());
  }

  async record(): Promise<void> {
    const totals = takeReads();
    if (totals.length === 0) return;
    try {
      await this.#pool.query(
        `INSERT INTO library_reads (day, machine, reader, bytes, statements)
          SELECT (now() AT TIME ZONE 'UTC')::date, $1, reader, bytes, statements
            FROM unnest($2::text[], $3::bigint[], $4::bigint[]) AS t(reader, bytes, statements)
          ON CONFLICT (day, machine, reader) DO UPDATE
            SET bytes = library_reads.bytes + EXCLUDED.bytes, statements = library_reads.statements + EXCLUDED.statements`,
        [this.#machine, totals.map((t) => t.reader), totals.map((t) => t.bytes), totals.map((t) => t.statements)],
      );
    } catch (error) {
      giveBackReads(totals);
      throw error;
    }
  }

  async day(day: string): Promise<DayRead[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new RangeError(`a day is YYYY-MM-DD, not ${JSON.stringify(day)}`);
    const { rows } = await this.#pool.query<{ machine: string; reader: string; bytes: string; statements: string }>(
      "SELECT machine, reader, bytes, statements FROM library_reads WHERE day = $1::date ORDER BY machine, bytes DESC, reader",
      [day],
    );
    return rows.map((row) => ({ day, machine: row.machine, reader: row.reader, bytes: Number(row.bytes), statements: Number(row.statements) }));
  }

  /** Stop recording on a timer: what is left is recorded as the pool ends. */
  close(): void {
    clearInterval(this.#timer);
  }
}
