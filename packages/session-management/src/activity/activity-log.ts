// Capability 2 · Agent activity log
import { hostname } from "node:os";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { connect, NEW_LINE, type Line, type LineKind, type LinesSince, type NewLine, type Storytree } from "@storytree/library";
import { leaveAfterMs, readExperiment } from "@storytree/project-and-caller";

import { BRANCH_FACTS, countValues, DOOR_COUNTS, DOOR_STEPS, FOLD_LINES, foldValues, inViewValues, selectLines, SESSION_COUNT, SESSIONS_IN_VIEW, STANDING_CLAIMS, STATE_LINES, stateValues, type LineFilter } from "./bounded.js";
import { holdersOf, LONGEST_COMMAND_MS, type Beat } from "../readings.js";
import { PgLibraryReads, READS_SCHEMA, READS_SCHEMA_FILE, type LibraryReads } from "./library-reads.js";
import { BEATS_SCHEMA, BEATS_SCHEMA_FILE, beatsOf, PgSessionBeats, type SessionBeats } from "./session-beats.js";
import { LANE_MESSAGES_SCHEMA, LANE_MESSAGES_SCHEMA_FILE, PgLaneMessages, type LaneMessages } from "./lane-messages.js";
import { PgTranscriptRecords, TRANSCRIPT_SCHEMA, TRANSCRIPT_SCHEMA_FILE, type TranscriptRecords } from "./transcript-records.js";

export const ACTIVITY_DATABASE = "storytree-activity";

export interface StartOptions {
  readonly kinds: readonly LineKind[];
  readonly now?: Date;
  readonly leaveMs?: number;
}

export interface LinesStart {
  lines: Line[];
  sessions: Line[];
  claims: Line[];
  cursor: number;
}

