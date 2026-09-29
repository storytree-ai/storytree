/** The forest's running sessions, read from the agent link; no transcript or liveness reader here. */
import { claimsFrom, QUIET_MS, sessionsFrom, type Line, type SessionState } from "@storytree/agent-link/readings";
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
export interface SessionRow {
  id: string;
  label: string;
  agent: string;
  /** A subagent start alone does not tell us whether the subagent is still running. */
  state: SessionState | "observed";
  needsYou: boolean;
  /** Why it needs you, when its close-out says so (ADR-0758 D3): its own why, or where a yes disagrees with the facts. */
  needsYouWhy?: string;
  /**
   * Folded into the list's "N idle" row, and not counted (ADR-0758 D1, D5): neither working, nor
   * waiting for you (a turn ended within the idle-after time), nor needing you.
   */
  idle: boolean;
  totalTokens: number | undefined;
  /** What those tokens are made of, when the reading could tell. */
  composition?: ContextGroups | undefined;
  /** Where the bar marks the user's context guidance, when the reading carried it. */
  guidance?: number | undefined;
  stories: string[];
  /** Every folder the session has worked in, oldest first (ADR-0749 D2); none for an observed subagent. */
  worktrees: string[];
  /** Its branches that still hold unmerged work (ADR-0754 D4): a session that has not cleaned up, marked so it can be looked into. */
  unmerged: string[];
  children: SessionRow[];
}

/** The longest a row's name runs, as a claim reason is held (ADR-0737 D2). */
const LABEL_LIMIT = 40;

/**
 * One row per session that has not ended, claimed or not (ADR-0749 D1), each working or waiting by
 * its turns (ADR-0754 D5); one whose hooks report no turns is judged by `quietMs`, the user's
 * idle-after setting (the 30-minute default when the caller has none). A quiet session leaves by `leaveMs`,
 * the user's leave-after setting (the 1-hour default when the caller has none).
 */
export function sessionRows(tree: AnnotatedTree, lines: readonly Line[], arcs: readonly ArcView[], now: Date,
  details: ReadonlyMap<string, SessionDetails> = new Map(), quietMs?: number, leaveMs?: number): SessionRow[] {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const sessions = sessionsFrom(lines, leaveMs === undefined ? judged : { ...judged, leaveMs });
  // Who is listed is the agent link's reading (ADR-0754 D4, ADR-0758 D3): a verified close-out, or an ended or
  // silent session with no open work, is hidden.
  const ended = new Set(sessions.filter(session => session.listing === "hidden").map(session => session.session));
  const quiet = quietMs ?? QUIET_MS;
  const claims = claimsFrom(lines, judged);
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
    const question = arcs.some(arc => arc.questions.some(q => q.fields.lifecycle === "open") &&
      arc.increments.some(inc => inc.fields.status !== "closed" && (heldIncrements.includes(inc) || inc.fields.touches?.some(id => held.has(id)))));
    const detail = details.get(session.session);
    if (detail?.parentSession) parents.set(session.session, detail.parentSession);
    rows.set(session.session, { id: session.session,
      label: own.find(claim => claim.reason.trim())?.reason.trim() || heldIncrements[0]?.fields.title || workingIn(session.label, lines, session.session, session.worktrees),
      agent: session.label, state: session.state, needsYou: question || session.closeOut?.needsYou !== undefined,
      ...(session.closeOut?.needsYou === undefined ? {} : { needsYouWhy: session.closeOut.needsYou }),
      idle: session.state !== "working" && !(session.state === "waiting" && now.getTime() - Date.parse(session.lastSeenAt) <= quiet),
      totalTokens: contextTotal(detail), composition: detail?.composition, guidance: detail?.guidance,
      stories: [...new Set([...held].flatMap(id => storyOf.has(id) ? [storyOf.get(id)!] : []))], worktrees: session.worktrees,
      unmerged: session.openWork, children: [] });
  }
  // The activity API explicitly names parent and child; a task or matching folder never implies one.
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (line.kind !== "subagent-started" || ended.has(line.subagent) || !rows.has(line.session)) continue;
    if (!parents.has(line.subagent)) parents.set(line.subagent, details.get(line.subagent)?.parentSession ?? line.session);
    if (!rows.has(line.subagent)) rows.set(line.subagent, { id: line.subagent, label: line.task ?? line.type ?? "Subagent",
      agent: line.type ?? "Subagent", state: "observed", needsYou: false, idle: false,
      totalTokens: contextTotal(details.get(line.subagent)), composition: details.get(line.subagent)?.composition, stories: [], worktrees: [], unmerged: [], children: [] });
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
    row.needsYou ||= row.children.some(child => child.needsYou);
    row.stories = [...new Set([...row.stories, ...row.children.flatMap(child => child.stories)])];
  }
  for (const row of roots) includeChildren(row);
  for (const row of roots) row.idle &&= !row.needsYou && !row.children.some(child => child.state === "working");
  return roots;
}

/** How many listed sessions are at work, as the list's header counts them (ADR-0758 D1): every row not folded as idle. */
export function atWork(rows: readonly SessionRow[]): number {
  return rows.filter(row => !row.idle).length;
}

/**
 * An unclaimed session's name: its harness and what it works in, the branch its latest claim was
 * taken on, or else the last folder it worked in, held to the label limit. Never an off-plan label.
 */
function workingIn(harness: string, lines: readonly Line[], session: string, worktrees: readonly string[]): string {
  const branch = lines.filter(line => line.session === session && line.kind === "claimed" && line.branch !== undefined)
    .sort((a, b) => a.seq - b.seq).at(-1);
  const place = branch?.kind === "claimed" ? branch.branch : worktrees.at(-1)?.split(/[\\/]/).filter(Boolean).at(-1);
  const label = place === undefined ? harness : `${harness} · ${place}`;
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
}

/** The knowledge core's roster (ADR-0738 D2): each listed row, in its own colour, with every child session under it. */
export function sessionRoster(rows: readonly SessionRow[]): RosterEntry[] {
  const members = (row: SessionRow): string[] => [row.id, ...row.children.flatMap(members)];
  return rows.map(row => ({ session: row.id, label: row.label, colour: sessionColour(row.id), members: members(row) }));
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
