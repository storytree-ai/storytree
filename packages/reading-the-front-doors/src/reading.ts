/**
 * Capability 1 · The reading (Reading the front doors, ADR-0998 D1): the counts of ADR-0983 D2 over one window of
 * `door-answered` lines, against the surfaces each door declares. A pure count: the lines and the
 * declared surfaces are handed in, so neither door is imported and either can front it.
 *
 * - Use per surface: every declared command and tool with its calls and sessions, those with none at
 *   zero; a verb neither door declares (the bare `storytree`, a family a word was refused in) is listed
 *   apart, never dropped.
 * - Misses: each word refused as unknown, where it was refused and the command the refusal named, and
 *   each door's unknowns per 1,000 of its calls.
 * - Follows: for each offered step, how often it was offered, how often the session's next call took
 *   it, and ADR-0786's like-for-like baseline: after the same previous verbs, with the step not offered.
 * - Door share per step, failures by class, and refusals (a "no" by design) apart from failures.
 * - Splits by machine, harness, and briefed: a session given at most one prompt, as a lane is given its
 *   brief and runs headless. The lines carry no other sign of a brief, so this is a reading, not a fact.
 */
import { STEPS, stepOf, type Step } from "./steps.js";

export type Door = "command" | "tool";

/** One `door-answered` line, as the reading needs it. */
export interface DoorLine {
  readonly session: string;
  /** When it was written (ISO 8601). */
  readonly at: string;
  readonly harness?: string;
  readonly machine?: string;
  readonly door: Door;
  /** The verb as its door names it: `storytree arc show`, `show_plan`. */
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
  readonly next: readonly string[];
}

/** The surfaces each door declares, from its own table: every command-line verb and every tool. */
export interface Declared {
  readonly commands: readonly string[];
  readonly tools: readonly string[];
}

export interface Window {
  readonly since: string;
  readonly until: string;
}

