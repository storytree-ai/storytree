/**
 * Capability 14 · Reading the doors' use. Repoint hints learned from the doors' own lines (ADR-1045 D2, D3): what sessions ran
 * next after a word the command line refused, and the up to three `next:` steps its refusal offers.
 *
 * - Learned: after each refusal of the same word in the same place, the session's next door-answered line, when it is a
 *   command that answered. A refused or failed next call, or a tool, teaches nothing.
 * - Offered: a mistake (a real verb, of either door, in the wrong place) leads with the right command for its job, the
 *   learned one first, else the hand-picked one; the rest, and every hint of a guess (a verb nowhere), are the most
 *   learned, then the hand-picked, then the nearest by spelling, rotated by `turn` so position does not choose. The
 *   hand-picked one always keeps a place, however many were learned.
 */
import type { DoorLine } from "./reading.js";

/** How far back a refusal learns from: ADR-1045 D3's 28 days. */
export const LEARN_DAYS = 28;

/** The most hints a refusal offers. */
const MOST = 3;

/** One offered step: the command, as its door names it, and why it is offered. */
export interface Hint {
  readonly command: string;
  readonly why: string;
}

/** The commands sessions ran next after `word` was refused in `where`, most often first, from their door-answered lines oldest first. */
export function learnedTargets(lines: readonly DoorLine[], where: string, word: string): { verb: string; count: number }[] {
  const counts = new Map<string, number>();
  const refused = new Set<string>();
  for (const line of lines) {
    if (refused.delete(line.session) && line.door === "command" && line.outcome === "answered") counts.set(line.verb, (counts.get(line.verb) ?? 0) + 1);
    if (line.outcome === "unknown" && line.door === "command" && line.verb === where && line.word === word) refused.add(line.session);
  }
  return [...counts].map(([verb, count]) => ({ verb, count })).sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb));
}

/** The hints a refusal offers, at most three, each command once. `right` is a mistake's command for its job, which leads. */
export function repointHints(candidates: { readonly right?: Hint; readonly learned: readonly Hint[]; readonly handPicked?: Hint; readonly spelled: readonly Hint[]; readonly turn: number }): Hint[] {
  const { right, learned, handPicked, spelled, turn } = candidates;
  const seen = new Set(right === undefined ? [] : [right.command]);
  const rest: Hint[] = [];
  for (const hint of [...learned, ...(handPicked === undefined ? [] : [handPicked]), ...spelled]) {
    if (seen.has(hint.command)) continue;
    seen.add(hint.command);
    rest.push(hint);
  }
  const room = right === undefined ? MOST : MOST - 1;
  // The hand-picked command keeps the last place when the learned ones would crowd it out.
  const picked = rest.findIndex((hint) => hint.command === handPicked?.command);
  const offered = picked >= room ? [...rest.slice(0, room - 1), rest[picked]!] : rest.slice(0, room);
  const shift = offered.length === 0 ? 0 : ((turn % offered.length) + offered.length) % offered.length;
  return [...(right === undefined ? [] : [right]), ...offered.slice(shift), ...offered.slice(0, shift)];
}
