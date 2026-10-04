/** The forest's running sessions, read from the agent link; no transcript or liveness reader here. */
import { logReading, QUIET_MS, type Line, type LogReading, type OnMain, type PullState, type Session, type SessionState } from "@storytree/agent-link/readings";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import type { SessionWindow } from "@storytree/agent-link";
import type { RosterEntry } from "@storytree/knowledge-core";
import { sessionColour } from "../agent-claims/agent-claims.js";

/** Estimated tokens in each of a context's four groups (agent link 9.8): read as shares, not a second total. */
export interface ContextGroups {
  injected: number;
  grounding: number;
  implementation: number;
  other: number;
}

/** Facts about a session read elsewhere (the agent link's context reading, 9.5). Never inferred from prose. */
export interface SessionDetails {
  parentSession?: string;
  totalTokens?: number;
  composition?: ContextGroups | undefined;
  /** The user's context guidance in tokens, as the reading carried it (agent link 9.7). */
  guidance?: number | undefined;
}
/** A folder a session worked in: the branches it recorded there, and, when it recorded any, whether one still holds open work (unmerged) or none does (merged). */
export interface WorktreeRow {
  path: string;
  branches: string[];
  state?: "unmerged" | "merged";
  /** What its label says instead of unmerged, when an open branch there has a pull request (7.15): "PR #n", and what it waits on. */
  label?: string;
}

/** A command a session started and has not seen finish (7.16): its first words, its full text, and how long it has run. */
export interface RunningRow {
  words: string;
  command: string;
  ranMs: number;
}

export interface SessionRow {
  id: string;
  label: string;
  agent: string;
  /** A subagent start alone does not tell us whether the subagent is still running. */
  state: SessionState | "observed";
  /**
   * Folded into the list's "N idle" row, and not counted (ADR-0758 D1, D5): neither working, nor
   * waiting for you (a turn ended within the idle-after time). By its state alone; who is listed at all is the agent link's reading.
   */
  idle: boolean;
  /** When its session's lines were last seen; a subagent's, when it was started. */
  lastSeenAt: string;
  totalTokens: number | undefined;
  /** What those tokens are made of, when the reading could tell. */
  composition?: ContextGroups | undefined;
  /** Where the bar marks the user's context guidance, when the reading carried it. */
  guidance?: number | undefined;
  stories: string[];
  /** Every folder the session has worked in, oldest first (ADR-0749 D2), each labelled by its branch (7.15); none for an observed subagent. */
  worktrees: WorktreeRow[];
  /** The commands it has started and not seen finish, background ones included, oldest first (7.16). */
  running: RunningRow[];
  /** Up to three lines saying what it is doing (7.14), from recorded words only: its app's title, its increment's objective, its app's latest status. */
  description: string[];
  /** The machine it runs on, named only when the listed sessions span more than one (7.13). */
  machine?: string;
  /** Work it did on main rather than in a workspace, as the agent link flags it (4.26, ADR-0906); none when it did none. */
  onMain?: OnMain;
  children: SessionRow[];
}

/** The longest a row's name runs, as a claim reason is held (ADR-0737 D2). */
const LABEL_LIMIT = 40;

/**
 * The log is the lines themselves, or a reading that holds its sessions and claims folded and keeps
 * its claim and subagent lines.
 * One row per session that has not ended, claimed or not (ADR-0749 D1), each working or waiting by
 * its turns (ADR-0754 D5); one whose hooks report no turns is judged by `quietMs`, the user's
 * idle-after setting (the 30-minute default when the caller has none). A quiet session leaves by `leaveMs`,
 * the user's leave-after setting (the 1-hour default when the caller has none).
 */
