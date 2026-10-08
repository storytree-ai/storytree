/**
 * Capability 2 · Agent activity log, its bounded reads (contract 2.7): a reader asks the log for the
 * lines it needs, and the server sends only those. The log grows with every tool call of every
 * session on every machine, so a reader that fetched the whole of it on each call took more from the
 * store the longer the project lived, many times a minute (the Cloud SQL egress bill of
 * 2026-10-05: 25 GB an hour). Each read here is narrowed on the server, by kind, session, time and a
 * field's value, or to the latest line for each key; the sessions and claims readings get the few
 * lines that decide them, never the history that does not.
 */
import type { LineKind } from "./lines.js";

/** What a bounded read asks for: each condition given narrows what the server sends. */
export interface LineFilter {
  /** Only lines of these kinds. */
  readonly kinds?: readonly LineKind[];
  /** Only these sessions' lines. */
  readonly sessions?: readonly string[];
  /** Only lines after this one: a cursor. */
  readonly after?: number;
  /** Only lines written at this time or later (ISO 8601). */
  readonly since?: string;
  /**
   * Only lines whose field has this value, or one of these values, or (null) none. A field is a
   * line's own column (session, harness, source, kind, folder) or any field it carries (call, of, …).
   */
  readonly where?: Readonly<Record<string, string | readonly string[] | null>>;
  /** Only lines that carry each of these fields. */
  readonly has?: readonly string[];
  /** Only lines whose folder is one of these or inside one, matched without regard to case or slash: a reader makes it exact. */
  readonly within?: readonly string[];
  /** Only the latest line for each value of these fields together. */
  readonly latestBy?: readonly string[];
  /** Only the newest this many of what matched, still oldest first. */
  readonly newest?: number;
  /** Only the oldest this many of what matched. */
  readonly oldest?: number;
  /** Fields left out of each line, for a reader that never looks at them: a command's text, a transcript's path. */
  readonly omit?: readonly string[];
}

/** The columns every line row is read with. */
const ROW = "seq, project, at, session, harness, source, kind, folder";
/** The fields every line has its own column for. */
const COLUMN_FIELDS = new Set(["session", "harness", "source", "kind", "folder"]);
/** The kinds of line whose writer only looked at others' work (readings.ts ABOUT_OTHERS). */
const ABOUT_OTHERS = ["merged", "branch-state", "main-state", "session-archived", "session-unarchived", "session-described", "machine-started"];
/** Fields the sessions fold never reads from a line that only places its session: dropped from those. */
const PLACING_ONLY = ["command", "files", "transcript", "task"];

/** A line's folder as a folder match reads it, without regard to case or slash: what activity_project_folder_idx keeps. */
const FOLDER_KEY = "lower(replace(a.folder, '\\', '/'))";

/** A field as SQL: its column, or the value it carries in `detail`. Field names come from code, never from input. */
function field(name: string): string {
  if (COLUMN_FIELDS.has(name)) return name;
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) throw new RangeError(`not a field a line carries: ${JSON.stringify(name)}`);
  return `detail->>'${name}'`;
}

