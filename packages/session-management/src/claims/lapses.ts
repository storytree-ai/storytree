/**
 * Capability 5 · Claims: the claims a session lost without asking, so the gate that next refuses it can say so (5.70),
 * and the prompt hook at its next turn's start (3.58).
 * A claim lapses when the session manager releases it from its stale-claim worklist, or when another session takes it
 * over while its holder's process is stopped (ADR-1311 D3). A session's end does not lapse it: its process stopped, and
 * its claims stand until it resumes or another session takes them over (4.41, ADR-1311 D1). A hand-over to the session's
 * own pull request is its own doing, so not a lapse. Work the session released, landed or saw close or merge is not
 * lapsed, and a session that has claimed anything since its lapses already knows where it stands.
 */
import type { Line } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
import { labelOf, pullOf } from "../readings.js";
import { readClaims } from "./claims.js";
import { ends } from "./endings.js";

/** One increment a session's claim on lapsed, with the capabilities it held under it, and the line that ended it. */
export type Lapse = {
  readonly increment: string;
  readonly capabilities: readonly string[];
  /** When the line that ended it was written. */
  readonly at: string;
} & (
  /** The session manager's release, with its reason. */
  | { readonly by: "manager"; readonly reason?: string }
  /** Another session's claim, taken over while the holder was stopped or quiet: who took it, and its harness as people call it. */
  | { readonly by: "takeover"; readonly taker: string; readonly label: string }
);

type Held = { under?: string; increment: boolean; seq: number };

/** Whether `line` is another session taking `session`'s claim over, not its own hand-over to its pull request. */
function takeover(line: Line, session: string): line is Line & { kind: "claimed" } {
  return line.kind === "claimed" && line.session !== session && line.takenOverFrom === session && pullOf(line.session) === undefined;
}

/**
 * The increments `session` lost without asking since it last claimed anything, oldest first, less any closed after
 * its claim. None when it never lapsed.
 */
export async function lapsesOf(log: ActivityLog, project: string, session: string): Promise<Lapse[]> {
  const [own, others, taken] = await Promise.all([
    log.lines(project, { sessions: [session], kinds: ["claimed", "released", "landed"] }),
    log.lines(project, { kinds: ["released", "merged"], where: { holder: session } }),
    log.lines(project, { kinds: ["claimed"], where: { takenOverFrom: session } }),
  ]);
  const lines = [...new Map([...own, ...others, ...taken].map((line) => [line.seq, line] as const)).values()].sort((a, b) => a.seq - b.seq);
  const held = new Map<string, Held>();
  // What lapsed since the session last claimed, by id, with the line that ended it.
  let lapsed = new Map<string, Held & { line: Line }>();
  for (const line of lines) {
    if (line.kind === "claimed" && line.session === session) {
      held.set((line.increment ?? line.capability)!, { ...(line.under === undefined ? {} : { under: line.under }), increment: line.increment !== undefined, seq: line.seq });
      lapsed = new Map();
      continue;
    }
    if (takeover(line, session)) {
      const id = (line.increment ?? line.capability)!;
      const claim = held.get(id);
      if (claim === undefined) continue;
      held.delete(id);
      lapsed.set(id, { ...claim, line });
      continue;
    }
    const lapsing = line.kind === "released" && line.holder === session && line.session !== session;
    for (const [id, claim] of held) {
      if (!ends(line, id, { session, under: claim.under })) continue;
      held.delete(id);
      if (lapsing) lapsed.set(id, { ...claim, line });
    }
  }
  const increments = [...lapsed].filter(([, claim]) => claim.increment);
  if (increments.length === 0) return [];
  const closings = await log.lines(project, { kinds: ["closed"], where: { increment: increments.map(([id]) => id) } });
  return increments
    .filter(([id, claim]) => !closings.some((closing) => closing.kind === "closed" && closing.increment === id && closing.seq > claim.seq))
    .map(([increment, { line }]): Lapse => {
      const capabilities = [...lapsed].filter(([, claim]) => !claim.increment && claim.under === increment).map(([id]) => id);
      if (line.kind === "claimed") return { increment, capabilities, at: line.at, by: "takeover", taker: line.session, label: labelOf(line.harness) };
      const reason = line.kind === "released" ? line.reason : undefined;
      return { increment, capabilities, at: line.at, by: "manager", ...(reason === undefined ? {} : { reason }) };
    });
}

/** What a refused session is told of `lapses`: which work, when, why, and the claim that takes it again. */
export function lapseMessage(lapses: readonly Lapse[]): string {
  return lapses.map((lapse) => {
    const with_ = lapse.capabilities.length === 0 ? "" : `, with ${lapse.capabilities.join(", ")} under it,`;
    const lapsed = `Your claim on ${lapse.increment}${with_} lapsed at ${lapse.at}`;
    if (lapse.by === "takeover") return `${lapsed}: ${lapse.label} session ${lapse.taker} took it over while your session was stopped or quiet. Leave it to that session unless it releases it.`;
    const why = `the session manager released it${lapse.reason === undefined ? "" : ` (${lapse.reason})`}`;
    const ids = [lapse.increment, ...lapse.capabilities].join(" ");
    return `${lapsed}: ${why}. Take it again before you edit (the claim tool, or \`storytree workspace claim ${ids} --reason …\`).`;
  }).join(" ");
}

/**
 * What a turn's start tells `session` of its lapsed claims (3.58), or undefined for none: on a checkout no gate refuses,
 * its edits would otherwise go through unclaimed. Work the manager released that another session holds now is that
 * session's, and not offered; work another session took over is told with who took it, even while it holds it (ADR-1311 D3).
 */
export async function lapseNotice(log: ActivityLog, project: string, session: string): Promise<string | undefined> {
  const lapses = await lapsesOf(log, project, session);
  if (lapses.length === 0) return undefined;
  const claims = await readClaims(log, project);
  const told = lapses.filter((lapse) => lapse.by === "takeover" || !claims.some((claim) => claim.increment === lapse.increment));
  return told.length === 0 ? undefined : `[storytree] ${lapseMessage(told)}`;
}
