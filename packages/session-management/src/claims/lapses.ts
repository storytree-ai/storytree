/**
 * Capability 5 · Claims: the claims a session lost without asking, so the gate that next refuses it can say so (5.70),
 * and the prompt hook at its next turn's start (3.58).
 * A claim lapses when its session ends (a "session-ended" line, which Claude Code writes each time a headless
 * `claude -p` turn's process exits, though `--resume` carries the same session on) or when the session manager
 * releases it from its stale-claim worklist. Work the session released, landed or saw close or merge is not lapsed,
 * and a session that has claimed anything since its latest lapse already knows where it stands.
 */
import type { Line } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
import { readClaims } from "./claims.js";
import { ends } from "./endings.js";

/** One increment a session's claim on lapsed, with the capabilities it held under it, and the line that ended them. */
export interface Lapse {
  readonly increment: string;
  readonly capabilities: readonly string[];
  /** When the line that ended it was written. */
  readonly at: string;
  /** What ended it: its session's end, or the session manager's release. */
  readonly by: "session-ended" | "manager";
  /** The harness's reason for the end, or the manager's for the release. */
  readonly reason?: string;
}

/**
 * The increments `session` last lost without asking, oldest first: those its latest lapse ended, when it has claimed
 * nothing since, less any closed after its claim. None when it never lapsed.
 */
export async function lapsesOf(log: ActivityLog, project: string, session: string): Promise<Lapse[]> {
  const [own, others] = await Promise.all([
    log.lines(project, { sessions: [session], kinds: ["claimed", "released", "landed", "session-ended"] }),
    log.lines(project, { kinds: ["released", "merged"], where: { holder: session } }),
  ]);
  const lines = [...new Map([...own, ...others].map((line) => [line.seq, line] as const)).values()].sort((a, b) => a.seq - b.seq);
  const held = new Map<string, { under?: string; increment: boolean; seq: number }>();
  let latest: { line: Line; ended: Map<string, { under?: string; increment: boolean; seq: number }> } | undefined;
  for (const line of lines) {
    if (line.kind === "claimed" && line.session === session) {
      held.set((line.increment ?? line.capability)!, { ...(line.under === undefined ? {} : { under: line.under }), increment: line.increment !== undefined, seq: line.seq });
      latest = undefined;
      continue;
    }
    const lapsing = line.kind === "session-ended" || (line.kind === "released" && line.holder === session && line.session !== session);
    const ended = new Map<string, { under?: string; increment: boolean; seq: number }>();
    for (const [id, claim] of held) {
      if (!ends(line, id, { session, under: claim.under })) continue;
      held.delete(id);
      ended.set(id, claim);
    }
    if (lapsing && ended.size > 0) latest = { line, ended };
  }
  if (latest === undefined) return [];
  const increments = [...latest.ended].filter(([, claim]) => claim.increment);
  if (increments.length === 0) return [];
  const closings = await log.lines(project, { kinds: ["closed"], where: { increment: increments.map(([id]) => id) } });
  const { line } = latest;
  const reason = line.kind === "session-ended" || line.kind === "released" ? line.reason : undefined;
  const by = { by: line.kind === "session-ended" ? "session-ended" as const : "manager" as const, ...(reason === undefined ? {} : { reason }) };
  return increments
    .filter(([id, claim]) => !closings.some((closing) => closing.kind === "closed" && closing.increment === id && closing.seq > claim.seq))
    .map(([increment]) => ({
      increment,
      capabilities: [...latest!.ended].filter(([, claim]) => !claim.increment && claim.under === increment).map(([id]) => id),
      at: line.at,
      ...by,
    }));
}

/** What a refused session is told of `lapses`: which work, when, why, and the claim that takes it again. */
export function lapseMessage(lapses: readonly Lapse[]): string {
  return lapses.map((lapse) => {
    const why = lapse.by === "session-ended"
      ? `your session ended${lapse.reason === undefined ? "" : ` (its harness said "${lapse.reason}")`}, which ends every claim a session holds; a headless run whose process exits with each turn ends its session that way, though the next turn resumes it`
      : `the session manager released it${lapse.reason === undefined ? "" : ` (${lapse.reason})`}`;
    const ids = [lapse.increment, ...lapse.capabilities].join(" ");
    const with_ = lapse.capabilities.length === 0 ? "" : `, with ${lapse.capabilities.join(", ")} under it,`;
    return `Your claim on ${lapse.increment}${with_} lapsed at ${lapse.at}: ${why}. Take it again before you edit (the claim tool, or \`storytree workspace claim ${ids} --reason …\`).`;
  }).join(" ");
}

/**
 * What a turn's start tells `session` of its lapsed claims (3.58), or undefined for none: on a checkout no gate refuses,
 * its edits would otherwise go through unclaimed. Work another session holds now is that session's, and not offered.
 */
export async function lapseNotice(log: ActivityLog, project: string, session: string): Promise<string | undefined> {
  const lapses = await lapsesOf(log, project, session);
  if (lapses.length === 0) return undefined;
  const claims = await readClaims(log, project);
  const free = lapses.filter((lapse) => !claims.some((claim) => claim.increment === lapse.increment));
  return free.length === 0 ? undefined : `[storytree] ${lapseMessage(free)}`;
}
