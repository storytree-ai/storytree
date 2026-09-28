/** The forest's running sessions, read from the agent link; no transcript or liveness reader here. */
import { claimsFrom, sessionsFrom, type Line, type SessionState } from "@storytree/agent-link/readings";
import type { AnnotatedTree, ArcView } from "@storytree/library";

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
}
export interface SessionRow {
  id: string;
  label: string;
  agent: string;
  /** A subagent start alone does not tell us whether the subagent is still running. */
  state: SessionState | "observed";
  needsYou: boolean;
  totalTokens: number | undefined;
  /** What those tokens are made of, when the reading could tell (a Codex reading cannot yet). */
  composition?: ContextGroups | undefined;
  stories: string[];
  children: SessionRow[];
}

export function sessionRows(tree: AnnotatedTree, lines: readonly Line[], arcs: readonly ArcView[], now: Date,
  details: ReadonlyMap<string, SessionDetails> = new Map()): SessionRow[] {
  const sessions = sessionsFrom(lines, { now });
  const ended = new Set(sessions.filter(session => session.state === "ended").map(session => session.session));
  const claims = claimsFrom(lines, { now });
  const increments = arcs.flatMap(arc => arc.increments);
  const storyOf = new Map(tree.stories.flatMap(story => [[story.id, story.id], ...story.capabilities.map(cap => [cap.id, story.id])] as [string, string][]));
  const rows = new Map<string, SessionRow>();
  const parents = new Map<string, string>();
  /** Sessions that earn a row of their own: they hold a claim. Unclaimed work earns none (ADR-0737 D1). */
  const listed = new Set<string>();
  for (const session of sessions) {
    if (session.state === "ended") continue;
    const own = claims.filter(claim => claim.session === session.session);
    const heldIncrements = increments.filter(inc => own.some(claim => claim.increment === inc.id));
    const held = new Set(own.flatMap(claim => claim.capability ? [claim.capability] : []));
    for (const increment of heldIncrements) for (const id of increment.fields.touches ?? []) held.add(id);
    const question = arcs.some(arc => arc.questions.some(q => q.fields.lifecycle === "open") &&
      arc.increments.some(inc => inc.fields.status !== "closed" && (heldIncrements.includes(inc) || inc.fields.touches?.some(id => held.has(id)))));
    if (own.length > 0) listed.add(session.session);
    const detail = details.get(session.session);
    if (detail?.parentSession) parents.set(session.session, detail.parentSession);
    rows.set(session.session, { id: session.session,
      label: own.find(claim => claim.reason.trim())?.reason.trim() || heldIncrements[0]?.fields.title || session.label,
      agent: session.label, state: session.state, needsYou: question,
      totalTokens: contextTotal(detail), composition: detail?.composition,
      stories: [...new Set([...held].flatMap(id => storyOf.has(id) ? [storyOf.get(id)!] : []))], children: [] });
  }
  // The activity API explicitly names parent and child; a task or matching folder never implies one.
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (line.kind !== "subagent-started" || ended.has(line.subagent) || !rows.has(line.session)) continue;
    if (!parents.has(line.subagent)) parents.set(line.subagent, details.get(line.subagent)?.parentSession ?? line.session);
    if (!rows.has(line.subagent)) rows.set(line.subagent, { id: line.subagent, label: line.task ?? line.type ?? "Subagent",
      agent: line.type ?? "Subagent", state: "observed", needsYou: false,
      totalTokens: contextTotal(details.get(line.subagent)), composition: details.get(line.subagent)?.composition, stories: [], children: [] });
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
  const earnsRow = (row: SessionRow): boolean => listed.has(row.id) || row.children.some(earnsRow);
  return roots.filter(earnsRow);
}

function contextTotal(detail: SessionDetails | undefined): number | undefined {
  const total = detail?.totalTokens;
  return total !== undefined && Number.isFinite(total) && total >= 0 ? total : undefined;
}
