// Capability 5 · Claims
import type { Line } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
import { labelOf, pullOf } from "../readings.js";
import { readClaims } from "./claims.js";
import { ends } from "./endings.js";

export type Lapse = {
  readonly increment: string;
  readonly capabilities: readonly string[];
  readonly at: string;
} & (
  | { readonly by: "manager"; readonly reason?: string }
  | { readonly by: "takeover"; readonly taker: string; readonly label: string }
);

type Held = { under?: string; increment: boolean; seq: number };

function takeover(line: Line, session: string): line is Line & { kind: "claimed" } {
  return line.kind === "claimed" && line.session !== session && line.takenOverFrom === session && pullOf(line.session) === undefined;
}

export async function lapsesOf(log: ActivityLog, project: string, session: string): Promise<Lapse[]> {
  const [own, others, taken] = await Promise.all([
    log.lines(project, { sessions: [session], kinds: ["claimed", "released", "landed"] }),
    log.lines(project, { kinds: ["released", "merged"], where: { holder: session } }),
    log.lines(project, { kinds: ["claimed"], where: { takenOverFrom: session } }),
  ]);
  const lines = [...new Map([...own, ...others, ...taken].map((line) => [line.seq, line] as const)).values()].sort((a, b) => a.seq - b.seq);
  const held = new Map<string, Held>();
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

export async function lapseNotice(log: ActivityLog, project: string, session: string): Promise<string | undefined> {
  const lapses = await lapsesOf(log, project, session);
  if (lapses.length === 0) return undefined;
  const claims = await readClaims(log, project);
  const told = lapses.filter((lapse) => lapse.by === "takeover" || !claims.some((claim) => claim.increment === lapse.increment));
  return told.length === 0 ? undefined : `[storytree] ${lapseMessage(told)}`;
}
