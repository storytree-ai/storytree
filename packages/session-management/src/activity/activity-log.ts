/**
 * Capability 2 · Agent activity log (the Session management story): Session management's own logbook of what
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

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { connect, NEW_LINE, type Line, type LineKind, type LinesSince, type NewLine, type Storytree } from "@storytree/library";
import { readExperiment } from "@storytree/project-and-caller";

import { BRANCH_FACTS, countValues, FOLD_LINES, foldValues, inViewValues, MAIN_WORK, selectLines, SESSION_COUNT, SESSIONS_IN_VIEW, STANDING_CLAIMS, STATE_LINES, stateValues, type LineFilter } from "./bounded.js";
import type { Beat } from "../readings.js";
import { BEATS_SCHEMA, BEATS_SCHEMA_FILE, beatsOf, PgSessionBeats, type SessionBeats } from "./session-beats.js";
import { PgTranscriptRecords, TRANSCRIPT_SCHEMA, TRANSCRIPT_SCHEMA_FILE, type TranscriptRecords } from "./transcript-records.js";

/** The database the log lives in, on the same server as the projects' libraries. */
export const ACTIVITY_DATABASE = "storytree-activity";

/** The agent activity log on one Postgres server: one log per project, only ever added to until the project is deleted. */
export interface ActivityLog {
  /** Add a line to `project`'s log, and return it as the log keeps it. A line that is not one the log knows is refused. */
  append(project: string, line: NewLine, options?: AppendOptions): Promise<Line>;
  /**
   * Add `earlier`, lines written earlier elsewhere (a hook's queued lines), to `project`'s log in the
   * order given, each as `append` adds it with its own time and `once`: one transaction of a few round
   * trips however many lines there are, for a log reached across a slow route (contract 2.13).
   */
  appendMany(project: string, earlier: readonly Earlier[]): Promise<void>;
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
  /** Sessions' heartbeats, from their harness's own timer (ADR-1056 D3): kept beside the lines, on the same connection. */
  readonly beats: SessionBeats;
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
  /**
   * The hook event it records, and which way that event came (ADR-1056 D2). A line exactly like it, of
   * the same event, that came the other way within EVENT_WINDOW of its time is the same line, so it is
   * not added again: an event both ways deliver is kept once. One way never dedupes against itself, so
   * two events with the same input, each delivered once, are two.
   */
  readonly event?: DeliveredEvent;
}

/** A line written earlier elsewhere, at `at` (ISO 8601), recording `event` when it records one. */
export interface Earlier {
  readonly line: NewLine;
  readonly at: string;
  readonly event?: DeliveredEvent;
}

/** A hook event, by its key (the same whichever way it came), and the way it came: by the command hook, or through the tool server. */
export interface DeliveredEvent {
  readonly key: string;
  readonly via: "command" | "tool";
}

/** How far apart the two ways may deliver one event and still be read as one: both run within seconds of it. */
export const EVENT_WINDOW = "2 minutes";

