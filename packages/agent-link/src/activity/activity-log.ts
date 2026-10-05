/**
 * Capability 2 · Agent activity log (the agent link story): the agent link's own logbook of what
 * agents do, one per project, kept beside the library rather than in it (ADR-0626 D2). Lines are
 * only ever added, and are read back in order as "everything since line N", including lines other
 * processes wrote.
 *
 * - It lives in its own database, `storytree-activity`, on the same Postgres server as the
 *   projects' libraries: never in a project's database, so the library's records and change feed
 *   never see it. The library lists as projects only databases named `storytree_<name>`, so this
 *   one, with a hyphen, is never mistaken for a project.
 * - One table holds every project's lines, and a project reads only its own. A line's number comes
 *   from one sequence shared by all projects, so a project's numbers rise but skip.
 * - A project's writes take turns on a lock, so its lines commit in the order they are numbered:
 *   a reader passing back each cursor it is handed never misses a line that committed late, nor
 *   reads one twice.
 * - There is no way to change or delete a line.
 */
import { hostname } from "node:os";

import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { Storytree } from "@storytree/library";

import { BRANCH_FACTS, countValues, FOLD_LINES, foldValues, inViewValues, MAIN_WORK, selectLines, SESSION_COUNT, SESSIONS_IN_VIEW, STANDING_CLAIMS, STATE_LINES, stateValues, type LineFilter } from "./bounded.js";
import { NEW_LINE, type Line, type LineKind, type LinesSince, type NewLine } from "./lines.js";
import { PgTranscriptRecords, TRANSCRIPT_SCHEMA, type TranscriptRecords } from "./transcript-records.js";

/** The database the log lives in, on the same server as the projects' libraries. */
export const ACTIVITY_DATABASE = "storytree-activity";

