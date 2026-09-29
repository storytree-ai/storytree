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

import { NEW_LINE, type Line, type LineKind, type LinesSince, type NewLine } from "./lines.js";

/** The database the log lives in, on the same server as the projects' libraries. */
export const ACTIVITY_DATABASE = "storytree-activity";

/** The agent activity log on one Postgres server: one log per project, only ever added to. */
export interface ActivityLog {
  /** Add a line to `project`'s log, and return it as the log keeps it. A line that is not one the log knows is refused. */
  append(project: string, line: NewLine): Promise<Line>;
  /** `project`'s lines after `cursor`, oldest first, and the cursor to pass next time. Start from 0. */
  since(project: string, cursor: number): Promise<LinesSince>;
  /**
   * Run `work` holding `project`'s lock: what it reads through the LockedLog it is handed, and any
   * line it adds, happen with no other write to the project in between. It is how a claim checks
   * who holds a capability and takes it in one step (capability 5).
   */
  locked<T>(project: string, work: (log: LockedLog) => Promise<T>): Promise<T>;
  /** Close the log's connections. */
  close(): Promise<void>;
}

/** One project's log, as a locked write sees it. */
export interface LockedLog {
  /** The project's lines, oldest first: only those of `kinds`, when given. */
  lines(kinds?: readonly LineKind[]): Promise<Line[]>;
  /** When each of the project's sessions last wrote a line. */
  lastSeen(): Promise<Map<string, string>>;
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
    return new PgActivityLog(pool, options.machine, false);
  }
  return openAtUrl(new URL(server), options);
}

async function openAtUrl(server: URL, options: OpenOptions): Promise<ActivityLog> {
  const timeout = options.connectTimeoutMs ?? 5_000;
  const first = newPool(databaseUrl(server, ACTIVITY_DATABASE), timeout);
  try {
    await applySchema(first);
    return new PgActivityLog(first, options.machine);
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
  return new PgActivityLog(pool, options.machine);
}

class PgActivityLog implements ActivityLog {
  readonly #pool: Pool;
  readonly #machine: string | undefined;
  #closing: Promise<void> | undefined;

  readonly #ownsPool: boolean;

  /** `ownsPool` false: the pool is a library connection's, which ends it. */
  constructor(pool: Pool, machine: string | undefined, ownsPool = true) {
    this.#pool = pool;
    this.#machine = machine;
    this.#ownsPool = ownsPool;
  }

  async append(project: string, line: NewLine): Promise<Line> {
    assertProject(project);
    const parsed = parseLine(this.#stamped(line));
    return this.#write(project, (client) => insert(client, project, parsed));
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

  locked<T>(project: string, work: (log: LockedLog) => Promise<T>): Promise<T> {
    assertProject(project);
    return this.#write(project, (client) =>
      work({
        lines: async (kinds) => {
          const { rows } = await client.query<ActivityRow>(
            `SELECT seq, project, at, ${COLUMNS.join(", ")}, detail FROM activity
              WHERE project = $1 AND ($2::text[] IS NULL OR kind = ANY($2)) ORDER BY seq`,
            [project, kinds === undefined ? null : [...kinds]],
          );
          return rows.map(lineOf);
        },
        lastSeen: async () => {
          const { rows } = await client.query<{ session: string; at: Date }>(
            "SELECT session, max(at) AS at FROM activity WHERE project = $1 GROUP BY session",
            [project],
          );
          return new Map(rows.map((row) => [row.session, row.at.toISOString()]));
        },
        now: async () => (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0]!.now,
        append: (line) => insert(client, project, parseLine(this.#stamped(line))),
      }),
    );
  }

  /** `line`, naming this log's machine when it names none. */
  #stamped(line: NewLine): NewLine {
    return line.machine !== undefined || this.#machine === undefined ? line : { ...line, machine: this.#machine };
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

/** `line`, checked against the kinds of line the log knows: anything else is refused, naming what is wrong. */
function parseLine(line: NewLine): NewLine {
  const parsed = NEW_LINE.safeParse(line);
  if (!parsed.success) throw new Error(`the activity log refused a line: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Add `line` to `project`'s log on `client`, inside a transaction holding the project's lock. */
async function insert(client: PoolClient, project: string, line: NewLine): Promise<Line> {
  // A cause is an earlier line of this project's log: a dangling one is refused, never healed (0.2 inc-74).
  if (line.causedBy !== undefined) {
    const { rowCount } = await client.query("SELECT 1 FROM activity WHERE project = $1 AND seq = $2", [project, line.causedBy]);
    if (rowCount === 0) throw new Error(`the activity log refused a line: its cause, line ${line.causedBy}, is not a line of ${project}'s log`);
  }
  const { session, harness, source, kind, folder, ...detail } = line;
  const { rows } = await client.query<{ seq: string; at: Date }>(
    `INSERT INTO activity (project, session, harness, source, kind, folder, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING seq, at`,
    [project, session, harness ?? null, source, kind, folder ?? null, JSON.stringify(detail)],
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