/** The query for `filter` on `project`'s lines: its text and values. */
export function selectLines(project: string, filter: LineFilter): { text: string; values: unknown[] } {
  const values: unknown[] = [project];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = ["project = $1"];
  if (filter.kinds !== undefined) where.push(`kind = ANY(${param([...filter.kinds])}::text[])`);
  if (filter.sessions !== undefined) where.push(`session = ANY(${param([...filter.sessions])}::text[])`);
  if (filter.after !== undefined) where.push(`seq > ${param(filter.after)}`);
  if (filter.since !== undefined) where.push(`at >= ${param(filter.since)}::timestamptz`);
  for (const [name, value] of Object.entries(filter.where ?? {})) {
    if (value === null) where.push(`${field(name)} IS NULL`);
    else if (typeof value === "string") where.push(`${field(name)} = ${param(value)}`);
    else where.push(`${field(name)} = ANY(${param([...value])}::text[])`);
  }
  for (const name of filter.has ?? []) where.push(`${field(name)} IS NOT NULL`);
  if (filter.within !== undefined) {
    const folders = param(filter.within.map((folder) => folder.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()));
    // Each folder is a range of the index on the key (activity_project_folder_idx): from the folder to
    // the folder with '0' after it, the byte after '/': the folder and its subfolders are in it, and the
    // match leaves out the few others whose names only start with the folder's.
    where.push(`seq IN (SELECT a.seq FROM unnest(${folders}::text[]) AS w(folder) JOIN activity a
      ON a.project = $1 AND ${FOLDER_KEY} ~>=~ w.folder AND ${FOLDER_KEY} ~<~ (w.folder || '0')
      WHERE ${FOLDER_KEY} = w.folder OR left(${FOLDER_KEY}, length(w.folder) + 1) = w.folder || '/')`);
  }
  const latest = filter.latestBy === undefined || filter.latestBy.length === 0 ? undefined : filter.latestBy.map(field).join(", ");
  const picked = latest === undefined
    ? `SELECT * FROM activity WHERE ${where.join(" AND ")}`
    : `SELECT DISTINCT ON (${latest}) * FROM activity WHERE ${where.join(" AND ")} ORDER BY ${latest}, seq DESC`;
  const detail = filter.omit === undefined || filter.omit.length === 0 ? "detail" : `detail - ${param([...filter.omit])}::text[] AS detail`;
  const order = filter.newest !== undefined ? `ORDER BY seq DESC LIMIT ${param(filter.newest)}`
    : filter.oldest !== undefined ? `ORDER BY seq LIMIT ${param(filter.oldest)}`
    : "ORDER BY seq";
  return { text: `SELECT ${ROW}, ${detail} FROM (${picked}) AS picked ${order}`, values };
}

/**
 * The claim lines that decide who holds what now (capability 5): for each capability or increment
 * whose latest claim no later line ended, every claim line on it and the end lines of the sessions
 * that claimed it. Its holder closing the increment a capability claim names as `under` ends it too
 * (ADR-0944 D5). Folded in order they give the standing claims, in the order a fold of the whole
 * log gives them; ended claims, however many, send nothing.
 */
export const STANDING_CLAIMS = `
WITH latest AS (
  SELECT DISTINCT ON (coalesce(detail->>'increment', detail->>'capability')) seq, session, coalesce(detail->>'increment', detail->>'capability') AS id, detail->>'under' AS under
  FROM activity WHERE project = $1 AND kind = 'claimed'
  ORDER BY coalesce(detail->>'increment', detail->>'capability'), seq DESC
), endings AS (
  SELECT seq, kind, session, detail->>'holder' AS holder, coalesce(detail->>'increment', detail->>'capability') AS id
  FROM activity WHERE project = $1 AND kind IN ('released', 'landed', 'merged', 'closed', 'session-ended')
), standing AS (
  SELECT l.id, l.session FROM latest l WHERE NOT EXISTS (
    SELECT 1 FROM endings e WHERE e.seq > l.seq AND (
      (e.kind = 'released' AND coalesce(e.holder, e.session) = l.session AND e.id = l.id)
      OR (e.kind = 'landed' AND e.session = l.session AND e.id = l.id)
      OR (e.kind = 'merged' AND e.holder = l.session AND e.id = l.id)
      OR (e.kind = 'closed' AND (e.id = l.id OR (e.session = l.session AND e.id = l.under)))
      OR (e.kind = 'session-ended' AND e.session = l.session)))
), claimers AS (
  SELECT DISTINCT session FROM activity
  WHERE project = $1 AND kind = 'claimed' AND coalesce(detail->>'increment', detail->>'capability') IN (SELECT id FROM standing)
)
SELECT ${ROW}, detail FROM activity
WHERE project = $1 AND (
  (kind IN ('claimed', 'released', 'landed', 'merged', 'closed') AND coalesce(detail->>'increment', detail->>'capability') IN (SELECT id FROM standing))
  OR (kind = 'session-ended' AND session IN (SELECT session FROM claimers)))
ORDER BY seq`;

