// Capability 2 · Agent activity log
import { atEnd, giveBackReads, takeReads } from "@storytree/library/reads";
import type { Pool } from "pg";

export const READS_SCHEMA_FILE = import.meta.url;

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

export interface DayRead {
  readonly day: string;
  readonly machine: string;
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

export interface LibraryReads {
  record(): Promise<void>;
  day(day: string): Promise<DayRead[]>;
}

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

  close(): void {
    clearInterval(this.#timer);
  }
}