export interface ActivityLog {
  append(project: string, line: NewLine, options?: AppendOptions): Promise<Line>;
  appendMany(project: string, earlier: readonly Earlier[]): Promise<void>;
  since(project: string, cursor: number): Promise<LinesSince>;
  start(project: string, options: StartOptions): Promise<LinesStart>;
  sessionLines(project: string, sessions: readonly string[], options?: { now?: Date }): Promise<Line[]>;
  lines(project: string, filter: LineFilter): Promise<Line[]>;
  standing(project: string): Promise<Line[]>;
  lastSeen(project: string, sessions?: readonly string[]): Promise<Map<string, string>>;
  foldLines(project: string, sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  stateLines(project: string, activeSince: string, commandsSince: string): Promise<Line[]>;
  sessionsInView(project: string, since: string): Promise<string[]>;
  sessionCount(project: string): Promise<number>;
  doorTally(project: string, since: string): Promise<DoorTally>;
  branchFacts(project: string, machine: string | undefined): Promise<BranchFacts[]>;
  machineTally(project: string, since: string, recentSince: string): Promise<MachineTally[]>;
  locked<T>(project: string, work: (log: LockedLog) => Promise<T>): Promise<T>;
  readonly transcripts: TranscriptRecords;
  readonly beats: SessionBeats;
  readonly messages: LaneMessages;
  readonly reads: LibraryReads;
  close(): Promise<void>;
}

export interface DoorTally {
  readonly sessions: number;
  readonly first?: string;
  readonly calls: ReadonlyMap<string, number>;
  readonly steps: Line[];
}

export interface BranchFacts {
  readonly branch: string;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly folder?: string;
  readonly state?: Line & { kind: "branch-state" };
}

export interface MachineTally {
  readonly machine: string;
  readonly count: number;
  readonly recent: number;
  readonly first: string;
  readonly last: string;
  readonly lastSeq: number;
}

export interface AppendOptions {
  readonly at?: string;
  readonly once?: boolean;
  readonly event?: DeliveredEvent;
}

export interface Earlier {
  readonly line: NewLine;
  readonly at: string;
  readonly event?: DeliveredEvent;
}

export interface DeliveredEvent {
  readonly key: string;
  readonly via: "command" | "tool";
}

export const EVENT_WINDOW = "2 minutes";

export interface LockedLog {
  lines(filter: LineFilter | readonly LineKind[]): Promise<Line[]>;
  standing(): Promise<Line[]>;
  foldLines(sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  lastSeen(sessions?: readonly string[]): Promise<Map<string, string>>;
  beats(sessions: readonly string[]): Promise<Map<string, Beat>>;
  now(): Promise<Date>;
  append(line: NewLine): Promise<Line>;
}

export interface OpenOptions {
  readonly connectTimeoutMs?: number;
  readonly machine?: string;
  readonly branchOf?: (folder: string) => string | undefined;
  readonly home?: string;
}

export function thisMachine(): string | undefined {
  return hostname().trim() || undefined;
}

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
  `CREATE INDEX IF NOT EXISTS activity_project_kind_seq_idx ON activity (project, kind, seq)`,
  `CREATE INDEX IF NOT EXISTS activity_project_session_seq_idx ON activity (project, session, seq)`,
  `CREATE INDEX IF NOT EXISTS activity_project_at_idx ON activity (project, at)`,
  `CREATE INDEX IF NOT EXISTS activity_project_folder_idx ON activity (project, (lower(replace(folder, '\\', '/'))) text_pattern_ops)`,
  `ALTER TABLE activity ADD COLUMN IF NOT EXISTS event text`,
  `ALTER TABLE activity ADD COLUMN IF NOT EXISTS event_via text`,
  `CREATE INDEX IF NOT EXISTS activity_project_event_idx ON activity (project, event) WHERE event IS NOT NULL`,
  ...TRANSCRIPT_SCHEMA,
  ...BEATS_SCHEMA,
  ...LANE_MESSAGES_SCHEMA,
  ...READS_SCHEMA,
];

const COLUMNS = ["session", "harness", "source", "kind", "folder"] as const;

interface ActivityRow {
  seq: string;
  project: string;
  at: Date;
  session: string;
  harness: string | null;
  source: string;
  kind: string;
  folder: string | null;
  detail: Record<string, unknown>;
}

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

function activityPool(server: Storytree): Promise<Pool> {
  return server.ownDatabase(ACTIVITY_DATABASE, { tables: SCHEMA, declaredIn: [import.meta.url, TRANSCRIPT_SCHEMA_FILE, BEATS_SCHEMA_FILE, LANE_MESSAGES_SCHEMA_FILE, READS_SCHEMA_FILE] });
}

export async function forgetProjectActivity(server: Storytree, project: string): Promise<void> {
  assertProject(project);
  const pool = await activityPool(server);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.activity'), hashtext($1))", [project]);
    for (const table of ["activity", "transcript_records", "transcript_readings", "session_beats", "lane_messages", "lane_sessions"]) await client.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
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

interface Stamp {
  readonly machine: string | undefined;
  readonly branchOf: ((folder: string) => string | undefined) | undefined;
  readonly labels?: { readonly experiment: string; readonly arm: string };
}

class PgActivityLog implements ActivityLog {
  readonly #pool: Pool;
  readonly #stamp: Stamp;
  #closing: Promise<void> | undefined;

  readonly #owner: Storytree | undefined;

  readonly transcripts: TranscriptRecords;
  readonly beats: SessionBeats;
  readonly messages: LaneMessages;
  readonly reads: PgLibraryReads;

  constructor(pool: Pool, stamp: Stamp, owner?: Storytree) {
    this.#pool = pool;
    this.#stamp = stamp;
    this.#owner = owner;
    this.transcripts = new PgTranscriptRecords(pool);
    this.beats = new PgSessionBeats(pool);
    this.messages = new PgLaneMessages(pool);
    this.reads = new PgLibraryReads(pool, stamp.machine ?? thisMachine() ?? "unknown");
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
      return { line: parseLine(this.#stamped(line)), at, ...(event === undefined ? {} : { event }) };
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

  async start(project: string, { kinds, now = new Date(), leaveMs = leaveAfterMs() }: StartOptions): Promise<LinesStart> {
    assertProject(project);
    const { rows: [latest] } = await this.#pool.query<{ seq: string | null }>("SELECT max(seq) AS seq FROM activity WHERE project = $1", [project]);
    const cursor = Number(latest?.seq ?? 0);
    const upTo = (lines: readonly Line[]) => lines.filter((line) => line.seq <= cursor);
    const [lines, claims] = await Promise.all([this.lines(project, { kinds }), this.standing(project)]);
    const inView = await this.sessionsInView(project, new Date(now.getTime() - Math.max(leaveMs, LONGEST_COMMAND_MS)).toISOString());
    const sessions = await this.sessionLines(project, [...new Set([...inView, ...holdersOf(claims)])], { now });
    return { lines: upTo(lines), sessions: upTo(sessions), claims: upTo(claims), cursor };
  }

  async sessionLines(project: string, sessions: readonly string[], { now = new Date() }: { now?: Date } = {}): Promise<Line[]> {
    return this.foldLines(project, sessions, new Date(now.getTime() - LONGEST_COMMAND_MS - 60_000).toISOString());
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

  async machineTally(project: string, since: string, recentSince: string): Promise<MachineTally[]> {
    assertProject(project);
    const { rows } = await this.#pool.query<{ machine: string; count: string; recent: string; first: Date; last: Date; last_seq: string }>(
      `SELECT detail->>'machine' AS machine, count(*) AS count, count(*) FILTER (WHERE at >= $3) AS recent, coalesce(min(at) FILTER (WHERE at >= $3), min(at)) AS first, max(at) AS last, max(seq) AS last_seq
         FROM activity WHERE project = $1 AND at >= $2 AND detail ? 'machine' GROUP BY 1 ORDER BY 1`,
      [project, since, recentSince],
    );
    return rows.map((row) => ({ machine: row.machine, count: Number(row.count), recent: Number(row.recent), first: row.first.toISOString(), last: row.last.toISOString(), lastSeq: Number(row.last_seq) }));
  }

  async sessionCount(project: string): Promise<number> {
    assertProject(project);
    return Number((await this.#pool.query<{ count: string }>(SESSION_COUNT, countValues(project))).rows[0]?.count ?? 0);
  }

  async doorTally(project: string, since: string): Promise<DoorTally> {
    assertProject(project);
    const [counts, steps] = await Promise.all([
      this.#pool.query<{ sessions: string; first: Date | null; calls: Record<string, string | number> }>(DOOR_COUNTS, [project, since]),
      this.#pool.query<ActivityRow>(DOOR_STEPS, [project, since]),
    ]);
    const { sessions, first, calls } = counts.rows[0]!;
    return {
      sessions: Number(sessions),
      ...(first === null ? {} : { first: first.toISOString() }),
      calls: new Map(Object.entries(calls).map(([verb, count]) => [verb, Number(count)])),
      steps: steps.rows.map(lineOf),
    };
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

  #stamped(line: NewLine): NewLine {
    const { machine: ownMachine, branchOf, labels } = this.#stamp;
    const machine = line.machine !== undefined || ownMachine === undefined ? line : { ...line, machine: ownMachine };
    const branch = line.branch !== undefined || line.folder === undefined ? undefined : branchOf?.(line.folder);
    const branched = branch === undefined ? machine : { ...machine, branch };
    return labels === undefined ? branched : { ...branched, ...labels };
  }

  close(): Promise<void> {
    this.reads.close();
    this.#closing ??= this.#owner?.close() ?? Promise.resolve();
    return this.#closing;
  }

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

type Queryable = Pool | PoolClient;

async function readLines(on: Queryable, project: string, filter: LineFilter): Promise<Line[]> {
  const { text, values } = selectLines(project, filter);
  const lines = (await on.query<ActivityRow>(text, values)).rows.map(lineOf);
  return filter.newest === undefined ? lines : lines.reverse();
}

async function lastSeenIn(on: Queryable, project: string, sessions: readonly string[] | undefined): Promise<Map<string, string>> {
  if (sessions !== undefined && sessions.length === 0) return new Map();
  const { rows } = await on.query<{ session: string; at: Date }>(
    "SELECT session, max(at) AS at FROM activity WHERE project = $1 AND ($2::text[] IS NULL OR session = ANY($2)) GROUP BY session",
    [project, sessions === undefined ? null : [...sessions]],
  );
  return new Map(rows.map((row) => [row.session, row.at.toISOString()]));
}

function parseLine(line: NewLine): NewLine {
  const parsed = NEW_LINE.safeParse(line);
  if (!parsed.success) throw new Error(`the activity log refused a line: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

async function insert(client: PoolClient, project: string, line: NewLine, { at, once = false, event }: AppendOptions = {}): Promise<Line> {
  if (line.causedBy !== undefined) {
    const { rowCount } = await client.query("SELECT 1 FROM activity WHERE project = $1 AND seq = $2", [project, line.causedBy]);
    if (rowCount === 0) throw new Error(`the activity log refused a line: its cause, line ${line.causedBy}, is not a line of ${project}'s log`);
  }
  const { session, harness, source, kind, folder, ...detail } = line;
  const values = [project, session, harness ?? null, source, kind, folder ?? null, JSON.stringify(detail), at ?? null];
  if (once && at !== undefined) {
    const { rows: same } = await client.query<ActivityRow>(
      `SELECT seq, project, at, ${COLUMNS.join(", ")}, detail FROM activity
        WHERE project = $1 AND session = $2 AND harness IS NOT DISTINCT FROM $3 AND source = $4 AND kind = $5
          AND folder IS NOT DISTINCT FROM $6 AND detail = $7::jsonb AND at = $8 LIMIT 1`,
      values,
    );
    if (same[0] !== undefined) return lineOf(same[0]);
  }
  if (event !== undefined) {
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

function sameKey(line: NewLine): string {
  const { session, harness, source, kind, folder, ...detail } = line;
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, field]) => [key, sorted(field)])) : value;
  return JSON.stringify([session, harness ?? null, source, kind, folder ?? null, sorted(detail)]);
}

async function insertMany(client: PoolClient, project: string, earlier: readonly Earlier[]): Promise<void> {
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
