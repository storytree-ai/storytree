// Capability 4 · Drill-down
import type { AnnotatedContract, AnnotatedStory, AnnotatedTree, CapabilityStatus, CapabilityWhy, Change, EarlierVerdict, HealthColumn, HealthSource, HealthState, OpenWait } from "@storytree/library";


import { grove, type PartStates } from "../capability-tree/capability-tree.js";
import { microscope, type Microscope, type ScopeSurvey } from "./microscope.js";

export interface ContractLine {
  id: string;
  title: string;
  reported: HealthState;
  trail: string;
  verified?: HealthState;
  source?: HealthSource;
  lastSeen?: EarlierVerdict;
  ran?: { at: string; tests?: string[] };
  gear?: CheckReading;
  local?: CheckReading;
  acceptance?: AcceptanceState;
}

export interface CheckReading {
  state: HealthState;
  source?: HealthSource;
  at?: string;
}

export type AcceptanceState = "passed" | "failed" | "not-run";

export interface WhyLine {
  reason: CapabilityWhy["reason"];
  mover: CapabilityWhy["mover"];
  contracts: string[];
  since?: string;
  sources?: HealthSource[];
}

export interface CapabilityLine {
  id: string;
  title: string;
  description: string;
  parent?: string;
  inside?: string[];
  reported: HealthState;
  verified?: HealthState;
  sources?: HealthSource[];
  status: CapabilityStatus;
  contracts: ContractLine[];
  why?: WhyLine;
  reportOnly?: true;
  parkedOn?: { arc: string; title: string }[];
  openWork?: { increment: string; title: string; active?: true; waits?: OpenWait[] }[];
}

export interface EdgeLine {
  from: string;
  fromTitle: string;
  to: string;
  toTitle: string;
  description?: string;
  contracts: ContractLine[];
}

export interface StoryPanel {
  story: string;
  title: string;
  description: string;
  capabilities: CapabilityLine[];
  edges?: EdgeLine[];
  mapped?: { files?: number; lines?: number };
  checks?: ExtraCheck[];
  microscope?: Microscope;
}

export interface ExtraCheck {
  check: string;
  trigger: NonNullable<AnnotatedStory["guardrails"]>[number]["trigger"];
  capability?: string;
}

export const NO_DESCRIPTION = "no description yet";

const WORD: Readonly<Record<HealthState, string>> = { passing: "green", failing: "red", "not-checked": "not checked" };

type SurveyedFiles = ScopeSurvey;

export function drillDown(tree: AnnotatedTree, story: string, states: PartStates, history: readonly Change[], survey: Readonly<Record<string, SurveyedFiles>> = {}): StoryPanel | undefined {
  const found = tree.stories.find(({ id }) => id === story);
  if (found === undefined) return undefined;
  const byId = new Map(found.capabilities.map((capability) => [capability.id, capability]));
  const trails = reportedTrails(history);

  const inside = new Map<string, string[]>();
  for (const { id, parent } of found.capabilities) if (parent !== undefined) inside.set(parent, [...(inside.get(parent) ?? []), id]);

  const capabilities = grove(found, states).flatMap(({ capability: id }): CapabilityLine[] => {
    const capability = id === undefined ? undefined : byId.get(id);
    if (capability === undefined) return [];
    const contracts = numbered(capability.contracts).map((contract) => contractLine(contract, trails.get(contract.id) ?? []));
    const seen = contracts.flatMap(({ verified }) => (verified === undefined ? [] : [verified]));
    const sources = sourcesOf(contracts);
    return [
      {
        id: capability.id,
        title: capability.title,
        description: sentences(capability.description),
        ...(capability.parent === undefined ? {} : { parent: capability.parent }),
        ...(inside.has(capability.id) ? { inside: inside.get(capability.id)! } : {}),
        reported: capability.health.reported.state,
        ...(seen.length === 0 ? {} : { verified: capability.health.verified.state }),
        ...(sources === undefined ? {} : { sources }),
        status: capability.status,
        contracts,
        ...(capability.why === undefined ? {} : { why: whyLine(capability.why, capability.contracts, contracts) }),
        ...(capability.reportOnly ? { reportOnly: true as const } : {}),
        ...(capability.parkedOn === undefined ? {} : { parkedOn: capability.parkedOn.map(({ arc, title }) => ({ arc, title })) }),
        ...(capability.openWork === undefined ? {} : { openWork: capability.openWork.map(({ increment, title, active, waits }) => ({ increment, title, ...(active ? { active } : {}), ...(waits === undefined ? {} : { waits: waits.map((wait) => ({ ...wait })) }) })) }),
      },
    ];
  });

  const edges = (found.edges ?? []).map(({ from, to, description, contracts }): EdgeLine => ({
    from,
    fromTitle: byId.get(from)?.title ?? from,
    to,
    toTitle: byId.get(to)?.title ?? to,
    ...(description === undefined ? {} : { description }),
    contracts: numbered(contracts).map((contract) => contractLine(contract, trails.get(contract.id) ?? [])),
  }));

  const files = survey[found.id]?.files ?? [];
  const mapped = found.mapped === undefined ? undefined : files.length === 0 ? {} : { files: files.length, lines: files.reduce((sum, file) => sum + file.lines, 0) };
  const checks = extraChecks(found);
  const names = new Map(tree.stories.flatMap((each) => [[each.id, each.title] as const, ...each.capabilities.map(({ id, title }) => [id, title] as const)]));
  const scope = capabilities.length === 0 ? undefined : microscope({
    story: found.id,
    title: found.title,
    capabilities: capabilities.map(({ id, title, status, parkedOn }) => ({ id, title, status, ...(parkedOn === undefined ? {} : { parked: true }) })),
    edges: edges.map(({ from, to }) => ({ from, to })),
    names,
  }, survey);
  return { story: found.id, title: found.title, description: sentences(found.description), capabilities, ...(edges.length === 0 ? {} : { edges }), ...(mapped === undefined ? {} : { mapped }), ...(checks.length === 0 ? {} : { checks }), ...(scope === undefined ? {} : { microscope: scope }) };
}

