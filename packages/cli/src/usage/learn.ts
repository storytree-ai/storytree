// Capability 14 · Reading the doors' use
import { judgedByLines } from "@storytree/library/verbs";

import type { DeclaredVerb, DoorLine } from "./reading.js";

export const BARS = {
  days: 28,
  wantRefusals: 10,
  pointerFollows: 5,
  pointerSessions: 3,
  pointerShare: 0.7,
  cutSessions: 100,
  fallbackCalls: 5,
  fallbackShare: 0.5,
} as const;

export interface Want {
  readonly where: string;
  readonly word: string;
  readonly refusals: number;
  readonly sessions: number;
  readonly followed: readonly { readonly target: string; readonly count: number }[];
}

export interface Pointer {
  readonly where: string;
  readonly word: string;
  readonly to?: string;
  readonly others: readonly string[];
  readonly at: string;
}

export interface NewPointer {
  readonly where: string;
  readonly word: string;
  readonly to: string;
  readonly others: readonly string[];
  readonly follows: number;
  readonly sessions: number;
  readonly evidence: string;
}

export interface Fallback {
  readonly where: string;
  readonly word: string;
  readonly to: string;
  readonly calls: number;
  readonly left: number;
  readonly evidence: string;
}

export interface Candidate {
  readonly command?: string;
  readonly tool?: string;
}

export interface CutGroup {
  readonly group: string;
  readonly verbs: readonly Candidate[];
}

export interface Gap {
  readonly unused: string;
  readonly carriedBy: string;
  readonly calls: number;
}

export interface Lesson {
  readonly sessions: number;
  readonly wants: readonly Want[];
  readonly pointers: readonly NewPointer[];
  readonly fallbacks: readonly Fallback[];
  readonly cuts?: readonly CutGroup[];
  readonly unused?: readonly CutGroup[];
  readonly gaps: readonly Gap[];
}

export interface Surfaces {
  readonly commands: readonly DeclaredVerb[];
  readonly tools: readonly DeclaredVerb[];
  readonly twins: readonly { readonly command: string; readonly tool: string }[];
}

export const TOOLS_ALONE = "the tools with no command";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DoorTally {
  readonly sessions: number;
  readonly first?: string;
  readonly calls: ReadonlyMap<string, number>;
  readonly lines: readonly DoorLine[];
}

export function learnDoors({ sessions, first, calls, lines }: DoorTally, surfaces: Surfaces, since: string, pointers: readonly Pointer[] = [], mounted: ReadonlyMap<string, string> = new Map()): Lesson {
  const covered = first !== undefined && Date.parse(first) <= Date.parse(since) + DAY_MS;
  const { cuts, gaps } = disuse(calls, surfaces, (...verbs) => verbs.some((verb) => mounted.has(verb) && Date.parse(mounted.get(verb)!) <= Date.parse(since)));
  const tools = new Set(surfaces.tools.map(({ verb }) => verb));
  const latest = new Map(pointers.map((pointer) => [JSON.stringify([pointer.where, pointer.word]), pointer] as const));
  const words = guesses(lines, tools, latest);
  return {
    sessions,
    wants: words.filter(({ key, refusals, targets }) => refusals >= BARS.wantRefusals && !clearsPointerBar(targets) && latest.get(key)?.to === undefined)
      .map(({ where, word, refusals, sessions: by, targets }) => ({ where, word, refusals, sessions: by, followed: targets.map(({ target, count }) => ({ target, count })) })),
    pointers: words.filter(({ key, targets }) => clearsPointerBar(targets) && latest.get(key)?.to === undefined).map((guess) => {
      const [lead, ...others] = guess.targets;
      return { where: guess.where, word: guess.word, to: lead!.target, others: others.map(({ target }) => target), follows: lead!.count, sessions: lead!.sessions, evidence: evidenceOf({ ...guess, followed: guess.targets }) };
    }),
    fallbacks: fallbacks(lines, pointers),
    ...(covered && sessions >= BARS.cutSessions ? { cuts } : {}),
    ...(covered ? { unused: cuts } : {}),
    gaps,
  };
}

export function evidenceOf(guess: Pick<Want, "where" | "word" | "refusals" | "sessions" | "followed">): string {
  const hints = guess.followed.length === 0 ? "no hint was followed" : `hints followed: ${guess.followed.map(({ target, count }) => `${target} ${count}`).join(", ")}`;
  return `"${guess.where} ${guess.word}" refused as unknown ${guess.refusals} times in ${guess.sessions} sessions; ${hints}.`;
}

export function clearsPointerBar(followed: readonly { readonly target: string; readonly count: number; readonly sessions: number }[]): boolean {
  const [lead] = followed;
  const total = followed.reduce((sum, { count }) => sum + count, 0);
  return lead !== undefined && lead.count >= BARS.pointerFollows && lead.sessions >= BARS.pointerSessions && lead.count / total >= BARS.pointerShare;
}