/** Whether a file named on a line ($file) lies inside its folder (readings.ts `inside`): a relative name always does. */
const INSIDE = `(left(f.file, 1) IN ('/', '\\') OR f.file ~ '^[A-Za-z]:') IS NOT TRUE
  OR left(regexp_replace(replace(f.file, '\\', '/'), '/+$', ''), length(regexp_replace(replace(o.folder, '\\', '/'), '/+$', '')) + 1)
     = regexp_replace(replace(o.folder, '\\', '/'), '/+$', '') || '/'`;

/** The latest start each machine recorded (agent link 4.29): one line a machine, however often it started. */
const MACHINE_STARTS = `SELECT DISTINCT ON (detail->>'machine') seq FROM activity WHERE project = $1 AND kind = 'machine-started'
    ORDER BY detail->>'machine', (detail->>'startedAt')::timestamptz DESC, seq DESC`;

/**
 * The lines the sessions fold needs for sessions $2 (capability 4), which it reads exactly as it
 * reads their whole history: the first and the last line each session wrote from each place (folder,
 * branch, machine, harness, source; about others or not), and the finish of any command among them;
 * the latest line of each kind that turns, ends, closes out, names or claims, and its first start
 * naming a folder; its latest work on the main line in each folder (ADR-0906); its commands started
 * since $3 with no finish, and every turn's end, start and end after the first of them; and what
 * others' lines last said of its branches, of each folder on the main line, and of it in the apps;
 * and each machine's latest start.
 * Lines kept only to place a session leave out what the fold never reads ($5): a command's text, an
 * edit's files (kept as none), a transcript's path, a subagent's task.
 */
export const FOLD_LINES = `
WITH own AS (
  SELECT seq, session, at, kind, folder, harness, source, detail->>'branch' AS branch, detail->>'machine' AS machine,
    detail->>'how' AS how, detail->>'call' AS call, detail ? 'increment' AS on_increment,
    CASE WHEN kind = 'file-edited' AND detail->>'branch' IN ('main', 'master') THEN detail->'files' END AS files
  FROM activity WHERE project = $1 AND session = ANY($2::text[])
), unfinished AS (
  SELECT s.seq, s.session FROM own s
  WHERE s.kind = 'command-started' AND s.at >= $3::timestamptz
    AND NOT EXISTS (SELECT 1 FROM own r WHERE r.kind = 'command-run' AND r.session = s.session AND r.call = s.call)
), placed AS (
  SELECT min(seq) AS seq FROM own GROUP BY session, folder, branch, machine, harness, source, kind = ANY($4::text[])
  UNION
  SELECT max(seq) FROM own GROUP BY session, folder, branch, machine, harness, source, kind = ANY($4::text[])
), picked AS (
  SELECT seq, false AS whole FROM placed
  UNION ALL
  SELECT r.seq, false FROM own s JOIN own r ON r.kind = 'command-run' AND r.session = s.session AND r.call = s.call
  WHERE s.kind = 'command-started' AND s.seq IN (SELECT seq FROM placed)
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (session, kind, kind = 'session-started' AND how = 'compact') seq FROM own
    WHERE kind IN ('prompt-submitted', 'turn-ended', 'session-ended', 'session-started', 'closed-out', 'session-named', 'claimed')
    ORDER BY session, kind, kind = 'session-started' AND how = 'compact', seq DESC) AS latest
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (session) seq FROM own WHERE kind = 'session-started' AND folder IS NOT NULL ORDER BY session, seq) AS first_start
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (o.session, o.machine, o.folder, o.kind) o.seq FROM own o
    WHERE o.branch IN ('main', 'master') AND o.folder IS NOT NULL AND (
      (o.kind = 'claimed' AND o.on_increment)
      OR (o.kind = 'file-edited' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(o.files) AS f(file) WHERE ${INSIDE})))
    ORDER BY o.session, o.machine, o.folder, o.kind, o.seq DESC) AS on_main
  UNION ALL
  SELECT seq, true FROM unfinished
  UNION ALL
  SELECT o.seq, true FROM own o JOIN (SELECT session, min(seq) AS first FROM unfinished GROUP BY session) u ON u.session = o.session AND o.seq > u.first
  WHERE o.kind IN ('turn-ended', 'session-started', 'session-ended')
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (coalesce(detail->>'of', detail->>'branch')) seq FROM activity
    WHERE project = $1 AND kind IN ('branch-state', 'merged')
      AND coalesce(detail->>'of', detail->>'branch') IN (SELECT branch FROM own WHERE kind <> ALL($4::text[]) AND branch IS NOT NULL)
    ORDER BY coalesce(detail->>'of', detail->>'branch'), seq DESC) AS branches
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (detail->>'machine', detail->>'of') seq FROM activity WHERE project = $1 AND kind = 'main-state'
    ORDER BY detail->>'machine', detail->>'of', seq DESC) AS mains
  UNION ALL
  SELECT seq, true FROM (
    SELECT DISTINCT ON (kind = 'session-described', detail->>'of') seq FROM activity
    WHERE project = $1 AND kind IN ('session-archived', 'session-unarchived', 'session-described') AND detail->>'of' = ANY($2::text[])
    ORDER BY kind = 'session-described', detail->>'of', seq DESC) AS apps
  UNION ALL
  SELECT seq, true FROM (${MACHINE_STARTS}) AS starts
)
SELECT a.${ROW.split(", ").join(", a.")},
  CASE WHEN p.whole THEN a.detail
       WHEN a.kind = 'file-edited' THEN (a.detail - $5::text[]) || '{"files": []}'::jsonb
       ELSE a.detail - $5::text[] END AS detail
FROM (SELECT seq, bool_or(whole) AS whole FROM picked GROUP BY seq) p JOIN activity a ON a.seq = p.seq
ORDER BY a.seq`;

