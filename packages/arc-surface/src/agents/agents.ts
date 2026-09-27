/** Capability 2: decorate the agent link's own claim/session readings, never infer another holder. */
import { claimsFrom, sessionsFrom, type Claim, type Line } from "@storytree/agent-link/readings";

export type BoardAgent = Claim & {
  startedAt: string;
  lastSeenAt: string;
  hooksRunning: boolean;
  quietMinutes: number;
  activity: string;
};
export interface ArcWork {
  id: string;
  fields: { touches?: readonly string[] | undefined };
}
export interface BoardAgents {
  all: BoardAgent[];
  on(id: string): BoardAgent | undefined;
  onArc(increments: readonly ArcWork[]): BoardAgent[];
}

export function agentsOnBoard(lines: readonly Line[], now: Date = new Date()): BoardAgents {
  const sessions = new Map(sessionsFrom(lines, { now }).map((session) => [session.session, session]));
  const all = claimsFrom(lines, { now }).map((claim): BoardAgent => {
    // A claim is itself a session line, so every claim has a session reading.
    const session = sessions.get(claim.session)!;
    const quietMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(session.lastSeenAt)) / 60_000));
    return {
      ...claim,
      label: session.label,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      hooksRunning: session.hooksRunning,
      quietMinutes,
      activity: !session.hooksRunning ? "hooks not running" : claim.holder === "idle" ? `idle for ${quietMinutes} min` : "live",
    };
  });
  return {
    all,
    on: (id) => all.find((agent) => (agent.increment ?? agent.capability) === id),
    onArc(increments) {
      const own = new Set(increments.flatMap((increment) => [increment.id, ...(increment.fields.touches ?? [])]));
      return all.filter((agent) => own.has(agent.increment ?? agent.capability));
    },
  };
}