function numbered<T extends { title: string }>(contracts: readonly T[]): T[] {
  const number = (title: string): number[] | undefined => /^(\d+)\.(\d+) · /.exec(title)?.slice(1).map(Number);
  return [...contracts].sort((one, other) => {
    const [a, b] = [number(one.title), number(other.title)];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
    return a[0]! - b[0]! || a[1]! - b[1]!;
  });
}

function extraChecks(story: AnnotatedStory): ExtraCheck[] {
  return [
    ...(story.guardrails ?? []).map(({ check, trigger }) => ({ check, trigger })),
    ...story.capabilities.flatMap(({ title, guardrails }) => (guardrails ?? []).map(({ check, trigger }) => ({ check, trigger, capability: title }))),
  ];
}

function contractLine(contract: AnnotatedContract, trail: readonly HealthState[]): ContractLine {
  return {
    id: contract.id,
    title: contract.title,
    reported: contract.health.reported.state,
    trail: trailWords(trail),
    ...(written(contract.health.verified) ? { verified: contract.health.verified.state } : {}),
    ...(written(contract.health.verified) && contract.health.verified.source !== undefined ? { source: contract.health.verified.source } : {}),
    ...(contract.health.verified.was === undefined ? {} : { lastSeen: contract.health.verified.was }),
    ...ranOf(contract.health.verified),
    ...gearOf(contract),
    ...(contract.proof?.by === "agentic-user-acceptance-testing" ? { acceptance: "not-run" as const } : {}),
  };
}

function gearOf({ health: { verified, ci }, proof }: AnnotatedContract): Pick<ContractLine, "gear" | "local"> {
  const newest = written(verified) ? verified : undefined;
  const shown = ci ?? newest;
  if (shown === undefined) return proof?.by === "agentic-user-acceptance-testing" ? {} : { gear: { state: "not-checked" } };
  const later = ci !== undefined && newest !== undefined && newest.source !== "ci" && newest.at! > ci.at! ? newest : undefined;
  return { gear: checkReadingOf(shown), ...(later === undefined ? {} : { local: checkReadingOf(later) }) };
}

function checkReadingOf({ state, source, at }: HealthColumn): CheckReading {
  return { state, ...(source === undefined ? {} : { source }), ...(at === undefined ? {} : { at }) };
}

function whyLine({ reason, mover, contracts, since }: CapabilityWhy, all: readonly AnnotatedContract[], lines: readonly ContractLine[]): WhyLine {
  const titles = new Map(all.map(({ id, title }) => [id, title]));
  const named = contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? titles.get(id) ?? id);
  const sources = sourcesOf(lines.filter(({ id }) => contracts.includes(id)));
  return { reason, mover, contracts: named, ...(since === undefined ? {} : { since }), ...(sources === undefined ? {} : { sources }) };
}

function sourcesOf(lines: readonly ContractLine[]): HealthSource[] | undefined {
  const said = SOURCES.filter((source) => lines.some((line) => line.source === source));
  return said.length === 0 ? undefined : said;
}

const SOURCES: readonly HealthSource[] = ["local", "ci"];

function ranOf({ state, at, tests }: HealthColumn): { ran?: NonNullable<ContractLine["ran"]> } {
  if (at === undefined || state === "not-checked") return {};
  return { ran: { at, ...(tests === undefined ? {} : { tests: [...tests] }) } };
}

function written(column: HealthColumn): boolean {
  return column.at !== undefined;
}

function reportedTrails(history: readonly Change[]): Map<string, HealthState[]> {
  const trails = new Map<string, HealthState[]>();
  for (const change of history) {
    if (change.type !== "health" || change.action === "retired") continue;
    const { node, column, state } = change.record.fields as { node?: unknown; column?: unknown; state?: unknown };
    if (typeof node !== "string" || column !== "reported" || (state !== "passing" && state !== "failing" && state !== "not-checked")) continue;
    trails.set(node, [...(trails.get(node) ?? []), state]);
  }
  return trails;
}

function trailWords(trail: readonly HealthState[]): string {
  const steps = trail.filter((state, index) => state !== "not-checked" && state !== trail[index - 1]);
  if (steps.length === 0) return "not reported yet";
  if (steps.length === 1) return `${WORD[steps[0] ?? "not-checked"]} only`;
  return steps.map((state) => WORD[state]).join(", then ");
}

function sentences(description: string | undefined): string {
  return description === undefined || description.trim() === "" ? NO_DESCRIPTION : description;
}