export function sessionRows(tree: AnnotatedTree, log: readonly Line[] | LogReading, arcs: readonly ArcView[], now: Date,
  details: ReadonlyMap<string, SessionDetails> = new Map(), quietMs?: number, leaveMs?: number): SessionRow[] {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const { fold, lines } = logReading(log);
  const sessions = fold.sessions(leaveMs === undefined ? judged : { ...judged, leaveMs });
  // Who is listed is the agent link's reading (ADR-0754 D4, ADR-0758 D3): a verified close-out, or an ended or
  // silent session with no open work, is hidden.
  const ended = new Set(sessions.filter(session => session.listing === "hidden").map(session => session.session));
  const quiet = quietMs ?? QUIET_MS;
  const claims = fold.claims(judged);
  const increments = arcs.flatMap(arc => arc.increments);
  const storyOf = new Map(tree.stories.flatMap(story => [[story.id, story.id], ...story.capabilities.map(cap => [cap.id, story.id])] as [string, string][]));
  const rows = new Map<string, SessionRow>();
  const parents = new Map<string, string>();
  for (const session of sessions) {
    if (ended.has(session.session)) continue;
    const own = claims.filter(claim => claim.session === session.session);
    const heldIncrements = increments.filter(inc => own.some(claim => claim.increment === inc.id));
    const held = new Set(own.flatMap(claim => claim.capability ? [claim.capability] : []));
    for (const increment of heldIncrements) for (const id of increment.fields.touches ?? []) held.add(id);
    const detail = details.get(session.session);
    if (detail?.parentSession) parents.set(session.session, detail.parentSession);
    // The name a session gave itself comes first (7.18): eventually consistent, the row reads as before until it does.
    const label = (session.name === undefined ? undefined : fitted(session.name)) || own.find(claim => claim.reason.trim())?.reason.trim() || heldIncrements[0]?.fields.title
      || (session.title === undefined ? workingIn(session.label, lines, session.session, session.worktrees) : fitted(session.title));
    const objective = (heldIncrements[0]?.fields as { objective?: string } | undefined)?.objective?.trim();
    rows.set(session.session, { id: session.session, label,
      description: [session.title === label ? undefined : session.title, objective || undefined, session.status].filter((said): said is string => said !== undefined),
      agent: session.label, state: session.state,
      idle: session.state !== "working" && !(session.state === "waiting" && now.getTime() - Date.parse(session.lastSeenAt) <= quiet), lastSeenAt: session.lastSeenAt,
      totalTokens: contextTotal(detail), composition: detail?.composition, guidance: detail?.guidance,
      stories: [...new Set([...held].flatMap(id => storyOf.has(id) ? [storyOf.get(id)!] : []))], worktrees: worktreeRows(session),
      running: session.running.map(({ command, since }) => ({ words: commandWords(command), command, ranMs: Math.max(0, now.getTime() - Date.parse(since)) })),
      ...(session.onMain === undefined ? {} : { onMain: session.onMain }), children: [] });
  }
  // The activity API explicitly names parent and child; a task or matching folder never implies one.
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (line.kind !== "subagent-started" || ended.has(line.subagent) || !rows.has(line.session)) continue;
    if (!parents.has(line.subagent)) parents.set(line.subagent, details.get(line.subagent)?.parentSession ?? line.session);
    if (!rows.has(line.subagent)) rows.set(line.subagent, { id: line.subagent, label: line.task ?? line.type ?? "Subagent",
      agent: line.type ?? "Subagent", state: "observed", idle: false, lastSeenAt: line.at,
      totalTokens: contextTotal(details.get(line.subagent)), composition: details.get(line.subagent)?.composition, stories: [], worktrees: [], running: [], description: [], children: [] });
  }
  // Bad/missing relationship metadata must never lose a session or recurse forever.
  const roots: SessionRow[] = [];
  for (const row of rows.values()) {
    let ancestor = parents.get(row.id);
    const visited = new Set([row.id]);
    while (ancestor !== undefined && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    const parent = ancestor === undefined ? rows.get(parents.get(row.id) ?? "") : undefined;
    if (parent) parent.children.push(row);
    else roots.push(row);
  }
  function includeChildren(row: SessionRow): void {
    for (const child of row.children) includeChildren(child);
    row.stories = [...new Set([...row.stories, ...row.children.flatMap(child => child.stories)])];
  }
  for (const row of roots) includeChildren(row);
  for (const row of roots) row.idle &&= !row.children.some(child => child.state === "working");
  // A session's machine is the latest one its lines name; worth showing only when the list spans several.
  const machines = fold.machines();
  if (new Set(roots.flatMap(row => machines.has(row.id) ? [machines.get(row.id)!] : [])).size > 1) {
    for (const row of roots) if (machines.has(row.id)) row.machine = machines.get(row.id)!;
  }
  return roots;
}

