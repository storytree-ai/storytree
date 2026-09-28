/**
 * Capability 5 · Agent capability claims (the forest story): which agent holds which capability
 * right now, as a quiet dot at that capability's tree. It follows
 * the agent link's own readings of the log (claims and sessions, through its browser-safe
 * `readings` entry), so the forest and the claim tool always agree.
 *
 * Its shelf: a claim is never a sign of health, so a marker carries neither health nor state and
 * never changes how a tree is drawn. A missing hook never reads as an agent doing nothing
 * (ADR-0626 D4): a holder whose session has written no hook line is never faded as idle.
 * Missing hooks and their fixes are reported by the agent link's setup check. A holder with hook
 * evidence quiet past the quiet time fades; landing, releasing or its window
 * closing takes the marker away.
 */
import { claimsFrom, sessionsFrom, type Line } from "@storytree/agent-link/readings";

/** One agent's claim, as a marker at the capability it holds. */
export interface Marker {
  capability: string;
  session: string;
  /** Its holder has been quiet past the quiet time: it still holds the capability. */
  faded: boolean;
}

/** The markers `lines` show at time `now`: one per claim standing, in the order claimed. */
export function claimMarkers(lines: readonly Line[], now: Date): Marker[] {
  const sessions = new Map(sessionsFrom(lines, { now }).map((session) => [session.session, session]));
  // A marker stands at a capability; an increment's claim (ADR-0643) is the arc surface's to show.
  return claimsFrom(lines, { now }).flatMap((claim): Marker[] => {
    if (claim.capability === undefined) return [];
    const hooksNotRunning = sessions.get(claim.session)?.hooksRunning === false;
    return [{
      capability: claim.capability,
      session: claim.session,
      faded: claim.holder === "idle" && !hooksNotRunning,
    }];
  });
}
