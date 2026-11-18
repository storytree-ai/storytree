// Capability 5 · Agent capability claims
import { sessionColour } from "@storytree/session-management/claim-mark";
import { logReading, type LogReading } from "@storytree/session-management/readings";
import type { Line } from "@storytree/library";
import type { SessionRow } from "../sessions-list/sessions-list.js";

export { sessionColour };

export interface SessionWisp {
  session: string;
  story: string;
  colour: string;
  faded: boolean;
  capabilities: string[];
  pointer?: { capability: string; gate?: string; question?: string };
}

export function sessionWisps(rows: readonly SessionRow[], log: readonly Line[] | LogReading, now: Date, quietMs?: number): SessionWisp[] {
  const judged = quietMs === undefined ? { now } : { now, quietMs };
  const { fold } = logReading(log);
  const sessions = fold.sessions(judged);
  const hooked = new Set(sessions.filter(session => session.hooksRunning).map(session => session.session));
  const pointers = new Map(sessions.flatMap(({ session, pointer }) => pointer === undefined ? [] : [[session, { capability: pointer.capability, ...(pointer.gate === undefined ? {} : { gate: pointer.gate }), ...(pointer.question === undefined ? {} : { question: pointer.question }) }] as const]));
  const claims = fold.claims(judged);
  const quiet = new Set(claims.filter(claim => claim.holder === "idle" && hooked.has(claim.session)).map(claim => claim.session));
  const held = (session: string) => claims.flatMap(claim => (claim.session === session && claim.capability !== undefined ? [claim.capability] : []));
  const heldUnder = (row: SessionRow): string[] => [...held(row.id), ...row.children.flatMap(heldUnder)];
  return rows.flatMap(row => {
    const capabilities = [...new Set(heldUnder(row))];
    const pointer = pointers.get(row.id);
    const stories = row.stories.length === 0 && pointer !== undefined ? [""] : row.stories;
    return stories.map(story => ({ session: row.id, story, colour: sessionColour(row.id), faded: quiet.has(row.id), capabilities, ...(pointer === undefined ? {} : { pointer }) }));
  });
}

export function replayWisps(stages: readonly { at: number; wisps: readonly SessionWisp[] }[], now: number): readonly SessionWisp[] {
  let shown: readonly SessionWisp[] = [];
  for (const stage of stages) if (stage.at <= now) shown = stage.wisps;
  return shown;
}

export interface ClaimTint {
  colour: string;
  faded: boolean;
}

export function claimTints(wisps: readonly SessionWisp[]): Map<string, ClaimTint> {
  const tints = new Map<string, ClaimTint>();
  for (const wisp of wisps) for (const capability of wisp.capabilities) if (!tints.has(capability)) tints.set(capability, { colour: wisp.colour, faded: wisp.faded });
  return tints;
}


export interface PointerTint {
  colour: string;
  gate?: readonly [string, string];
}

export function shownPointers(wisps: readonly SessionWisp[], circled: ReadonlySet<string> | undefined): Map<string, PointerTint> {
  const shown = new Map<string, PointerTint>();
  for (const { pointer, colour } of wisps) {
    if (pointer === undefined) continue;
    const gate = pointer.gate === undefined ? undefined : [pointer.capability, pointer.gate].sort() as [string, string];
    const key = gate === undefined ? pointer.capability : gate.join("|");
    if (shown.has(key)) continue;
    if (pointer.question !== undefined || (gate ?? [pointer.capability]).some(capability => circled?.has(capability) === true)) shown.set(key, { colour, ...(gate === undefined ? {} : { gate }) });
  }
  return shown;
}
