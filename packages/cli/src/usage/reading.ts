// Capability 14 · Reading the doors' use
import type { Consumer } from "@storytree/library/verbs";
import { readToolUse } from "@storytree/mcp-server";

import { readCommandUse } from "./commands.js";
import { STEPS, stepOf, type Step } from "./steps.js";

export type Door = "command" | "tool";

export interface DoorLine {
  readonly session: string;
  readonly at: string;
  readonly harness?: string;
  readonly machine?: string;
  readonly door: Door;
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
  readonly next: readonly string[];
  readonly pointedFrom?: string;
}

export interface DeclaredVerb {
  readonly verb: string;
  readonly consumers: readonly Consumer[];
}

export interface Declared {
  readonly commands: readonly DeclaredVerb[];
  readonly tools: readonly DeclaredVerb[];
}

export interface Window {
  readonly since: string;
  readonly until: string;
}

export interface Surface { readonly door: Door; readonly verb: string; readonly declared: boolean; readonly consumers?: readonly Consumer[]; readonly judged: boolean; readonly calls: number; readonly sessions: number }
export interface Miss { readonly door: Door; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface Follow { readonly step: string; readonly offered: number; readonly answered: number; readonly followed: number; readonly baseline: { readonly calls: number; readonly took: number } }
export interface Repoint { readonly door: Door; readonly where: string; readonly word: string; readonly offered: number; readonly followed: readonly { readonly target: string; readonly count: number }[]; readonly none: number }
export interface Failure { readonly door: Door; readonly verb: string; readonly class: string; readonly count: number }
export interface Split { readonly by: "machine" | "harness" | "briefed"; readonly value: string; readonly command: number; readonly tool: number; readonly sessions: number; readonly unknown: number }

export interface Reading {
  readonly since: string;
  readonly until: string;
  readonly calls: Readonly<Record<Door, number>>;
  readonly sessions: number;
  readonly surfaces: readonly Surface[];
  readonly misses: readonly Miss[];
  readonly unknownPer1000: Readonly<Record<Door, number | null>>;
  readonly steps: readonly { readonly step: Step; readonly command: number; readonly tool: number }[];
  readonly follows: readonly Follow[];
  readonly repoints: readonly Repoint[];
  readonly failures: readonly Failure[];
  readonly refusals: readonly { readonly door: Door; readonly verb: string; readonly count: number }[];
  readonly splits: readonly Split[];
}

const UNNAMED = "unnamed";

export function countDoors(lines: readonly DoorLine[], declared: Declared, prompts: ReadonlyMap<string, number>, window: Window): Reading {
  const commands = readCommandUse(lines.filter((line) => line.door === "command"), declared.commands);
  const tools = readToolUse(lines.filter((line) => line.door === "tool"), declared.tools);
  const listed = (declaredOnes: boolean) => [...commands.surfaces, ...tools.surfaces].filter((surface) => surface.declared === declaredOnes);
  return {
    since: window.since,
    until: window.until,
    calls: { command: commands.calls, tool: tools.calls },
    sessions: new Set(lines.map((line) => line.session)).size,
    surfaces: [...listed(true), ...listed(false)],
    misses: [...commands.misses, ...tools.misses],
    unknownPer1000: { command: commands.unknownPer1000, tool: tools.unknownPer1000 },
    steps: STEPS.map((step) => ({
      step,
      command: lines.filter((line) => line.door === "command" && stepOf("command", line.verb) === step).length,
      tool: lines.filter((line) => line.door === "tool" && stepOf("tool", line.verb) === step).length,
    })),
    follows: follows(lines),
    repoints: repoints(lines),
    failures: [...commands.failures, ...tools.failures],
    refusals: [...commands.refusals, ...tools.refusals],
    splits: splits(lines, prompts),
  };
}

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

function repoints(lines: readonly DoorLine[]): Repoint[] {
  const words = new Map<string, { door: Door; where: string; word: string; offered: number; followed: Map<string, number> }>();
  for (const { line, after } of pairs(lines)) {
    if (line.outcome !== "unknown" || line.word === undefined || line.next.length === 0) continue;
    const key = JSON.stringify([line.door, line.verb, line.word]);
    const counted = words.get(key) ?? { door: line.door, where: line.verb, word: line.word, offered: 0, followed: new Map<string, number>() };
    counted.offered += 1;
    if (after !== undefined && after.outcome === "answered" && line.next.includes(after.verb)) counted.followed.set(after.verb, (counted.followed.get(after.verb) ?? 0) + 1);
    words.set(key, counted);
  }
  return [...words.values()].map(({ followed, ...counted }) => {
    const targets = [...followed].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));
    return { ...counted, followed: targets, none: counted.offered - targets.reduce((sum, { count }) => sum + count, 0) };
  }).sort((a, b) => b.offered - a.offered || a.where.localeCompare(b.where) || a.word.localeCompare(b.word));
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