export interface Surface { readonly door: Door; readonly verb: string; readonly declared: boolean; readonly calls: number; readonly sessions: number }
export interface Miss { readonly door: Door; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface Follow { readonly step: string; readonly offered: number; readonly answered: number; readonly followed: number; readonly baseline: { readonly calls: number; readonly took: number } }
export interface Failure { readonly door: Door; readonly verb: string; readonly class: string; readonly count: number }
export interface Split { readonly by: "machine" | "harness" | "briefed"; readonly value: string; readonly command: number; readonly tool: number; readonly sessions: number; readonly unknown: number }

/** One window's reading. */
export interface Reading {
  readonly since: string;
  readonly until: string;
  readonly calls: Readonly<Record<Door, number>>;
  readonly sessions: number;
  readonly surfaces: readonly Surface[];
  readonly misses: readonly Miss[];
  /** Each door's unknowns per 1,000 of its calls; null for a door with no call. */
  readonly unknownPer1000: Readonly<Record<Door, number | null>>;
  readonly steps: readonly { readonly step: Step; readonly command: number; readonly tool: number }[];
  readonly follows: readonly Follow[];
  readonly failures: readonly Failure[];
  readonly refusals: readonly { readonly door: Door; readonly verb: string; readonly count: number }[];
  readonly splits: readonly Split[];
}

/** What a session with no machine or harness named is split under. */
const UNNAMED = "unnamed";

/** Count `lines`, the window's door-answered lines oldest first, against `declared`; `prompts` is how many prompts each session was given. */
export function countDoors(lines: readonly DoorLine[], declared: Declared, prompts: ReadonlyMap<string, number>, window: Window): Reading {
  const calls: Record<Door, number> = { command: 0, tool: 0 };
  const unknowns: Record<Door, number> = { command: 0, tool: 0 };
  for (const line of lines) {
    calls[line.door] += 1;
    if (line.outcome === "unknown") unknowns[line.door] += 1;
  }
  return {
    since: window.since,
    until: window.until,
    calls,
    sessions: new Set(lines.map((line) => line.session)).size,
    surfaces: surfaces(lines, declared),
    misses: misses(lines),
    unknownPer1000: { command: per1000(unknowns.command, calls.command), tool: per1000(unknowns.tool, calls.tool) },
    steps: STEPS.map((step) => ({
      step,
      command: lines.filter((line) => line.door === "command" && stepOf("command", line.verb) === step).length,
      tool: lines.filter((line) => line.door === "tool" && stepOf("tool", line.verb) === step).length,
    })),
    follows: follows(lines),
    failures: tally(lines.filter((line) => line.outcome === "failed"), (line) => [line.door, line.verb, line.class ?? UNNAMED] as const)
      .map(([[door, verb, kind], count]) => ({ door, verb, class: kind, count })),
    refusals: tally(lines.filter((line) => line.outcome === "refused"), (line) => [line.door, line.verb] as const)
      .map(([[door, verb], count]) => ({ door, verb, count })),
    splits: splits(lines, prompts),
  };
}

function per1000(count: number, of: number): number | null {
  return of === 0 ? null : Math.round((1000 * count) / of * 10) / 10;
}

function surfaces(lines: readonly DoorLine[], declared: Declared): Surface[] {
  const seen = new Map<string, { door: Door; verb: string; calls: number; sessions: Set<string> }>();
  const keyOf = (door: Door, verb: string) => `${door} ${verb}`;
  for (const line of lines) {
    const key = keyOf(line.door, line.verb);
    const surface = seen.get(key) ?? { door: line.door, verb: line.verb, calls: 0, sessions: new Set<string>() };
    surface.calls += 1;
    surface.sessions.add(line.session);
    seen.set(key, surface);
  }
  const listed = [...declared.commands.map((verb) => ["command", verb] as const), ...declared.tools.map((verb) => ["tool", verb] as const)];
  const declaredKeys = new Set(listed.map(([door, verb]) => keyOf(door, verb)));
  const byUse = (a: Surface, b: Surface) => (a.door === b.door ? 0 : a.door === "command" ? -1 : 1) || b.calls - a.calls || a.verb.localeCompare(b.verb);
  const known = [...new Map(listed.map(([door, verb]) => {
    const surface = seen.get(keyOf(door, verb));
    return [keyOf(door, verb), { door, verb, declared: true, calls: surface?.calls ?? 0, sessions: surface?.sessions.size ?? 0 }] as const;
  })).values()];
  const others = [...seen].filter(([key]) => !declaredKeys.has(key))
    .map(([, surface]) => ({ door: surface.door, verb: surface.verb, declared: false, calls: surface.calls, sessions: surface.sessions.size }));
  return [...known.sort(byUse), ...others.sort(byUse)];
}

function misses(lines: readonly DoorLine[]): Miss[] {
  return tally(lines.filter((line) => line.outcome === "unknown"), (line) => [line.door, line.verb, line.word ?? "", line.named ?? ""] as const)
    .map(([[door, where, word, named], count]) => ({ door, where, word, ...(named === "" ? {} : { named }), count }));
}

/** Each session's calls, in order, each with the call after it in the same session. */
function pairs(lines: readonly DoorLine[]): { line: DoorLine; after?: DoorLine }[] {
  const last = new Map<string, { line: DoorLine; after?: DoorLine }>();
  const out: { line: DoorLine; after?: DoorLine }[] = [];
  for (const line of lines) {
    const before = last.get(line.session);
    if (before !== undefined) before.after = line;
    const pair = { line };
    last.set(line.session, pair);
    out.push(pair);
  }
  return out;
}

function follows(lines: readonly DoorLine[]): Follow[] {
  const all = pairs(lines);
  const steps = [...new Set(all.flatMap(({ line }) => line.next))];
  return steps.map((step) => {
    const offering = all.filter(({ line }) => line.next.includes(step));
    const before = new Set(offering.map(({ line }) => line.verb));
    const unoffered = all.filter(({ line, after }) => after !== undefined && before.has(line.verb) && !line.next.includes(step));
    return {
      step,
      offered: offering.length,
      answered: offering.filter(({ after }) => after !== undefined).length,
      followed: offering.filter(({ after }) => after?.verb === step).length,
      baseline: { calls: unoffered.length, took: unoffered.filter(({ after }) => after?.verb === step).length },
    };
  }).sort((a, b) => b.offered - a.offered || a.step.localeCompare(b.step));
}

function splits(lines: readonly DoorLine[], prompts: ReadonlyMap<string, number>): Split[] {
  const values: { by: Split["by"]; value: (line: DoorLine) => string }[] = [
    { by: "machine", value: (line) => line.machine ?? UNNAMED },
    { by: "harness", value: (line) => line.harness ?? UNNAMED },
    { by: "briefed", value: (line) => ((prompts.get(line.session) ?? 0) <= 1 ? "briefed" : "not briefed") },
  ];
  return values.flatMap(({ by, value }) => {
    const groups = new Map<string, DoorLine[]>();
    for (const line of lines) {
      const name = value(line);
      const group = groups.get(name) ?? [];
      group.push(line);
      groups.set(name, group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => ({
      by, value: name,
      command: group.filter((line) => line.door === "command").length,
      tool: group.filter((line) => line.door === "tool").length,
      sessions: new Set(group.map((line) => line.session)).size,
      unknown: group.filter((line) => line.outcome === "unknown").length,
    }));
  });
}

/** How many of `items` share each key, most first, then in the order first seen. */
function tally<T, K extends readonly string[]>(items: readonly T[], keyOf: (item: T) => K): [K, number][] {
  const counts = new Map<string, [K, number]>();
  for (const item of items) {
    const key = keyOf(item);
    const id = JSON.stringify(key);
    const entry = counts.get(id);
    counts.set(id, [key, (entry?.[1] ?? 0) + 1]);
  }
  return [...counts.values()].sort((a, b) => b[1] - a[1]);
}
