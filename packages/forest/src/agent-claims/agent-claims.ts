/**
 * Capability 5 · Agent capability claims (the forest story): each running session with a row in the
 * sessions list (capability 7) outlines the territory of each capability it claims, in its own colour,
 * the colour its row wears too (ADR-0825 D3). That outline is the only claim mark (ADR-0923): no
 * orbiting wisp (ADR-0736, ADR-0781), no coast tint (ADR-0804 D9), and an increment claim draws
 * nothing. It follows
 * Session management's own readings of the log (claims and sessions, through its browser-safe
 * `readings` entry), so the forest and the claim tool always agree.
 *
 * Its shelf: a claim is never a sign of health, so a wisp carries neither health nor state and
 * never changes how a tree is drawn, and no session colour is the proven green or the "needs you"
 * amber. A missing hook never reads as an agent doing nothing (ADR-0626 D4): a holder whose session
 * has written no hook line is never faded as idle. A holder with hook evidence quiet past the quiet
 * time fades; landing, releasing or its window closing takes the wisp away. Folded subagents and
 * lanes claim only in their parent's colour, through its wisp (ADR-0736 D4).
 */
import { sessionColour } from "@storytree/session-management/claim-mark";
import { logReading, type Line, type LogReading } from "@storytree/session-management/readings";
import type { SessionRow } from "../sessions-list/sessions-list.js";

/** A session's own colour, shared by its wisps, its row and its flags: Session management's, so every surface wears one. */
export { sessionColour };

/** One session's wisp round one island. */
export interface SessionWisp {
  session: string;
  story: string;
  colour: string;
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
  // A folded subagent claims in its parent's colour (5.5): its row's outlines are its own and its children's.
  const heldUnder = (row: SessionRow): string[] => [...held(row.id), ...row.children.flatMap(heldUnder)];
  return rows.flatMap(row => {
    const capabilities = [...new Set(heldUnder(row))];
    return row.stories.map(story => ({ session: row.id, story, colour: sessionColour(row.id), faded: quiet.has(row.id), capabilities }));
  });
}

/**
 * The sessions a growth replay shows at `now` (5.7): those recorded with the latest stage the replay has reached
 * (`at`, in the replay's seconds, in recorded order; of two at one moment the later recorded), none before the first.
 */
export function replayWisps(stages: readonly { at: number; wisps: readonly SessionWisp[] }[], now: number): readonly SessionWisp[] {
  let shown: readonly SessionWisp[] = [];
  for (const stage of stages) if (stage.at <= now) shown = stage.wisps;
  return shown;
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

