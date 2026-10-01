/**
 * Capability 5 · Agent capability claims (the forest story): each running session with a row in the
 * sessions list (capability 7) marks the island of each story it holds a claim in, in its own colour,
 * the colour its row wears too. Since ADR-0804 D9 the mark is no orbiting wisp (ADR-0736, ADR-0781):
 * it tints the island's coast, split into one arc per session, and fills the territory of each
 * capability it claims faintly in its colour. It follows
 * the agent link's own readings of the log (claims and sessions, through its browser-safe
 * `readings` entry), so the forest and the claim tool always agree.
 *
 * Its shelf: a claim is never a sign of health, so a wisp carries neither health nor state and
 * never changes how a tree is drawn, and no session colour is the proven green or the "needs you"
 * amber. A missing hook never reads as an agent doing nothing (ADR-0626 D4): a holder whose session
 * has written no hook line is never faded as idle. A holder with hook evidence quiet past the quiet
 * time fades; landing, releasing or its window closing takes the wisp away. Folded subagents and
 * lanes orbit only through their parent's wisp (ADR-0736 D4).
 */
import { logReading, type Line, type LogReading } from "@storytree/agent-link/readings";
import type { SessionRow } from "../sessions-list/sessions-list.js";

/** One session's wisp round one island. */
export interface SessionWisp {
  session: string;
  story: string;
  colour: string;
  /** Where on its orbit the wisp starts, in degrees, the same on every read. */
  phase: number;
  /** Its holder has been quiet past the quiet time: it still holds its claims. */
  faded: boolean;
  /** The capabilities it holds a claim on. */
  capabilities: string[];
}

/** The wisps the listed `rows` draw at time `now`: one per row and island, in list order. */
export function sessionWisps(rows: readonly SessionRow[], log: readonly Line[] | LogReading, now: Date, quietMs?: number): SessionWisp[] {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const { fold } = logReading(log);
  // Faded by the claim's quiet time, as takeover judges it, never by a session waiting between turns (ADR-0754 D5).
  const hooked = new Set(fold.sessions(judged).filter(session => session.hooksRunning).map(session => session.session));
  const claims = fold.claims(judged);
  const quiet = new Set(claims.filter(claim => claim.holder === "idle" && hooked.has(claim.session)).map(claim => claim.session));
  const held = (session: string) => claims.flatMap(claim => (claim.session === session && claim.capability !== undefined ? [claim.capability] : []));
  return rows.flatMap(row => row.stories.map(story => ({ session: row.id, story, colour: sessionColour(row.id),
    phase: (hashOf(row.id) >>> 8) % 360, faded: quiet.has(row.id), capabilities: held(row.id) })));
}

/** One session's share of an island's coast: from and to as fractions of the way round. */
export interface CoastArc {
  session: string;
  colour: string;
  faded: boolean;
  from: number;
  to: number;
}

/** The coast of `story`'s island split into one equal arc per session working on it, in list order (as a shared note's ring is, ADR-0754). */
export function coastArcs(wisps: readonly SessionWisp[], story: string): CoastArc[] {
  const here = wisps.filter(wisp => wisp.story === story);
  return here.map((wisp, at) => ({ session: wisp.session, colour: wisp.colour, faded: wisp.faded, from: at / here.length, to: (at + 1) / here.length }));
}

/** A claimed capability's tint: its claimant's colour, and whether the claimant has gone quiet. */
export interface ClaimTint {
  colour: string;
  faded: boolean;
}

/** Each claimed capability's tint; the first listed session's, when two hold it. */
export function claimTints(wisps: readonly SessionWisp[]): Map<string, ClaimTint> {
  const tints = new Map<string, ClaimTint>();
  for (const wisp of wisps) for (const capability of wisp.capabilities) if (!tints.has(capability)) tints.set(capability, { colour: wisp.colour, faded: wisp.faded });
  return tints;
}

/** Hues a session may wear: clear of the "needs you" amber and of every green (30°–170°). */
const FIRST_HUE = 170;
const HUE_SPAN = 220;

/** A session's own colour, the same on every read, shared by its wisps and its row. */
export function sessionColour(session: string): string {
  return `hsl(${Math.round(FIRST_HUE + hashOf(session) % HUE_SPAN) % 360}, 80%, 68%)`;
}

function hashOf(session: string): number {
  let hash = 2166136261;
  for (const char of session) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  // Spread ids that differ only in their last letter (session-1, session-2) across the whole span.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}