/** The agent activity log on one Postgres server: one log per project, only ever added to until the project is deleted. */
export interface ActivityLog {
  /** Add a line to `project`'s log, and return it as the log keeps it. A line that is not one the log knows is refused. */
  append(project: string, line: NewLine, options?: AppendOptions): Promise<Line>;
  /**
   * `project`'s lines after `cursor`, oldest first, and the cursor to pass next time. Start from 0
   * only for a reader that keeps what it read and asks again from its cursor (the app's): a reader
   * that asks once asks for what it needs, with `lines`.
   */
  since(project: string, cursor: number): Promise<LinesSince>;
  /** `project`'s lines that `filter` asks for, oldest first, narrowed on the server (contract 2.7). */
  lines(project: string, filter: LineFilter): Promise<Line[]>;
  /** The claim lines that decide who holds what in `project` now: ended claims send nothing (bounded.ts STANDING_CLAIMS). */
  standing(project: string): Promise<Line[]>;
  /** When each of `sessions`, or of every session of `project` when none are named, last wrote a line. */
  lastSeen(project: string, sessions?: readonly string[]): Promise<Map<string, string>>;
  /**
   * The lines the sessions fold needs for `sessions`, read as it reads their whole history; a
   * command started before `commandsSince` (ISO 8601) is past any limit, so its text is not sent
   * (bounded.ts FOLD_LINES).
   */
  foldLines(project: string, sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  /** The lines that decide the state alone of each session that wrote since `activeSince`, read as foldLines reads (bounded.ts STATE_LINES). */
  stateLines(project: string, activeSince: string, commandsSince: string): Promise<Line[]>;
  /** The sessions the running-sessions list may show, judged from `since` (bounded.ts SESSIONS_IN_VIEW); the holders of claims are not among them unless they are otherwise. */
  sessionsInView(project: string, since: string): Promise<string[]>;
  /** How many sessions have written a line of their own to `project`'s log. */
  sessionCount(project: string): Promise<number>;
  /** The branches worth a look from `machine`, with what the log knows of each (bounded.ts BRANCH_FACTS). */
  branchFacts(project: string, machine: string | undefined): Promise<BranchFacts[]>;
  /** The folders on the main line worth a look on `machine`, with when each was last worked in (bounded.ts MAIN_WORK). */
  mainWork(project: string, machine: string | undefined): Promise<{ folder: string; at: string }[]>;
  /**
   * Run `work` holding `project`'s lock: what it reads through the LockedLog it is handed, and any
   * line it adds, happen with no other write to the project in between. It is how a claim checks
   * who holds a capability and takes it in one step (capability 5).
   */
  locked<T>(project: string, work: (log: LockedLog) => Promise<T>): Promise<T>;
  /** Sessions' transcripts as their hooks streamed them in, scrubbed (ADR-0749 D3): kept beside the lines, on the same connection. */
  readonly transcripts: TranscriptRecords;
  /** Close the log's connections. */
  close(): Promise<void>;
}

/** A branch the project's lines name, as BRANCH_FACTS reads it: when it was first and last worked on, where this machine last worked on it, and its latest state line. */
export interface BranchFacts {
  readonly branch: string;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly folder?: string;
  readonly state?: Line & { kind: "branch-state" };
}

/** How a line written earlier elsewhere, and only now reaching the log, is added (a hook's queued line). */
export interface AppendOptions {
  /** When it was written, rather than now: an ISO 8601 time. */
  readonly at?: string;
  /** Add it only if the project has no line exactly like it, at that time: an upload tried twice adds it once. */
  readonly once?: boolean;
}

/** One project's log, as a locked write sees it. */
export interface LockedLog {
  /** The project's lines that `filter` asks for, or of `kinds`, oldest first (ActivityLog.lines). */
  lines(filter: LineFilter | readonly LineKind[]): Promise<Line[]>;
  /** The claim lines that decide who holds what now (ActivityLog.standing). */
  standing(): Promise<Line[]>;
  /** When each of `sessions`, or of every session when none are named, last wrote a line. */
  lastSeen(sessions?: readonly string[]): Promise<Map<string, string>>;
  /** The time by the database's clock, which stamps every line. */
  now(): Promise<Date>;
  /** Add a line, as ActivityLog.append does. */
  append(line: NewLine): Promise<Line>;
}

export interface OpenOptions {
  /** How long a connection to the server may take before the attempt is given up. By default, 5 s. */
  readonly connectTimeoutMs?: number;
  /** The machine this log is written from: every line it adds that names no machine names this one. By default, none. */
  readonly machine?: string;
  /** The git branch a folder on this machine is on (ADR-0754 D4): every line it adds that names a folder and no branch names this one. By default, none. */
  readonly branchOf?: (folder: string) => string | undefined;
}

/** This machine's name, as lines record it: its host name, trimmed; undefined when it has none. */
export function thisMachine(): string | undefined {
  return hostname().trim() || undefined;
}

/** The log's tables, as idempotent statements applied in order at every open. Later changes are appended. */
const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS activity (
    seq     bigserial PRIMARY KEY,
    project text NOT NULL,
    at      timestamptz NOT NULL DEFAULT now(),
    session text NOT NULL,
    harness text,
    source  text NOT NULL,
    kind    text NOT NULL,
    folder  text,
    detail  jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS activity_project_seq_idx ON activity (project, seq)`,
  // Bounded reads (contract 2.7) narrow by kind, by session and by time.
  `CREATE INDEX IF NOT EXISTS activity_project_kind_seq_idx ON activity (project, kind, seq)`,
  `CREATE INDEX IF NOT EXISTS activity_project_session_seq_idx ON activity (project, session, seq)`,
  `CREATE INDEX IF NOT EXISTS activity_project_at_idx ON activity (project, at)`,
  ...TRANSCRIPT_SCHEMA,
];

/** The fields every line has its own column for; the rest of a line is its `detail`. */
const COLUMNS = ["session", "harness", "source", "kind", "folder"] as const;

interface ActivityRow {
  seq: string; // bigint: pg hands it over as a string
  project: string;
  at: Date;
  session: string;
  harness: string | null;
  source: string;
  kind: string;
  folder: string | null;
  detail: Record<string, unknown>;
}

/**
 * Open the agent activity log where `server` is: the database of its own that a library connection
 * hands out (contract 2.5, ADR-0735 D3), on whatever server the library resolved to, local or Cloud
 * SQL; or the Postgres server at a postgres:// URL. From a connection, the log's pool is the
 * connection's, and closes with it.
 *
 * At a URL, the log opens on the server there (its own database
 * is used only to create the log's, the first time). The log's database and table are made if
 * they are missing.
 *
 * The log's database is connected to straight away, which is one connection when it exists. When
 * it does not, Postgres refuses (invalid_catalog_name), and on Windows it sometimes resets the
 * connection before its refusal arrives (seen as ECONNRESET, or as EPIPE when the reset beats the
 * client's first write). Either way the database is made if it is missing, from
 * the server's own, and the log's is tried once more.
 */
export async function openActivityLog(server: string | Storytree, options: OpenOptions = {}): Promise<ActivityLog> {
  if (typeof server !== "string") {
    const pool = await server.ownDatabase(ACTIVITY_DATABASE);
    await applySchema(pool);
    return new PgActivityLog(pool, options.machine, false, options.branchOf);
  }
  return openAtUrl(new URL(server), options);
}

/**
 * Delete `project`'s lines and transcripts from the log on `server` (ADR-0831): deleting a project
 * deletes its records, and these are its records in the shared log, so a later project of the same
 * name starts with no old claims, sessions or lines. Held under the project's lock, as a write is.
 */
export async function forgetProjectActivity(server: Storytree, project: string): Promise<void> {
  assertProject(project);
  const pool = await server.ownDatabase(ACTIVITY_DATABASE);
  await applySchema(pool);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.activity'), hashtext($1))", [project]);
    for (const table of ["activity", "transcript_records", "transcript_readings"]) await client.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

async function openAtUrl(server: URL, options: OpenOptions): Promise<ActivityLog> {
  const timeout = options.connectTimeoutMs ?? 5_000;
  const first = newPool(databaseUrl(server, ACTIVITY_DATABASE), timeout);
  try {
    await applySchema(first);
    return new PgActivityLog(first, options.machine, true, options.branchOf);
  } catch (error) {
    await first.end();
    if (!isMissingDatabase(error) && !isConnectionReset(error)) throw error;
  }
  await createDatabaseIfMissing(server, timeout);
  const pool = newPool(databaseUrl(server, ACTIVITY_DATABASE), timeout);
  try {
    await applySchema(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return new PgActivityLog(pool, options.machine, true, options.branchOf);
}

class PgActivityLog implements ActivityLog {
  readonly #pool: Pool;
  readonly #machine: string | undefined;
  readonly #branchOf: ((folder: string) => string | undefined) | undefined;
  #closing: Promise<void> | undefined;

  readonly #ownsPool: boolean;

  /** `ownsPool` false: the pool is a library connection's, which ends it. */
  readonly transcripts: TranscriptRecords;

  constructor(pool: Pool, machine: string | undefined, ownsPool = true, branchOf?: (folder: string) => string | undefined) {
    this.#pool = pool;
    this.#machine = machine;
    this.#branchOf = branchOf;
    this.#ownsPool = ownsPool;
    this.transcripts = new PgTranscriptRecords(pool);
  }

  async append(project: string, line: NewLine, options: AppendOptions = {}): Promise<Line> {
    assertProject(project);
    const parsed = parseLine(this.#stamped(line));
    if (options.at !== undefined && Number.isNaN(Date.parse(options.at))) throw new RangeError(`a line's time must be an ISO 8601 time, not ${JSON.stringify(options.at)}`);
    return this.#write(project, (client) => insert(client, project, parsed, options));
  }