/** The longest a running command's words run, ellipsis included. */
const WORDS_LIMIT = 48;
const WORDS_SHOWN = 5;

/** The first words of a command, held to one short line: cut with an ellipsis when it has more words, or they run past the limit. */
function commandWords(command: string): string {
  const all = command.trim().split(/\s+/);
  const words = all.slice(0, WORDS_SHOWN).join(" ");
  if (words.length > WORDS_LIMIT) return `${words.slice(0, WORDS_LIMIT - 1)}…`;
  return all.length > WORDS_SHOWN ? `${words}…` : words;
}

/** A session's worktrees, each with the branches recorded there (7.15); a branch with no folder to fold under is listed by its own name. */
function worktreeRows(session: Session): WorktreeRow[] {
  const folders = new Map<string, { branches: string[]; open: boolean; pr?: PullState }>(session.worktrees.map(path => [path, { branches: [], open: false }]));
  for (const { folder, branch, open, pr } of session.branchesByFolder) {
    const path = folder ?? session.worktrees.at(-1) ?? branch;
    const at = folders.get(path) ?? { branches: [], open: false };
    folders.set(path, at);
    if (!at.branches.includes(branch)) at.branches.push(branch);
    at.open ||= open;
    // The latest recorded open branch with a pull request names the worktree's.
    if (open && pr !== undefined) at.pr = pr;
  }
  return [...folders].map(([path, { branches, open, pr }]) => ({ path, branches,
    ...(branches.length === 0 ? {} : { state: open ? "unmerged" as const : "merged" as const }),
    ...(open && pr !== undefined ? { label: pullLabel(pr) } : {}) }));
}

/** A pull request as one short label (7.15): what it waits on, the merge queue before its checks, or its number alone. */
function pullLabel(pr: PullState): string {
  const waiting = pr.queued ? "in merge queue" : pr.draft ? "draft" : pr.checks === "failing" ? "failing" : pr.checks === "pending" ? "in CI" : undefined;
  return waiting === undefined ? `PR #${pr.number}` : `PR #${pr.number} · ${waiting}`;
}

/** How many listed sessions are at work, as the list's header counts them (ADR-0758 D1): every row not folded as idle. */
export function atWork(rows: readonly SessionRow[]): number {
  return rows.filter(row => !row.idle).length;
}

/**
 * An unclaimed session's name, when its app gives it no title (7.14): its harness and what it works in, the branch its latest claim was
 * taken on, or else the last folder it worked in, held to the label limit. Never an off-plan label.
 */
function workingIn(harness: string, lines: readonly Line[], session: string, worktrees: readonly string[]): string {
  const branch = lines.filter(line => line.session === session && line.kind === "claimed" && line.branch !== undefined)
    .sort((a, b) => a.seq - b.seq).at(-1);
  const place = branch?.kind === "claimed" ? branch.branch : worktrees.at(-1)?.split(/[\\/]/).filter(Boolean).at(-1);
  return fitted(place === undefined ? harness : `${harness} · ${place}`);
}

/** A name held to the label limit. */
function fitted(label: string): string {
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
}

/** How many sessions the core draws at once with none selected (owner, 2026-10-03: "show a max of 5 sessions (ordered by latest ones)"). */
const DRAWN_SESSIONS = 5;

/**
 * The knowledge core's roster (ADR-0738 D2): each listed row, in its own colour, with every child session under it.
 * With none selected the core draws only the five most recently seen rows that are not idle; the rest are marked
 * undrawn, still listed so a click selects one in its colour (owner, 2026-10-03).
 */
export function sessionRoster(rows: readonly SessionRow[]): RosterEntry[] {
  const members = (row: SessionRow): string[] => [row.id, ...row.children.flatMap(members)];
  const latest = (row: SessionRow): number => Math.max(Date.parse(row.lastSeenAt), ...row.children.map(latest));
  const drawn = new Set(rows.filter(row => !row.idle).sort((a, b) => latest(b) - latest(a)).slice(0, DRAWN_SESSIONS).map(row => row.id));
  return rows.map(row => ({ session: row.id, label: row.label, colour: sessionColour(row.id), members: members(row), ...(drawn.has(row.id) ? {} : { undrawn: true as const }) }));
}

