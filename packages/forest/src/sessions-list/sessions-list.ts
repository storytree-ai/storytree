// Capability 7 · Running sessions
import { inCi, logReading, QUIET_MS, type LogReading, type PullState, type Session, type SessionState } from "@storytree/session-management/readings";
import type { AnnotatedTree, ArcView, Line } from "@storytree/library";
import { sessionColour } from "../agent-claims/agent-claims.js";

export type RosterEntry = { session: string; label: string; colour: string; members: readonly string[] };

export interface ContextGroups {
  injected: number;
  grounding: number;
  implementation: number;
  other: number;
}

export interface SessionDetails {
  parentSession?: string;
  totalTokens?: number;
  composition?: ContextGroups | undefined;
  guidance?: number | undefined;
}
export interface WorktreeRow {
  path: string;
  branches: string[];
  state?: "unmerged" | "merged";
  label?: string;
}

export interface SessionRow {
  id: string;
  label: string;
  agent: string;
  state: SessionState | "observed";
  idle: boolean;
  lastSeenAt: string;
  totalTokens: number | undefined;
  composition?: ContextGroups | undefined;
  guidance?: number | undefined;
  stories: string[];
  worktrees: WorktreeRow[];
  description: string[];
  machine?: string;
  children: SessionRow[];
}

const LABEL_LIMIT = 40;

export function sessionRows(tree: AnnotatedTree, log: readonly Line[] | LogReading, arcs: readonly ArcView[], now: Date,
  details: ReadonlyMap<string, SessionDetails> = new Map(), quietMs?: number, leaveMs?: number): SessionRow[] {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const { fold, lines } = logReading(log);
  const sessions = fold.sessions(leaveMs === undefined ? judged : { ...judged, leaveMs });
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
    const detail = details.get(session.session);
    if (detail?.parentSession) parents.set(session.session, detail.parentSession);
    const label = (session.name === undefined ? undefined : fitted(session.name)) || fittedAtWord(own.find(claim => claim.reason.trim())?.reason.trim() ?? "") || heldIncrements[0]?.fields.title
      || (session.title === undefined ? workingIn(session.label, lines, session.session, session.worktrees) : fitted(session.title));
    const objective = (heldIncrements[0]?.fields as { objective?: string } | undefined)?.objective?.trim();
    rows.set(session.session, { id: session.session, label,
      description: [session.title === label ? undefined : session.title, objective || undefined, session.status].filter((said): said is string => said !== undefined),
      agent: session.label, state: session.state,
      idle: session.state !== "working" && !(session.state === "waiting" && now.getTime() - Date.parse(session.lastSeenAt) <= quiet), lastSeenAt: session.lastSeenAt,
      totalTokens: contextTotal(detail), composition: detail?.composition, guidance: detail?.guidance,
      stories: [...new Set([...held].flatMap(id => storyOf.has(id) ? [storyOf.get(id)!] : []))], worktrees: worktreeRows(session),
      children: [] });
  }
  const finished = new Set(lines.flatMap(line => line.kind === "subagent-ended" ? [line.subagent] : []));
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (line.kind !== "subagent-started" || ended.has(line.subagent) || !rows.has(line.session)) continue;
    if (!parents.has(line.subagent)) parents.set(line.subagent, details.get(line.subagent)?.parentSession ?? line.session);
    if (!rows.has(line.subagent)) rows.set(line.subagent, { id: line.subagent, label: line.task ?? line.type ?? "Subagent",
      agent: line.type ?? "Subagent", ...(finished.has(line.subagent) ? { state: "ended", idle: true } : { state: "observed", idle: false }), lastSeenAt: line.at,
      totalTokens: contextTotal(details.get(line.subagent)), composition: details.get(line.subagent)?.composition, stories: [], worktrees: [], description: [], children: [] });
  }
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
  const machines = fold.machines();
  if (new Set(listedRows(roots).flatMap(row => machines.has(row.id) ? [machines.get(row.id)!] : [])).size > 1) {
    for (const row of roots) if (machines.has(row.id)) row.machine = machines.get(row.id)!;
  }
  return roots;
}

export function listedRows(rows: readonly SessionRow[]): SessionRow[] {
  return rows.filter(row => !row.idle);
}

function worktreeRows(session: Session): WorktreeRow[] {
  const folders = new Map<string, { branches: string[]; open: boolean; pr?: PullState }>(session.worktrees.map(path => [path, { branches: [], open: false }]));
  for (const { folder, branch, open, pr } of session.branchesByFolder) {
    const path = folder ?? session.worktrees.at(-1) ?? branch;
    const at = folders.get(path) ?? { branches: [], open: false };
    folders.set(path, at);
    if (!at.branches.includes(branch)) at.branches.push(branch);
    at.open ||= open;
    if (open && pr !== undefined) at.pr = pr;
  }
  return [...folders].map(([path, { branches, open, pr }]) => ({ path, branches,
    ...(branches.length === 0 ? {} : { state: open ? "unmerged" as const : "merged" as const }),
    ...(open && pr !== undefined ? { label: pullLabel(pr) } : {}) }));
}

function pullLabel(pr: PullState): string {
  const waiting = pr.queued ? "in merge queue" : pr.draft ? "draft" : pr.checks === "failing" ? "failing" : inCi(pr) ? "in CI" : undefined;
  return waiting === undefined ? `PR #${pr.number}` : `PR #${pr.number} · ${waiting}`;
}

function workingIn(harness: string, lines: readonly Line[], session: string, worktrees: readonly string[]): string {
  const branch = lines.filter(line => line.session === session && line.kind === "claimed" && line.branch !== undefined)
    .sort((a, b) => a.seq - b.seq).at(-1);
  const place = branch?.kind === "claimed" ? branch.branch : worktrees.at(-1)?.split(/[\\/]/).filter(Boolean).at(-1);
  return fitted(place === undefined ? harness : `${harness} · ${place}`);
}

function fitted(label: string): string {
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
}

function fittedAtWord(reason: string): string {
  const chars = [...reason];
  if (chars.length <= LABEL_LIMIT) return reason;
  const room = chars.slice(0, LABEL_LIMIT).join("");
  const words = room.slice(0, Math.max(0, room.search(/\s\S*$/)));
  return words ? `${words}…` : `${chars.slice(0, LABEL_LIMIT - 1).join("")}…`;
}

export function sessionRoster(rows: readonly SessionRow[]): RosterEntry[] {
  const members = (row: SessionRow): string[] => [row.id, ...row.children.flatMap(members)];
  return rows.map(row => ({ session: row.id, label: row.label, colour: sessionColour(row.id), members: members(row) }));
}

export function clickedSelection(rows: readonly SessionRow[], clicked: string, selected: string | undefined): string | undefined {
  const holds = (row: SessionRow): boolean => row.id === clicked || row.children.some(holds);
  const top = rows.find(holds)?.id ?? clicked;
  return top === selected ? undefined : top;
}

function contextTotal(detail: SessionDetails | undefined): number | undefined {
  const total = detail?.totalTokens;
  return total !== undefined && Number.isFinite(total) && total >= 0 ? total : undefined;
}