interface Guess {
  readonly key: string;
  readonly where: string;
  readonly word: string;
  readonly refusals: number;
  readonly sessions: number;
  readonly targets: readonly { readonly target: string; readonly count: number; readonly sessions: number }[];
}

function guesses(lines: readonly DoorLine[], tools: ReadonlySet<string>, latest: ReadonlyMap<string, Pointer>): Guess[] {
  const words = new Map<string, { where: string; word: string; refusals: number; sessions: Set<string>; followed: Map<string, { count: number; sessions: Set<string> }> }>();
  const pending = new Map<string, { key: string; next: readonly string[] }>();
  for (const line of lines) {
    const before = pending.get(line.session);
    pending.delete(line.session);
    if (before !== undefined && line.outcome === "answered" && before.next.includes(line.verb)) {
      const followed = words.get(before.key)!.followed;
      const target = followed.get(line.verb) ?? { count: 0, sessions: new Set<string>() };
      target.count += 1;
      target.sessions.add(line.session);
      followed.set(line.verb, target);
    }
    if (line.door !== "command" || line.outcome !== "unknown" || line.word === undefined || line.pointedFrom !== undefined || tools.has(line.word) || /\s/.test(line.word)) continue;
    const key = JSON.stringify([line.verb, line.word]);
    const counted = words.get(key) ?? { where: line.verb, word: line.word, refusals: 0, sessions: new Set<string>(), followed: new Map() };
    counted.refusals += 1;
    counted.sessions.add(line.session);
    words.set(key, counted);
    const since = latest.get(key)?.at;
    if (since === undefined || line.at > since) pending.set(line.session, { key, next: line.next });
  }
  return [...words].map(([key, { where, word, refusals, sessions, followed }]) => ({
    key, where, word, refusals, sessions: sessions.size,
    targets: [...followed].map(([target, by]) => ({ target, count: by.count, sessions: by.sessions.size }))
      .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target)),
  })).sort((a, b) => b.refusals - a.refusals || a.where.localeCompare(b.where) || a.word.localeCompare(b.word));
}

function fallbacks(lines: readonly DoorLine[], pointers: readonly Pointer[]): Fallback[] {
  return pointers.flatMap(({ where, word, to, others, at }) => {
    if (to === undefined) return [];
    let calls = 0;
    let left = 0;
    const pending = new Set<string>();
    for (const line of lines) {
      if (line.at <= at || line.door !== "command") continue;
      if (pending.delete(line.session) && others.includes(line.verb)) left += 1;
      if (line.pointedFrom !== where || line.word !== word) continue;
      calls += 1;
      if (line.outcome === "answered") pending.add(line.session);
      else left += 1;
    }
    if (calls < BARS.fallbackCalls || left / calls <= BARS.fallbackShare) return [];
    return [{ where, word, to, calls, left, evidence: `"${where} ${word}" pointed to ${to} ${calls} times; ${left} of those sessions left it: the call did not answer, or the next command was another the word's hints had led to (${others.join(", ") || "none"}).` }];
  });
}

function disuse(calls: ReadonlyMap<string, number>, { commands, tools, twins }: Surfaces, old: (...verbs: string[]) => boolean): { cuts: CutGroup[]; gaps: Gap[] } {
  const agentOnly = new Set([...commands, ...tools].filter(({ consumers }) => judgedByLines(consumers)).map(({ verb }) => verb));
  const unused = (verb: string) => agentOnly.has(verb) && (calls.get(verb) ?? 0) === 0;
  const groups = new Map<string, Candidate[]>();
  const add = (group: string, candidate: Candidate) => groups.set(group, [...(groups.get(group) ?? []), candidate]);
  const gaps: Gap[] = [];
  const twinned = new Set<string>();
  const declared = new Set([...commands, ...tools].map(({ verb }) => verb));
  for (const { command, tool } of twins.filter(({ command, tool }) => declared.has(command) && declared.has(tool))) {
    twinned.add(command);
    twinned.add(tool);
    if (unused(command) && unused(tool)) {
      if (old(command, tool)) add(familyOf(command), { command, tool });
    } else if (unused(command)) gaps.push({ unused: command, carriedBy: tool, calls: calls.get(tool) ?? 0 });
    else if (unused(tool)) gaps.push({ unused: tool, carriedBy: command, calls: calls.get(command) ?? 0 });
  }
  for (const { verb } of commands) if (!twinned.has(verb) && unused(verb) && old(verb)) add(familyOf(verb), { command: verb });
  for (const { verb } of tools) if (!twinned.has(verb) && unused(verb) && old(verb)) add(TOOLS_ALONE, { tool: verb });
  const cuts = [...groups].map(([group, verbs]) => ({ group, verbs })).sort((a, b) => a.group.localeCompare(b.group));
  return { cuts, gaps: gaps.sort((a, b) => b.calls - a.calls || a.unused.localeCompare(b.unused)) };
}

function familyOf(command: string): string {
  return command.split(" ").slice(0, -1).join(" ");
}