/** The selection a click on a row leaves (ADR-0738 D5): its top-level session, a child's row its parent's, or none when that one was selected. */
export function clickedSelection(rows: readonly SessionRow[], clicked: string, selected: string | undefined): string | undefined {
  const holds = (row: SessionRow): boolean => row.id === clicked || row.children.some(holds);
  const top = rows.find(holds)?.id ?? clicked;
  return top === selected ? undefined : top;
}

function contextTotal(detail: SessionDetails | undefined): number | undefined {
  const total = detail?.totalTokens;
  return total !== undefined && Number.isFinite(total) && total >= 0 ? total : undefined;
}

/** A row's files, as its expansion lists them (7.8): each once, in the order first opened; or why there are none. */
export type SessionFiles = { files: { path: string; resident: boolean }[] } | { absent: string };

/** The files in a session's window reading (agent link 9.10), a file resident if any of its opens still is. */
export function windowFiles(window: SessionWindow): SessionFiles {
  if ("absent" in window) return { absent: window.absent };
  const files = new Map<string, boolean>();
  for (const open of window.opens) if (open.kind === "file") files.set(open.id, (files.get(open.id) ?? false) || open.resident);
  return { files: [...files].map(([path, resident]) => ({ path, resident })) };
}

/** How a past session ended, as its History row leads with it (7.21). */
export type HistoryOutcome = { kind: "landed"; prs: number[] } | { kind: "held"; question: string } | { kind: "closed-out" } | { kind: "no-close-out" };

/** A session the live list no longer lists, as the History tab shows it (7.21). */
export interface HistoryRow {
  id: string;
  label: string;
  agent: string;
  startedAt: string;
  lastSeenAt: string;
  /** How long it ran: its first line to its last. */
  ranMs: number;
  /** The stories it claimed work in, in the order claimed. */
  stories: { id: string; title: string }[];
  outcome: HistoryOutcome;
}

/** A span of time, from its first millisecond up to, not including, its end. */
export interface HistoryRange {
  from: number;
  to: number;
}

export type HistoryPreset = "today" | "yesterday" | "week";

const localDay = (at: Date, offset: number): number => new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset).getTime();

/** A preset's range in local days (7.21): today, yesterday, or the seven days ending today. */
export function presetRange(preset: HistoryPreset, now: Date): HistoryRange {
  const [from, to] = preset === "today" ? [0, 1] : preset === "yesterday" ? [-1, 0] : [-6, 1];
  return { from: localDay(now, from), to: localDay(now, to) };
}

/** A custom range of local days, as a date input gives them (YYYY-MM-DD), from the first's start to the last's end; none when either is unreadable or it ends before it starts. */
export function dayRange(first: string, last: string): HistoryRange | undefined {
  const day = (said: string): Date | undefined => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(said);
    return match === null ? undefined : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const from = day(first);
  const to = day(last);
  if (from === undefined || to === undefined || to < from) return undefined;
  return { from: from.getTime(), to: localDay(to, 1) };
}

/** Every time there is: History's rows for each past session, before a range narrows them. */
export const ALL_TIME: HistoryRange = { from: -Infinity, to: Infinity };

/** Whether a session was active in a range: its first line to its last overlaps it (7.21). */
function active(session: { startedAt: string; lastSeenAt: string }, range: HistoryRange): boolean {
  return Date.parse(session.startedAt) < range.to && Date.parse(session.lastSeenAt) >= range.from;
}

/** The history rows active in `range`, in their order. */
export function withinRange(rows: readonly HistoryRow[], range: HistoryRange): HistoryRow[] {
  return rows.filter(row => active(row, range));
}

