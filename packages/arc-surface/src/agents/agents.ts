/** Capability 2 · Agents on the board: decorate the agent link's own claim/session readings, never infer another holder. */
import { logReading, type Claim, type Line, type LogReading } from "@storytree/agent-link/readings";

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

/** `quietMs` is the user's idle-after setting; without it the readings' 30-minute default applies. */
export function agentsOnBoard(log: readonly Line[] | LogReading, now: Date = new Date(), quietMs?: number): BoardAgents {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const { fold } = logReading(log);
  const sessions = new Map(fold.sessions(judged).map((session) => [session.session, session]));
  const all = fold.claims(judged).map((claim): BoardAgent => {
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
