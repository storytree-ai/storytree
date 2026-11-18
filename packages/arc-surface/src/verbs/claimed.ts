// Capability 3 · Arc surface.
import type { Holds } from "@storytree/library";
import { holdersOf, LogFold, LONGEST_COMMAND_MS, type LogReading } from "@storytree/session-management/readings";

import { agentsOnBoard, type ArcWork } from "../agents/agents.js";
import { claimedNow, claimWaitsNow } from "../board/board.js";
import type { ArcVerbContext } from "./context.js";

export async function claimsReading({ log, project }: Pick<ArcVerbContext, "log" | "project">, now: number): Promise<LogReading> {
  const claimLines = await log.standing(project);
  const holders = holdersOf(claimLines);
  const lines = holders.length === 0 ? [] : await log.foldLines(project, holders, new Date(now - LONGEST_COMMAND_MS - 60_000).toISOString());
  return { fold: LogFold.fromBounded(lines, claimLines), lines };
}

export async function holdsNow(context: Pick<ArcVerbContext, "library" | "log" | "project">, unread: Holds): Promise<Holds> {
  if (!Object.values(unread.waits).some((holds) => holds.some(({ claim }) => claim === true))) return unread;
  const now = Date.now();
  const agents = agentsOnBoard(await claimsReading(context, now), new Date(now)).all;
  const held = [...new Set(agents.flatMap(({ holder, increment }) => (holder === "live" && increment !== undefined ? [increment] : [])))];
  const increments = (await Promise.all(held.map((id) => context.library.get(id)))).flatMap((record) => (record === null ? [] : [record as unknown as ArcWork]));
  return { ...unread, waits: claimWaitsNow(unread.waits, claimedNow(agents, increments)) };
}
