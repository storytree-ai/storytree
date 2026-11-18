// Capability 14 · Reading the doors' use
import type { DoorLine } from "./reading.js";

export const LEARN_DAYS = 28;

const MOST = 3;

export interface Hint {
  readonly command: string;
  readonly why: string;
}

export function learnedTargets(lines: readonly DoorLine[], where: string, word: string): { verb: string; count: number }[] {
  const counts = new Map<string, number>();
  const refused = new Set<string>();
  for (const line of lines) {
    if (refused.delete(line.session) && line.door === "command" && line.outcome === "answered") counts.set(line.verb, (counts.get(line.verb) ?? 0) + 1);
    if (line.outcome === "unknown" && line.door === "command" && line.verb === where && line.word === word) refused.add(line.session);
  }
  return [...counts].map(([verb, count]) => ({ verb, count })).sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb));
}

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
  const picked = rest.findIndex((hint) => hint.command === handPicked?.command);
  const offered = picked >= room ? [...rest.slice(0, room - 1), rest[picked]!] : rest.slice(0, room);
  const shift = offered.length === 0 ? 0 : ((turn % offered.length) + offered.length) % offered.length;
  return [...(right === undefined ? [] : [right]), ...offered.slice(shift), ...offered.slice(0, shift)];
}