  async since(project: string, cursor: number): Promise<LinesSince> {
    assertProject(project);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError(`since takes a cursor: 0 to read from the start, or a line's number (a whole number, 0 or more), not ${String(cursor)}`);
    }
    const { rows } = await this.#pool.query<ActivityRow>(
      `SELECT seq, project, at, ${COLUMNS.join(", ")}, detail FROM activity WHERE project = $1 AND seq > $2 ORDER BY seq`,
      [project, cursor],
    );
    const lines = rows.map(lineOf);
    return { lines, cursor: lines.at(-1)?.seq ?? cursor };
  }

  async lines(project: string, filter: LineFilter): Promise<Line[]> {
    assertProject(project);
    return readLines(this.#pool, project, filter);
  }

  async standing(project: string): Promise<Line[]> {
    assertProject(project);
    return (await this.#pool.query<ActivityRow>(STANDING_CLAIMS, [project])).rows.map(lineOf);
  }

  async lastSeen(project: string, sessions?: readonly string[]): Promise<Map<string, string>> {
    assertProject(project);
    return lastSeenIn(this.#pool, project, sessions);
  }

  async foldLines(project: string, sessions: readonly string[], commandsSince: string): Promise<Line[]> {
    assertProject(project);
    if (sessions.length === 0) return [];
    return (await this.#pool.query<ActivityRow>(FOLD_LINES, foldValues(project, sessions, commandsSince))).rows.map(lineOf);
  }

  async stateLines(project: string, activeSince: string, commandsSince: string): Promise<Line[]> {
    assertProject(project);
    return (await this.#pool.query<ActivityRow>(STATE_LINES, stateValues(project, activeSince, commandsSince))).rows.map(lineOf);
  }

  async sessionsInView(project: string, since: string): Promise<string[]> {
    assertProject(project);
    return (await this.#pool.query<{ session: string }>(SESSIONS_IN_VIEW, inViewValues(project, since))).rows.map((row) => row.session);
  }

  async branchFacts(project: string, machine: string | undefined): Promise<BranchFacts[]> {
    assertProject(project);
    const { rows } = await this.#pool.query<Partial<ActivityRow> & { branch: string; first_seq: string; first_at: Date; last_at: Date; worked_in: string | null }>(BRANCH_FACTS, [project, machine ?? null]);
    return rows.map(({ branch, first_seq: _first, first_at, last_at, worked_in, ...state }) => ({
      branch,
      firstAt: first_at.toISOString(),
      lastAt: last_at.toISOString(),
      ...(worked_in === null ? {} : { folder: worked_in }),
      ...(state.seq === null || state.seq === undefined ? {} : { state: lineOf(state as ActivityRow) as Line & { kind: "branch-state" } }),
    }));
  }

  async mainWork(project: string, machine: string | undefined): Promise<{ folder: string; at: string }[]> {
    assertProject(project);
    const { rows } = await this.#pool.query<{ folder: string; at: Date }>(MAIN_WORK, [project, machine ?? null]);
    return rows.map(({ folder, at }) => ({ folder, at: at.toISOString() }));
  }

  async sessionCount(project: string): Promise<number> {
    assertProject(project);
    return Number((await this.#pool.query<{ count: string }>(SESSION_COUNT, countValues(project))).rows[0]?.count ?? 0);
  }

  locked<T>(project: string, work: (log: LockedLog) => Promise<T>): Promise<T> {
    assertProject(project);
    return this.#write(project, (client) =>
      work({
        lines: (filter) => readLines(client, project, Array.isArray(filter) ? { kinds: filter as readonly LineKind[] } : (filter as LineFilter)),
        standing: async () => (await client.query<ActivityRow>(STANDING_CLAIMS, [project])).rows.map(lineOf),
        lastSeen: (sessions) => lastSeenIn(client, project, sessions),
        now: async () => (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0]!.now,
        append: (line) => insert(client, project, parseLine(this.#stamped(line))),
      }),
    );
  }

  /** `line`, naming this log's machine when it names none, and its folder's branch when it names a folder and no branch. */
  #stamped(line: NewLine): NewLine {
    const machine = line.machine !== undefined || this.#machine === undefined ? line : { ...line, machine: this.#machine };
    const branch = line.branch !== undefined || line.folder === undefined ? undefined : this.#branchOf?.(line.folder);
    return branch === undefined ? machine : { ...machine, branch };
  }

  close(): Promise<void> {
    this.#closing ??= this.#ownsPool ? this.#pool.end() : Promise.resolve();
    return this.#closing;
  }

  /**
   * Run one write as one transaction, holding `project`'s lock until it commits: the project's
   * writes take turns, so they commit in the order their lines are numbered. Writes for other
   * projects do not wait.
   */
  async #write<T>(project: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.activity'), hashtext($1))", [project]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }
}

/** What runs a query: the log's pool, or the client a locked write holds. */
type Queryable = Pool | PoolClient;

/** `project`'s lines that `filter` asks for, oldest first. */
async function readLines(on: Queryable, project: string, filter: LineFilter): Promise<Line[]> {
  const { text, values } = selectLines(project, filter);
  const lines = (await on.query<ActivityRow>(text, values)).rows.map(lineOf);
  return filter.newest === undefined ? lines : lines.reverse();
}

/** When each of `sessions`, or of every session, last wrote a line to `project`'s log. */
async function lastSeenIn(on: Queryable, project: string, sessions: readonly string[] | undefined): Promise<Map<string, string>> {
  if (sessions !== undefined && sessions.length === 0) return new Map();
  const { rows } = await on.query<{ session: string; at: Date }>(
    "SELECT session, max(at) AS at FROM activity WHERE project = $1 AND ($2::text[] IS NULL OR session = ANY($2)) GROUP BY session",
    [project, sessions === undefined ? null : [...sessions]],
  );
  return new Map(rows.map((row) => [row.session, row.at.toISOString()]));
}

/** `line`, checked against the kinds of line the log knows: anything else is refused, naming what is wrong. */
function parseLine(line: NewLine): NewLine {
  const parsed = NEW_LINE.safeParse(line);
  if (!parsed.success) throw new Error(`the activity log refused a line: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Add `line` to `project`'s log on `client`, inside a transaction holding the project's lock. */
async function insert(client: PoolClient, project: string, line: NewLine, { at, once = false }: AppendOptions = {}): Promise<Line> {
  // A cause is an earlier line of this project's log: a dangling one is refused, never healed (0.2 inc-74).
  if (line.causedBy !== undefined) {
    const { rowCount } = await client.query("SELECT 1 FROM activity WHERE project = $1 AND seq = $2", [project, line.causedBy]);
    if (rowCount === 0) throw new Error(`the activity log refused a line: its cause, line ${line.causedBy}, is not a line of ${project}'s log`);
  }
  const { session, harness, source, kind, folder, ...detail } = line;
  const values = [project, session, harness ?? null, source, kind, folder ?? null, JSON.stringify(detail), at ?? null];
  if (once && at !== undefined) {
    // The same line at the same time is the same line: the project's lock is held, so no other upload slips between.
    const { rows: same } = await client.query<ActivityRow>(
      `SELECT seq, project, at, ${COLUMNS.join(", ")}, detail FROM activity
        WHERE project = $1 AND session = $2 AND harness IS NOT DISTINCT FROM $3 AND source = $4 AND kind = $5
          AND folder IS NOT DISTINCT FROM $6 AND detail = $7::jsonb AND at = $8 LIMIT 1`,
      values,
    );
    if (same[0] !== undefined) return lineOf(same[0]);
  }
  const { rows } = await client.query<{ seq: string; at: Date }>(
    `INSERT INTO activity (project, session, harness, source, kind, folder, detail, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, coalesce($8::timestamptz, now())) RETURNING seq, at`,
    values,
  );
  const row = rows[0]!;
  return { ...line, seq: Number(row.seq), project, at: row.at.toISOString() } as Line;
}

/** A stored row as the line it is: its own fields, with nothing absent written as undefined. */
function lineOf(row: ActivityRow): Line {
  return {
    ...row.detail,
    seq: Number(row.seq),
    project: row.project,
    at: row.at.toISOString(),
    session: row.session,
    ...(row.harness === null ? {} : { harness: row.harness }),
    source: row.source,
    kind: row.kind,
    ...(row.folder === null ? {} : { folder: row.folder }),
  } as Line;
}

function assertProject(project: unknown): asserts project is string {
  if (typeof project !== "string" || project === "") throw new TypeError(`the activity log is kept per project: name one, not ${JSON.stringify(project)}`);
}

/** Apply the log's schema in one transaction; opens racing each other take turns on a lock. */
async function applySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.activity-schema'))");
    for (const statement of SCHEMA) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    failed = true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(failed);
  }
}

/** Create the log's database from the server's own, unless it is there. Another open creating it first is the outcome wanted. */
async function createDatabaseIfMissing(server: URL, timeout: number): Promise<void> {
  const client = new pg.Client({ connectionString: server.href, connectionTimeoutMillis: timeout });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [ACTIVITY_DATABASE]);
    if (rows.length === 0) await client.query(`CREATE DATABASE "${ACTIVITY_DATABASE}"`);
  } catch (error) {
    const { code, constraint } = error as { code?: unknown; constraint?: unknown };
    if (!(code === "42P04" || (code === "23505" && constraint === "pg_database_datname_index"))) throw error;
  } finally {
    await client.end();
  }
}

function newPool(connectionString: string, timeout: number): Pool {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: timeout });
  // An idle connection that drops is discarded by the pool; without a listener Node would crash.
  pool.on("error", () => {});
  return pool;
}

/** The server URL with its database swapped for `database`: user, host, port and options stay. */
function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}

/** The server said the database does not exist (invalid_catalog_name). */
function isMissingDatabase(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "3D000";
}

/**
 * The connection was reset, as Postgres on Windows sometimes does to one it is refusing. A reset
 * that arrives before the client has written its first message surfaces on that write, as EPIPE
 * (seen on macOS: the macOS run of storytree-ai/storytree#187), rather than as ECONNRESET.
 */
function isConnectionReset(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "ECONNRESET" || code === "EPIPE";
}