/** The values FOLD_LINES takes, after the project. */
export function foldValues(project: string, sessions: readonly string[], commandsSince: string): unknown[] {
  return [project, [...sessions], commandsSince, ABOUT_OTHERS, PLACING_ONLY];
}

/**
 * The lines that decide the state alone (working, waiting, gone or ended) of each session that wrote
 * a line of its own since $2, for a reader that shows nothing else of them (the status line): its
 * latest line, and the finish of a command it may be; the latest line of each kind that turns or ends;
 * and its commands started since $3 with no finish, with every turn's end, start and end after the
 * first of them; and each machine's latest start. Read as FOLD_LINES reads, these give each session the state its whole history gives.
 */
export const STATE_LINES = `
WITH own AS (
  SELECT seq, session, at, kind, detail->>'how' AS how, detail->>'call' AS call FROM activity
  WHERE project = $1 AND kind <> ALL($4::text[])
    AND session IN (SELECT session FROM activity WHERE project = $1 AND at >= $2::timestamptz AND kind <> ALL($4::text[]))
), unfinished AS (
  SELECT s.seq, s.session FROM own s
  WHERE s.kind = 'command-started' AND s.at >= $3::timestamptz
    AND NOT EXISTS (SELECT 1 FROM own r WHERE r.kind = 'command-run' AND r.session = s.session AND r.call = s.call)
), last_lines AS (
  SELECT DISTINCT ON (session) seq, session, kind, call FROM own ORDER BY session, seq DESC
), picked AS (
  SELECT seq, false AS whole FROM last_lines
  UNION ALL
  SELECT r.seq, false FROM last_lines s JOIN own r ON r.kind = 'command-run' AND r.session = s.session AND r.call = s.call
  WHERE s.kind = 'command-started'
  UNION ALL
  SELECT seq, false FROM (
    SELECT DISTINCT ON (session, kind, kind = 'session-started' AND how = 'compact') seq FROM own
    WHERE kind IN ('prompt-submitted', 'turn-ended', 'session-ended', 'session-started')
    ORDER BY session, kind, kind = 'session-started' AND how = 'compact', seq DESC) AS latest
  UNION ALL
  SELECT seq, true FROM unfinished
  UNION ALL
  SELECT o.seq, false FROM own o JOIN (SELECT session, min(seq) AS first FROM unfinished GROUP BY session) u ON u.session = o.session AND o.seq > u.first
  WHERE o.kind IN ('turn-ended', 'session-started', 'session-ended')
  UNION ALL
  SELECT seq, true FROM (${MACHINE_STARTS}) AS starts
)
SELECT a.${ROW.split(", ").join(", a.")},
  CASE WHEN p.whole THEN a.detail
       WHEN a.kind = 'file-edited' THEN (a.detail - $5::text[]) || '{"files": []}'::jsonb
       ELSE a.detail - $5::text[] END AS detail
FROM (SELECT seq, bool_or(whole) AS whole FROM picked GROUP BY seq) p JOIN activity a ON a.seq = p.seq
ORDER BY a.seq`;

