/** Capability 2 · Agents on the board: decorate Session management's own claim/session readings, never infer another holder. */
import { logReading, pullOf, type Claim, type LogReading } from "@storytree/session-management/readings";
import type { Line } from "@storytree/library";

export type BoardAgent = Claim & {
  startedAt: string;
  lastSeenAt: string;
  hooksRunning: boolean;
  quietMinutes: number;
  activity: string;
};
export interface ArcWork {
  id: string;
  fields: { status: string; capabilities?: readonly string[] | undefined };
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
    const session = sessions.get(claim.session);
    // A claim is a session line, so it has a session reading, unless a handed-over pull request holds it (ADR-1037).
    if (session === undefined) {
      const pr = pullOf(claim.session);
      const quietMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(claim.since)) / 60_000));
      return { ...claim, label: `Pull request #${pr}`, startedAt: claim.since, lastSeenAt: claim.since, hooksRunning: false, quietMinutes,
        activity: `held for pull request #${pr} until it merges or closes` };
    }
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
    // ADR-0949 D1: only its open increments' claims, a capability claim counting toward the increment it was taken under.
    onArc(increments) {
      const open = new Set(increments.filter(({ fields }) => fields.status !== "closed").map(({ id }) => id));
      return all.filter((agent) => open.has(agent.increment ?? agent.under ?? ""));
    },
  };
}
