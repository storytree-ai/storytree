/**
 * Capability 3 · Arc surface. Who holds what now, as the verbs read a wait on a capability's claim against it (ADR-1228 D1,
 * library 11.12; contracts 3.24 and 3.25): the claims standing in the activity log, folded with their holders' recent lines.
 */
import type { Holds } from "@storytree/library";
import { holdersOf, LogFold, LONGEST_COMMAND_MS, type LogReading } from "@storytree/session-management/readings";

import { agentsOnBoard, type ArcWork } from "../agents/agents.js";
import { claimedNow } from "../board/board.js";
import type { ArcVerbContext } from "./context.js";

/** The claims standing in `project`'s log, with their holders' lines recent enough to judge them live or idle at `now`. */
export async function claimsReading({ log, project }: Pick<ArcVerbContext, "log" | "project">, now: number): Promise<LogReading> {
  const claimLines = await log.standing(project);
  const holders = holdersOf(claimLines);
  const lines = holders.length === 0 ? [] : await log.foldLines(project, holders, new Date(now - LONGEST_COMMAND_MS - 60_000).toISOString());
  return { fold: LogFold.fromBounded(lines, claimLines), lines };
}

/**
 * Every hold, a wait on a capability's claim read against the capabilities live sessions hold now: `unread`, the library's
 * reading given no claims, as it is when it has no such wait, and read again with them when it has.
 */
export async function holdsNow(context: Pick<ArcVerbContext, "library" | "log" | "project">, unread: Holds): Promise<Holds> {
  if (!Object.values(unread.waits).some((holds) => holds.some(({ claim }) => claim === true))) return unread;
  const now = Date.now();
  const agents = agentsOnBoard(await claimsReading(context, now), new Date(now)).all;
  const held = [...new Set(agents.flatMap(({ holder, increment }) => (holder === "live" && increment !== undefined ? [increment] : [])))];
  const increments = (await Promise.all(held.map((id) => context.library.get(id)))).flatMap((record) => (record === null ? [] : [record as unknown as ArcWork]));
  return context.library.holds(new Date(now), { claimed: claimedNow(agents, increments) });
}