/** One project's log, as a locked write sees it. */
export interface LockedLog {
  /** The project's lines that `filter` asks for, or of `kinds`, oldest first (ActivityLog.lines). */
  lines(filter: LineFilter | readonly LineKind[]): Promise<Line[]>;
  /** The claim lines that decide who holds what now (ActivityLog.standing). */
  standing(): Promise<Line[]>;
  /** The bounded session reading, on the same locked connection as claim admission (ActivityLog.foldLines). */
  foldLines(sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  /** When each of `sessions`, or of every session when none are named, last wrote a line. */
  lastSeen(sessions?: readonly string[]): Promise<Map<string, string>>;
  /** The latest heartbeat of each of `sessions` that has one (ActivityLog.beats). */
  beats(sessions: readonly string[]): Promise<Map<string, Beat>>;
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
  /**
   * The storytree home whose settings may name the experiment and arm this log's writer runs in (ADR-1064 D2): every line
   * it adds is labelled with both, read once as the log opens. By default, this process's storytree home.
   */
  readonly home?: string;
}

/** This machine's name, as lines record it: its host name, trimmed; undefined when it has none. */
export function thisMachine(): string | undefined {
  return hostname().trim() || undefined;
}

/** The log's tables, as idempotent statements the library applies once per connection, in order. Later changes are appended. */
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
  // ... and inside folders, whatever their case or slashes (bounded.ts FOLDER_KEY), by a range of the folder's key.
  `CREATE INDEX IF NOT EXISTS activity_project_folder_idx ON activity (project, (lower(replace(folder, '\\', '/'))) text_pattern_ops)`,
  // The hook event a line records and the way it came, so an event both ways deliver is kept once (ADR-1056 D2).
  `ALTER TABLE activity ADD COLUMN IF NOT EXISTS event text`,
  `ALTER TABLE activity ADD COLUMN IF NOT EXISTS event_via text`,
  `CREATE INDEX IF NOT EXISTS activity_project_event_idx ON activity (project, event) WHERE event IS NOT NULL`,
  ...TRANSCRIPT_SCHEMA,
  ...BEATS_SCHEMA,
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
 * hands out and sets up (contract 2.5, ADR-0735 D3, ADR-0973), on whatever server the library
 * resolved to, local or Cloud SQL; or the Postgres server at a postgres:// URL, through a library
 * connection of the log's own. From a connection, the log's pool is the connection's, and closes
 * with it; from a URL, closing the log closes the connection it opened.
 */
export async function openActivityLog(server: string | Storytree, options: OpenOptions = {}): Promise<ActivityLog> {
  const experiment = readExperiment(options.home);
  const stamp: Stamp = { machine: options.machine, branchOf: options.branchOf, ...(experiment === undefined ? {} : { labels: { experiment: experiment.name, arm: experiment.arm } }) };
  if (typeof server !== "string") return new PgActivityLog(await activityPool(server), stamp);
  const own = await connect({ url: server, connectTimeoutMs: options.connectTimeoutMs ?? 5_000 });
  try {
    return new PgActivityLog(await activityPool(own), stamp, own);
  } catch (error) {
    await own.close();
    throw error;
  }
}

/** The log's database, which the library creates and sets up with the log's tables. */
function activityPool(server: Storytree): Promise<Pool> {
  return server.ownDatabase(ACTIVITY_DATABASE, { tables: SCHEMA, declaredIn: [import.meta.url, TRANSCRIPT_SCHEMA_FILE, BEATS_SCHEMA_FILE] });
}

/**
 * Delete `project`'s lines and transcripts from the log on `server` (ADR-0831): deleting a project
 * deletes its records, and these are its records in the shared log, so a later project of the same
 * name starts with no old claims, sessions or lines. Held under the project's lock, as a write is.
 */
export async function forgetProjectActivity(server: Storytree, project: string): Promise<void> {
  assertProject(project);
  const pool = await activityPool(server);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.activity'), hashtext($1))", [project]);
    for (const table of ["activity", "transcript_records", "transcript_readings", "session_beats"]) await client.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
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

/** What a log adds to every line it writes: its machine, its folder's branch, and its experiment arm's labels. */
interface Stamp {
  readonly machine: string | undefined;
  readonly branchOf: ((folder: string) => string | undefined) | undefined;
  readonly labels?: { readonly experiment: string; readonly arm: string };
}

class PgActivityLog implements ActivityLog {
  readonly #pool: Pool;
  readonly #stamp: Stamp;
  #closing: Promise<void> | undefined;

  /** The connection the log opened for itself from a URL, closed with the log; the pool is its. */
  readonly #owner: Storytree | undefined;

  readonly transcripts: TranscriptRecords;
  readonly beats: SessionBeats;

  constructor(pool: Pool, stamp: Stamp, owner?: Storytree) {
    this.#pool = pool;
    this.#stamp = stamp;
    this.#owner = owner;
    this.transcripts = new PgTranscriptRecords(pool);
    this.beats = new PgSessionBeats(pool);
  }

  async append(project: string, line: NewLine, options: AppendOptions = {}): Promise<Line> {
    assertProject(project);
    const parsed = parseLine(this.#stamped(line));
    if (options.at !== undefined && Number.isNaN(Date.parse(options.at))) throw new RangeError(`a line's time must be an ISO 8601 time, not ${JSON.stringify(options.at)}`);
    return this.#write(project, (client) => insert(client, project, parsed, options));
  }

  async appendMany(project: string, earlier: readonly Earlier[]): Promise<void> {
    assertProject(project);
    if (earlier.length === 0) return;
    const parsed = earlier.map(({ line, at, event }) => {
      if (Number.isNaN(Date.parse(at))) throw new RangeError(`a line's time must be an ISO 8601 time, not ${JSON.stringify(at)}`);
      return { line: parseLine(this.#stamped(line)), at, event };
    });
    await this.#write(project, (client) => insertMany(client, project, parsed));
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
        foldLines: async (sessions, commandsSince) => sessions.length === 0 ? []
          : (await client.query<ActivityRow>(FOLD_LINES, foldValues(project, sessions, commandsSince))).rows.map(lineOf),
        lastSeen: (sessions) => lastSeenIn(client, project, sessions),
        beats: (sessions) => beatsOf(client, project, sessions),
        now: async () => (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0]!.now,
        append: (line) => insert(client, project, parseLine(this.#stamped(line))),
      }),
    );
  }

  /**
   * `line`, naming this log's machine when it names none, its folder's branch when it names a folder and no branch,
   * and the experiment and arm this log's home names, whatever the line says (ADR-1064 D2).
   */
  #stamped(line: NewLine): NewLine {
    const { machine: ownMachine, branchOf, labels } = this.#stamp;
    const machine = line.machine !== undefined || ownMachine === undefined ? line : { ...line, machine: ownMachine };
    const branch = line.branch !== undefined || line.folder === undefined ? undefined : branchOf?.(line.folder);
    const branched = branch === undefined ? machine : { ...machine, branch };
    return labels === undefined ? branched : { ...branched, ...labels };
  }

  close(): Promise<void> {
    this.#closing ??= this.#owner?.close() ?? Promise.resolve();
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
async function insert(client: PoolClient, project: string, line: NewLine, { at, once = false, event }: AppendOptions = {}): Promise<Line> {
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
  if (event !== undefined) {
    // The same line of the same event, come the other way about the same time, is this line (ADR-1056 D2).
    const { rows: same } = await client.query<ActivityRow>(
      `SELECT seq, project, at, ${COLUMNS.join(", ")}, detail FROM activity
        WHERE project = $1 AND event = $9 AND event_via <> $10 AND session = $2 AND harness IS NOT DISTINCT FROM $3 AND source = $4
          AND kind = $5 AND folder IS NOT DISTINCT FROM $6 AND detail = $7::jsonb
          AND at BETWEEN coalesce($8::timestamptz, now()) - interval '${EVENT_WINDOW}' AND coalesce($8::timestamptz, now()) + interval '${EVENT_WINDOW}' LIMIT 1`,
      [...values, event.key, event.via],
    );
    if (same[0] !== undefined) return lineOf(same[0]);
  }
  const { rows } = await client.query<{ seq: string; at: Date }>(
    `INSERT INTO activity (project, session, harness, source, kind, folder, detail, at, event, event_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, coalesce($8::timestamptz, now()), $9, $10) RETURNING seq, at`,
    [...values, event?.key ?? null, event?.via ?? null],
  );
  const row = rows[0]!;
  return { ...line, seq: Number(row.seq), project, at: row.at.toISOString() } as Line;
}

/** The same line, as the log compares lines: its columns and its detail, the detail's keys in order (jsonb sorts them). */
function sameKey(line: NewLine): string {
  const { session, harness, source, kind, folder, ...detail } = line;
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, field]) => [key, sorted(field)])) : value;
  return JSON.stringify([session, harness ?? null, source, kind, folder ?? null, sorted(detail)]);
}

/**
 * Add `earlier` to `project`'s log on `client`, inside a transaction holding the project's lock, as
 * `insert` adds each with `once` and its time: one statement checks a run of lines against the log and
 * inserts the rest, in order. A line that could be the same as an earlier one of the run (exactly like
 * it at its time, or of its event come the other way) starts the next run, so it is checked against
 * the log once that one is in, as one line after another would be; almost every batch is one run.
 */
async function insertMany(client: PoolClient, project: string, earlier: readonly Earlier[]): Promise<void> {
  // A cause is an earlier line of this project's log: a dangling one is refused, never healed (0.2 inc-74).
  const causes = [...new Set(earlier.flatMap(({ line }) => (line.causedBy === undefined ? [] : [line.causedBy])))];
  if (causes.length > 0) {
    const { rows } = await client.query<{ seq: string }>("SELECT seq FROM activity WHERE project = $1 AND seq = ANY($2::bigint[])", [project, causes]);
    const found = new Set(rows.map((row) => Number(row.seq)));
    const missing = causes.find((cause) => !found.has(cause));
    if (missing !== undefined) throw new Error(`the activity log refused a line: its cause, line ${missing}, is not a line of ${project}'s log`);
  }
  let run: Earlier[] = [];
  const seen = new Set<string>();
  const ways = new Map<string, Set<string>>();
  for (const entry of earlier) {
    const same = `${sameKey(entry.line)}@${Date.parse(entry.at)}`;
    const other = entry.event === undefined ? false : [...(ways.get(entry.event.key) ?? [])].some((via) => via !== entry.event!.via);
    if (seen.has(same) || other) {
      await insertRun(client, project, run);
      run = [];
      seen.clear();
      ways.clear();
    }
    run.push(entry);
    seen.add(same);
    if (entry.event !== undefined) ways.set(entry.event.key, (ways.get(entry.event.key) ?? new Set()).add(entry.event.via));
  }
  await insertRun(client, project, run);
}

/** Insert the lines of `run` that the log does not already hold, by `insert`'s once and event rules, in one statement, in order. */
async function insertRun(client: PoolClient, project: string, run: readonly Earlier[]): Promise<void> {
  if (run.length === 0) return;
  const column = (pick: (entry: Earlier) => string | null) => run.map(pick);
  const detail = (line: NewLine): string => {
    const { session: _session, harness: _harness, source: _source, kind: _kind, folder: _folder, ...rest } = line;
    return JSON.stringify(rest);
  };
  const like = (a: string) => `${a}.session = b.session AND ${a}.harness IS NOT DISTINCT FROM b.harness AND ${a}.source = b.source AND ${a}.kind = b.kind
    AND ${a}.folder IS NOT DISTINCT FROM b.folder AND ${a}.detail = b.detail`;
  await client.query(
    `INSERT INTO activity (project, session, harness, source, kind, folder, detail, at, event, event_via)
     SELECT $1, b.session, b.harness, b.source, b.kind, b.folder, b.detail, b.at, b.event, b.event_via
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[], $8::timestamptz[], $9::text[], $10::text[])
              WITH ORDINALITY AS b(session, harness, source, kind, folder, detail, at, event, event_via, ord)
      WHERE NOT EXISTS (SELECT 1 FROM activity a WHERE a.project = $1 AND ${like("a")} AND a.at = b.at)
        AND (b.event IS NULL OR NOT EXISTS (SELECT 1 FROM activity a WHERE a.project = $1 AND a.event = b.event AND a.event_via <> b.event_via AND ${like("a")}
          AND a.at BETWEEN b.at - interval '${EVENT_WINDOW}' AND b.at + interval '${EVENT_WINDOW}'))
      ORDER BY b.ord`,
    [
      project,
      column(({ line }) => line.session),
      column(({ line }) => line.harness ?? null),
      column(({ line }) => line.source),
      column(({ line }) => line.kind),
      column(({ line }) => line.folder ?? null),
      column(({ line }) => detail(line)),
      column(({ at }) => at),
      column(({ event }) => event?.key ?? null),
      column(({ event }) => event?.via ?? null),
    ],
  );
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