/** The values STATE_LINES takes, after the project. */
export function stateValues(project: string, activeSince: string, commandsSince: string): unknown[] {
  return [project, activeSince, commandsSince, ABOUT_OTHERS, PLACING_ONLY];
}

/**
 * The sessions the running-sessions list may show at a time (capability 4): those that wrote since
 * $2, those with a branch still open or resolved since $2, those whose standing close-out is not
 * plainly safe, those that edited a folder on the main line that is dirty or was looked at since $2,
 * and those an app keeps unarchived. Every other session is hidden (the readings' `listing`), so the
 * fold need read no other. The holders of claims are added by the caller.
 */
export const SESSIONS_IN_VIEW = `
WITH branch_states AS (
  SELECT DISTINCT ON (coalesce(detail->>'of', detail->>'branch')) coalesce(detail->>'of', detail->>'branch') AS branch, at, kind, detail->>'open' AS open
  FROM activity WHERE project = $1 AND kind IN ('branch-state', 'merged')
  ORDER BY coalesce(detail->>'of', detail->>'branch'), seq DESC
), pairs AS (
  SELECT DISTINCT session, detail->>'branch' AS branch FROM activity
  WHERE project = $1 AND kind <> ALL($3::text[]) AND detail ? 'branch' AND detail->>'branch' NOT IN ('main', 'master')
), main_states AS (
  SELECT DISTINCT ON (detail->>'machine', detail->>'of') detail->>'machine' AS machine, detail->>'of' AS folder, at, detail->>'dirty' AS dirty
  FROM activity WHERE project = $1 AND kind = 'main-state' ORDER BY detail->>'machine', detail->>'of', seq DESC
), closes AS (
  SELECT DISTINCT ON (session) session, seq, detail->>'safe' AS safe, detail->>'running' AS running
  FROM activity WHERE project = $1 AND kind = 'closed-out' ORDER BY session, seq DESC
), records AS (
  SELECT DISTINCT ON (detail->>'of') detail->>'of' AS session, kind FROM activity
  WHERE project = $1 AND kind IN ('session-archived', 'session-unarchived') ORDER BY detail->>'of', seq DESC
)
SELECT session FROM activity WHERE project = $1 AND at >= $2::timestamptz AND kind <> ALL($3::text[])
UNION
SELECT p.session FROM pairs p LEFT JOIN branch_states b ON b.branch = p.branch
WHERE b.branch IS NULL OR (b.kind = 'branch-state' AND b.open = 'true') OR b.at >= $2::timestamptz
UNION
SELECT c.session FROM closes c
WHERE NOT EXISTS (SELECT 1 FROM activity r WHERE r.project = $1 AND r.session = c.session AND r.seq > c.seq
    AND (r.kind IN ('claimed', 'prompt-submitted') OR (r.kind = 'session-started' AND r.detail->>'how' IS DISTINCT FROM 'compact')))
  AND (c.safe IS DISTINCT FROM 'true' OR c.running IS DISTINCT FROM '0'
    OR EXISTS (SELECT 1 FROM activity t WHERE t.project = $1 AND t.session = c.session AND t.seq > c.seq AND t.kind = 'turn-ended' AND (t.detail->>'background')::int > 0))
UNION
SELECT o.session FROM activity o JOIN main_states m ON m.folder = o.folder AND m.machine IS NOT DISTINCT FROM o.detail->>'machine'
WHERE o.project = $1 AND o.kind = 'file-edited' AND o.detail->>'branch' IN ('main', 'master') AND (m.dirty = 'true' OR m.at >= $2::timestamptz)
UNION
SELECT session FROM records WHERE kind = 'session-unarchived'`;

