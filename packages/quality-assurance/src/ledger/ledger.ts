/**
 * Capability 3 · QA ledger: the record of what quality control finds (ADR-0956 D4), in this story's own
 * tables in the library's Postgres, reached through the library's connection (ADR-0964 D2, ADR-0973).
 *
 * - Every review records, for each check it ran and each package the change touches, that the check ran
 *   there, and each hit it made (file and line); the implementer later answers each hit, fixed or
 *   rejected with a reason.
 * - Every row names its project, and a project reads only its own.
 * - It only records: nothing here samples, reduces or retires a check (ADR-0956 D6).
 */
import type { Storytree } from "@storytree/library";

/** The database the ledger lives in, beside the projects' libraries on the same server. */
export const LEDGER_DATABASE = "storytree-quality";

type Pool = Awaited<ReturnType<Storytree["ownDatabase"]>>;

/** The ledger's tables, as idempotent statements the library applies once per connection, in order. Later changes are appended. */
const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS quality_runs (
    project  text NOT NULL,
    review   text NOT NULL,
    check_id text NOT NULL,
    package  text NOT NULL,
    at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project, review, check_id, package)
  )`,
  `CREATE TABLE IF NOT EXISTS quality_hits (
    id          bigserial PRIMARY KEY,
    project     text NOT NULL,
    review      text NOT NULL,
    check_id    text NOT NULL,
    package     text NOT NULL,
    file        text NOT NULL,
    line        integer NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    answer      text CHECK (answer IN ('fixed', 'rejected')),
    reason      text,
    answered_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS quality_hits_project_idx ON quality_hits (project, check_id, package)`,
];

/** Where a check found something: a line of a file in one package. */
export interface Hit {
  readonly package: string;
  readonly file: string;
  readonly line: number;
}

/** One review, as it is recorded: the packages the change touches, and each check it ran with its hits. */
export interface Review {
  readonly project: string;
  readonly review: string;
  readonly packages: readonly string[];
  readonly ran: readonly { readonly check: string; readonly hits: readonly Hit[] }[];
}

/** The implementer's answer to a hit (contract 3.2). */
export type Answer = { readonly answer: "fixed" } | { readonly answer: "rejected"; readonly reason: string };

/** A check's run in one package, as the ledger keeps it. */
export interface RunRow {
  readonly project: string;
  readonly review: string;
  readonly check: string;
  readonly package: string;
  readonly at: string;
}

/** A hit as the ledger keeps it; `answer` is unanswered until the implementer answers it. */
export interface HitRow extends Hit {
  readonly id: number;
  readonly project: string;
  readonly review: string;
  readonly check: string;
  readonly at: string;
  readonly answer: "fixed" | "rejected" | "unanswered";
  readonly reason?: string;
}

/** One line of the reading: a check in one package, how many reviews ran it there, and its hits by answer. */
export interface Count {
  readonly check: string;
  readonly package: string;
  readonly reviews: number;
  readonly hits: number;
  readonly fixed: number;
  readonly rejected: number;
  readonly unanswered: number;
}

/** The QA ledger on one Postgres server: one table set, every project's rows, each project reading its own. */
export interface Ledger {
  /** Record one review whole, or nothing of it; answers its hits as kept, in the order given, with the ids answers name. */
  record(review: Review): Promise<{ hits: HitRow[] }>;
  /** Record the implementer's answer on `project`'s hit `id`; a rejection needs a reason, and an unknown hit is refused. */
  answer(project: string, id: number, answer: Answer): Promise<void>;
  /** `project`'s rows as kept, runs and hits, oldest first. */
  rows(project: string): Promise<{ runs: RunRow[]; hits: HitRow[] }>;
  /** `project`'s counts per check per package, by check then package (contract 3.3). */
  reading(project: string): Promise<Count[]>;
}

/** Open the ledger on `server`'s connection: its own database, set up with the ledger's tables, closed with the connection. */
export async function openLedger(server: Storytree): Promise<Ledger> {
  return new PgLedger(await server.ownDatabase(LEDGER_DATABASE, { tables: SCHEMA }));
}

/**
 * Delete `project`'s runs and hits from the ledger on `server` (ADR-0831): deleting a project deletes its
 * records, and these are its records in the shared ledger, so a later project of the same name starts
 * with an empty ledger. Both tables go together, or neither.
 */
export async function forgetProjectQuality(server: Storytree, project: string): Promise<void> {
  assertName("project", project);
  const client = await (await server.ownDatabase(LEDGER_DATABASE, { tables: SCHEMA })).connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    for (const table of ["quality_runs", "quality_hits"]) await client.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
    await client.query("COMMIT");
  } catch (error) {
    broken = true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(broken);
  }
}

interface HitRecord {
  id: string; // bigint: pg hands it over as a string
  project: string;
  review: string;
  check_id: string;
  package: string;
  file: string;
  line: number;
  at: Date;
  answer: "fixed" | "rejected" | null;
  reason: string | null;
}

const HIT_COLUMNS = "id, project, review, check_id, package, file, line, at, answer, reason";

function hitRow(row: HitRecord): HitRow {
  return {
    id: Number(row.id), project: row.project, review: row.review, check: row.check_id, package: row.package,
    file: row.file, line: row.line, at: row.at.toISOString(), answer: row.answer ?? "unanswered",
    ...(row.reason === null ? {} : { reason: row.reason }),
  };
}

class PgLedger implements Ledger {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async record(review: Review): Promise<{ hits: HitRow[] }> {
    assertName("project", review.project);
    assertName("review", review.review);
    if (review.packages.length === 0) throw new Error("A review names at least one package the change touches.");
    for (const name of review.packages) assertName("package", name);
    for (const { check, hits } of review.ran) {
      assertName("check", check);
      for (const hit of hits) {
        if (!review.packages.includes(hit.package)) throw new Error(`Check ${check} hit ${hit.file} in package "${hit.package}", which the review does not name among the packages the change touches.`);
        assertName("file", hit.file);
        if (!Number.isInteger(hit.line) || hit.line < 1) throw new Error(`A hit's line is a whole number from 1, not ${hit.line}.`);
      }
    }
    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const hits: HitRow[] = [];
      for (const { check, hits: found } of review.ran) {
        for (const name of review.packages) {
          await client.query("INSERT INTO quality_runs (project, review, check_id, package) VALUES ($1, $2, $3, $4)", [review.project, review.review, check, name]);
        }
        for (const hit of found) {
          const { rows } = await client.query<HitRecord>(
            `INSERT INTO quality_hits (project, review, check_id, package, file, line) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${HIT_COLUMNS}`,
            [review.project, review.review, check, hit.package, hit.file, hit.line],
          );
          hits.push(hitRow(rows[0]!));
        }
      }
      await client.query("COMMIT");
      return { hits };
    } catch (error) {
      broken = true;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async answer(project: string, id: number, answer: Answer): Promise<void> {
    const reason = answer.answer === "rejected" ? answer.reason.trim() : null;
    if (answer.answer === "rejected" && reason === "") throw new Error("A rejected hit needs its reason.");
    const { rowCount } = await this.#pool.query(
      "UPDATE quality_hits SET answer = $3, reason = $4, answered_at = now() WHERE project = $1 AND id = $2",
      [project, id, answer.answer, reason],
    );
    if (rowCount === 0) throw new Error(`The ledger holds no hit ${id} in project "${project}".`);
  }

  async rows(project: string): Promise<{ runs: RunRow[]; hits: HitRow[] }> {
    const runs = await this.#pool.query<{ project: string; review: string; check_id: string; package: string; at: Date }>(
      "SELECT project, review, check_id, package, at FROM quality_runs WHERE project = $1 ORDER BY at, review, check_id, package",
      [project],
    );
    const hits = await this.#pool.query<HitRecord>(`SELECT ${HIT_COLUMNS} FROM quality_hits WHERE project = $1 ORDER BY id`, [project]);
    return {
      runs: runs.rows.map((row) => ({ project: row.project, review: row.review, check: row.check_id, package: row.package, at: row.at.toISOString() })),
      hits: hits.rows.map(hitRow),
    };
  }

  async reading(project: string): Promise<Count[]> {
    const { rows } = await this.#pool.query<{ check_id: string; package: string; reviews: number; hits: number; fixed: number; rejected: number; unanswered: number }>(
      `SELECT r.check_id, r.package, r.reviews,
              coalesce(h.hits, 0)::int AS hits, coalesce(h.fixed, 0)::int AS fixed,
              coalesce(h.rejected, 0)::int AS rejected, coalesce(h.unanswered, 0)::int AS unanswered
         FROM (SELECT check_id, package, count(DISTINCT review)::int AS reviews FROM quality_runs WHERE project = $1 GROUP BY check_id, package) r
         LEFT JOIN (SELECT check_id, package, count(*) AS hits,
                           count(*) FILTER (WHERE answer = 'fixed') AS fixed,
                           count(*) FILTER (WHERE answer = 'rejected') AS rejected,
                           count(*) FILTER (WHERE answer IS NULL) AS unanswered
                      FROM quality_hits WHERE project = $1 GROUP BY check_id, package) h
           ON h.check_id = r.check_id AND h.package = r.package
        ORDER BY r.check_id, r.package`,
      [project],
    );
    return rows.map((row) => ({ check: row.check_id, package: row.package, reviews: row.reviews, hits: row.hits, fixed: row.fixed, rejected: row.rejected, unanswered: row.unanswered }));
  }
}

/** The reading as the plain text both front doors answer with. */
export function ledgerText(reading: readonly Count[]): string {
  if (reading.length === 0) return "The QA ledger holds no review in this project.";
  return [
    "QA ledger: per check and package, reviews that ran it, and its hits (fixed, rejected, unanswered):",
    ...reading.map((count) => `  ${count.check}  ${count.package}  ran ${count.reviews}, ${count.hits === 0 ? "no hits" : `${count.hits} hit${count.hits === 1 ? "" : "s"} (${count.fixed} fixed, ${count.rejected} rejected, ${count.unanswered} unanswered)`}`),
  ].join("\n");
}

function assertName(what: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`A review's ${what} is named, not empty.`);
}