/** A pull request as an increment's outcome records it ("#13", "13", or its address), as its number. */
function prNumber(pr: string | undefined): number | undefined {
  const digits = pr === undefined ? undefined : /(\d+)\s*$/.exec(pr)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * The sessions the live list no longer lists (7.1 hides them) whose first line to last overlaps `range`, latest first (7.21).
 * Read from the same log reading as the live rows: the agent link's fold keeps every session it was fed, and the
 * claims, closes and merges one by one, so no second reading is needed.
 */
export function historyRows(tree: AnnotatedTree, log: readonly Line[] | LogReading, arcs: readonly ArcView[], range: HistoryRange, now: Date,
  quietMs?: number, leaveMs?: number): HistoryRow[] {
  const { fold, lines } = logReading(log);
  const judged = { now, ...(quietMs === undefined ? {} : { quietMs }), ...(leaveMs === undefined ? {} : { leaveMs }) };
  const subagents = new Set(lines.flatMap(line => line.kind === "subagent-started" ? [line.subagent] : []));
  const increments = new Map(arcs.flatMap(arc => arc.increments).map(inc => [inc.id, inc]));
  const questions = new Map(arcs.flatMap(arc => arc.questions).map(question => [question.id, question]));
  const stories = new Map(tree.stories.map(story => [story.id, story]));
  const storyOf = new Map(tree.stories.flatMap(story => [[story.id, story.id], ...story.capabilities.map(cap => [cap.id, story.id])] as [string, string][]));
  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  return fold.sessions(judged).filter(session => session.listing === "hidden" && !subagents.has(session.session) && active(session, range)).map((session): HistoryRow => {
    const own = ordered.filter(line => line.session === session.session);
    const claimed = own.flatMap(line => line.kind === "claimed" ? [line] : []);
    const held = claimed.flatMap(line => line.increment === undefined ? [] : [increments.get(line.increment)]).filter(inc => inc !== undefined);
    const touched = [...new Set(claimed.flatMap(line => line.capability !== undefined ? [line.capability] : increments.get(line.increment ?? "")?.fields.touches ?? [])
      .flatMap(id => storyOf.has(id) ? [storyOf.get(id)!] : []))];
    const prs = [...new Set([
      ...ordered.flatMap(line => line.kind === "merged" && line.holder === session.session ? [line.pr] : []),
      ...own.flatMap(line => line.kind === "closed" && line.disposition === "landed" ? [prNumber(increments.get(line.increment)?.fields.outcome?.pr)] : []),
    ].filter((pr): pr is number => pr !== undefined))];
    const ran = [Date.parse(session.startedAt), Date.parse(session.lastSeenAt)] as const;
    const asked = held.flatMap(inc => inc.fields.heldOn ?? []).map(id => questions.get(id))
      .find(question => question !== undefined && Date.parse(question.createdAt) >= ran[0] && Date.parse(question.createdAt) <= ran[1]);
    // A close-out is read from the fold: the page's reading keeps no close-out lines one by one.
    const closedOut = session.closeOut !== undefined;
    const outcome: HistoryOutcome = prs.length > 0 ? { kind: "landed", prs } : asked !== undefined ? { kind: "held", question: asked.fields.title }
      : closedOut ? { kind: "closed-out" } : { kind: "no-close-out" };
    // Named as a live row is (7.18, 7.1, 7.14): its own name, its first claim's reason, its increment's title, its app's title, or where it worked.
    const label = (session.name === undefined ? undefined : fitted(session.name)) || claimed.find(line => line.reason.trim())?.reason.trim()
      || held[0]?.fields.title || (session.title === undefined ? workingIn(session.label, lines, session.session, session.worktrees) : fitted(session.title));
    return { id: session.session, label, agent: session.label, startedAt: session.startedAt, lastSeenAt: session.lastSeenAt,
      ranMs: Math.max(0, ran[1] - ran[0]), stories: touched.map(id => ({ id, title: stories.get(id)!.title })), outcome };
  }).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

/**
 * The roster the knowledge core is handed (7.22, 7.23): the live rows' alone, whichever tab is open and whatever range is
 * chosen; a selected history session joins it, undrawn, so the core draws it in its own colour.
 */
export function globeRoster(live: readonly SessionRow[], history: readonly HistoryRow[], selected: string | undefined): RosterEntry[] {
  const roster = sessionRoster(live);
  const past = roster.some(entry => entry.members.includes(selected ?? "")) ? undefined : history.find(row => row.id === selected);
  return past === undefined ? roster : [...roster, { session: past.id, label: past.label, colour: sessionColour(past.id), members: [past.id], undrawn: true }];
}

/** The selection a click on a history row leaves (7.23): its session, or none when it was the one selected. */
export function historySelection(clicked: string, selected: string | undefined): string | undefined {
  return clicked === selected ? undefined : clicked;
}