/** The values SESSIONS_IN_VIEW takes, after the project. */
export function inViewValues(project: string, since: string): unknown[] {
  return [project, since, ABOUT_OTHERS];
}

/**
 * The branches worth a look on machine $2 (capability 4, ADR-0754 D4): for each branch the project's
 * lines name (off the main line, merge lines aside), when it was first and last worked on and the
 * latest folder this machine worked on it in, with its latest `branch-state` line, for those no line
 * has resolved, still open, worked on since, or taken for deleted by another machine. The caller
 * makes the last of those exact with what it remembers of its own looks.
 */
export const BRANCH_FACTS = `
WITH worked AS (
  SELECT detail->>'branch' AS branch, min(seq) AS first_seq, (array_agg(at ORDER BY seq))[1] AS first_at, (array_agg(at ORDER BY seq DESC))[1] AS last_at,
    (array_agg(folder ORDER BY seq DESC) FILTER (WHERE detail->>'machine' = $2::text AND folder IS NOT NULL))[1] AS worked_in
  FROM activity
  WHERE project = $1 AND detail ? 'branch' AND kind <> 'merged' AND detail->>'branch' NOT IN ('main', 'master')
  GROUP BY detail->>'branch'
), states AS (
  SELECT DISTINCT ON (detail->>'of') seq, detail->>'of' AS branch FROM activity WHERE project = $1 AND kind = 'branch-state'
  ORDER BY detail->>'of', seq DESC
)
SELECT w.branch, w.first_at, w.last_at, w.worked_in, a.${ROW.split(", ").join(", a.")}, a.detail
FROM worked w LEFT JOIN states s ON s.branch = w.branch LEFT JOIN activity a ON a.seq = s.seq
WHERE s.seq IS NULL OR a.detail->>'open' = 'true' OR w.last_at > a.at
  OR (a.detail->>'how' = 'deleted' AND w.worked_in IS NOT NULL AND a.detail ? 'machine' AND a.detail->>'machine' IS DISTINCT FROM $2::text)
ORDER BY w.first_seq`;

/**
 * The folders on machine $2 a session edited files inside, or claimed an increment in, on the main
 * line (ADR-0906), each with when it was last worked in, for those no look has found clean, or
 * worked in since one did. The caller keeps those still there.
 */
export const MAIN_WORK = `
WITH worked AS (
  SELECT o.folder, min(o.seq) AS first_seq, (array_agg(o.at ORDER BY o.seq DESC))[1] AS at FROM activity o
  WHERE o.project = $1 AND o.detail->>'machine' IS NOT DISTINCT FROM $2::text AND o.folder IS NOT NULL AND o.detail->>'branch' IN ('main', 'master')
    AND ((o.kind = 'claimed' AND o.detail ? 'increment')
      OR (o.kind = 'file-edited' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(o.detail->'files') AS f(file) WHERE ${INSIDE})))
  GROUP BY o.folder
), states AS (
  SELECT DISTINCT ON (detail->>'of') detail->>'of' AS folder, at, detail->>'dirty' AS dirty FROM activity
  WHERE project = $1 AND kind = 'main-state' AND detail->>'machine' IS NOT DISTINCT FROM $2::text
  ORDER BY detail->>'of', seq DESC
)
SELECT w.folder, w.at FROM worked w LEFT JOIN states s ON s.folder = w.folder
WHERE s.folder IS NULL OR s.dirty = 'true' OR w.at > s.at
ORDER BY w.first_seq`;

/** Every session that wrote a line of its own: how many there are, for a list that says how many it hides. */
export const SESSION_COUNT = "SELECT count(DISTINCT session) AS count FROM activity WHERE project = $1 AND kind <> ALL($2::text[])";

export function countValues(project: string): unknown[] {
  return [project, ABOUT_OTHERS];
}
