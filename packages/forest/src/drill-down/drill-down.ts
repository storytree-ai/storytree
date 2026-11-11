/**
 * Capability 4 · Drill-down (the forest story): what the panel a click on a story node opens says.
 * It explains the story in plain words: its sentences, and below them one capability, the one selected
 * on the island: its sentences, its health as the agent reports it, and its contracts on request (ADR-0659).
 * The island draws how the capabilities connect, so the panel carries no diagram of its own.
 *
 * Its shelf: the user's agent writes every description, and storytree writes none (ADR-0625 D1),
 * so a missing one says so. Each contract shows whether the agent reported it red before green,
 * from the history the library keeps (ADR-0630 D2): the page already holds that history, since the
 * live reading hands on the library's changes, health saves included. Storytree's own column shows
 * only where something wrote it. Front covers are not shown here (ADR-0659 D4).
 *
 * Everything here is a pure function of what the app hands the page, so it is tested without one.
 */
import type { AnnotatedContract, AnnotatedStory, AnnotatedTree, CapabilityStatus, CapabilityWhy, Change, EarlierVerdict, HealthColumn, HealthSource, HealthState } from "@storytree/library";


import { grove, type PartStates } from "../capability-tree/capability-tree.js";

/** One contract, as the panel lists it on request. */
export interface ContractLine {
  id: string;
  title: string;
  /** Its health as the agent reports it now: the agent's word. */
  reported: HealthState;
  /** What the agent reported over time, in words: "red, then green", "green only", "not reported yet". */
  trail: string;
  /** Storytree's own column, only where something wrote it. */
  verified?: HealthState;
  /** Where storytree saw it, verified locally or read from CI, when its entry says (ADR-1193 D3). */
  source?: HealthSource;
  /** The verdict storytree last saw for it, when the latest run did not reproduce it: "not re-run" (ADR-0825 D2). */
  lastSeen?: EarlierVerdict;
  /**
   * Agentic user acceptance testing's state, only on a contract whose proof is marked for it (ADR-1294 D1). It reads
   * "not-run" until a run writes a verdict (increment_eab89906c217).
   */
  acceptance?: AcceptanceState;
}

/** Where agentic user acceptance testing stands on a contract marked for it. */
export type AcceptanceState = "passed" | "failed" | "not-run";

/** Why a capability is not healthy, and who moves it, with its contracts named for the owner (ADR-0825 D1). */
export interface WhyLine {
  reason: CapabilityWhy["reason"];
  mover: CapabilityWhy["mover"];
  /** The contracts carrying the reason, each by the number its title starts with, else its title. */
  contracts: string[];
  /** The earliest time one of them was recorded so, when a time was recorded. */
  since?: string;
  /** Where storytree saw the contracts carrying it, local before CI, when their entries say. */
  sources?: HealthSource[];
}

/** One capability, as the panel explains it. */
export interface CapabilityLine {
  id: string;
  title: string;
  /** Its sentences, or NO_DESCRIPTION. */
  description: string;
  /** Its health as the agent reports it, rolled up from its contracts. */
  reported: HealthState;
  /** Storytree's own column, only where something wrote it for one of its contracts. */
  verified?: HealthState;
  /** Where storytree saw its contracts, local before CI, when their entries say (ADR-1193 D3). */
  sources?: HealthSource[];
  /** Its word, as the library gives it: proposed, healthy, unhealthy or untested (ADR-0744). */
  status: CapabilityStatus;
  contracts: ContractLine[];
  /** Why it is not healthy; absent when it is healthy, and when it is report-only. */
  why?: WhyLine;
  /** Built, in a project nothing verifies (ADR-0630): it leads with the agent's report instead of its word. */
  reportOnly?: true;
  /** The arcs that park it, when it is not proven and parked on purpose (ADR-0992 D6): its card names them. */
  parkedOn?: { arc: string; title: string }[];
  /** The open increments naming it, in the library's order: the active ones first, then parked order (ADR-1253 D1). */
  openWork?: { increment: string; title: string; active?: true }[];
}

/** An edge of the story (ADR-1282 D1): one capability depending on another of the story, with the edge's own contracts. */
export interface EdgeLine {
  from: string;
  fromTitle: string;
  to: string;
  toTitle: string;
  /** What passes between the two, in its own words; absent when nobody has written it. */
  description?: string;
  /** Its contracts, each a line as a capability's contracts carry, never either capability's own. */
  contracts: ContractLine[];
}

/** The panel for one story. */
export interface StoryPanel {
  story: string;
  title: string;
  description: string;
  /** In build order. */
  capabilities: CapabilityLine[];
  /** The edges between its capabilities, which a picked gate lists (ADR-1282 D1); present when it has any. */
  edges?: EdgeLine[];
  /** Present for a mapped story (ADR-0993 D3), which shows no health: its file and line counts once its survey has read them. */
  mapped?: { files?: number; lines?: number };
  /**
   * The story's own extra checks, then each capability's, named with its capability; present when it has any. Its
   * risk rating is switched off (question_0de2b8280384), so the panel carries none.
   */
  checks?: ExtraCheck[];
}

/** An extra check only this story or one of its capabilities carries; standard unit and integration tests are not listed. */
export interface ExtraCheck {
  check: string;
  trigger: NonNullable<AnnotatedStory["guardrails"]>[number]["trigger"];
  capability?: string;
}

/** What stands in for a description nobody has written. */
export const NO_DESCRIPTION = "no description yet";

/** The words for each reported state in a trail. */
const WORD: Readonly<Record<HealthState, string>> = { passing: "green", failing: "red", "not-checked": "not checked" };

/** A story's code survey as the panel counts it: the forest's own copy of the map's surveyed files, their lines alone (ADR-1017 D2). */
type SurveyedFiles = { readonly files: readonly { readonly lines: number }[] };

/**
 * The panel for story `story` of `tree`, or undefined if the tree has no such story. `history` is the project's changes from the start,
 * and `survey` its code's survey by story, which counts a mapped story's files and lines.
 */
export function drillDown(tree: AnnotatedTree, story: string, states: PartStates, history: readonly Change[], survey: Readonly<Record<string, SurveyedFiles>> = {}): StoryPanel | undefined {
  const found = tree.stories.find(({ id }) => id === story);
  if (found === undefined) return undefined;
  const byId = new Map(found.capabilities.map((capability) => [capability.id, capability]));
  const trails = reportedTrails(history);

  const capabilities = grove(found, states).flatMap(({ capability: id }): CapabilityLine[] => {
    const capability = id === undefined ? undefined : byId.get(id);
    if (capability === undefined) return [];
    const contracts = capability.contracts.map((contract) => contractLine(contract, trails.get(contract.id) ?? []));
    const seen = contracts.flatMap(({ verified }) => (verified === undefined ? [] : [verified]));
    const sources = sourcesOf(contracts);
    return [
      {
        id: capability.id,
        title: capability.title,
        description: sentences(capability.description),
        reported: capability.health.reported.state,
        ...(seen.length === 0 ? {} : { verified: capability.health.verified.state }),
        ...(sources === undefined ? {} : { sources }),
        status: capability.status,
        contracts,
        ...(capability.why === undefined ? {} : { why: whyLine(capability.why, capability.contracts, contracts) }),
        ...(capability.reportOnly ? { reportOnly: true as const } : {}),
        ...(capability.parkedOn === undefined ? {} : { parkedOn: capability.parkedOn.map(({ arc, title }) => ({ arc, title })) }),
        ...(capability.openWork === undefined ? {} : { openWork: capability.openWork.map(({ increment, title, active }) => ({ increment, title, ...(active ? { active } : {}) })) }),
      },
    ];
  });

  const edges = (found.edges ?? []).map(({ from, to, description, contracts }): EdgeLine => ({
    from,
    fromTitle: byId.get(from)?.title ?? from,
    to,
    toTitle: byId.get(to)?.title ?? to,
    ...(description === undefined ? {} : { description }),
    contracts: contracts.map((contract) => contractLine(contract, trails.get(contract.id) ?? [])),
  }));

  const files = survey[found.id]?.files ?? [];
  const mapped = found.mapped === undefined ? undefined : files.length === 0 ? {} : { files: files.length, lines: files.reduce((sum, file) => sum + file.lines, 0) };
  const checks = extraChecks(found);
  return { story: found.id, title: found.title, description: sentences(found.description), capabilities, ...(edges.length === 0 ? {} : { edges }), ...(mapped === undefined ? {} : { mapped }), ...(checks.length === 0 ? {} : { checks }) };
}

/** `story`'s own extra checks, then each of its capabilities'. */
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
    ...(contract.proof?.by === "agentic-user-acceptance-testing" ? { acceptance: "not-run" as const } : {}),
  };
}

/**
 * `why` with its contract ids turned into what the owner reads: the number their title starts with ("8.1 · …"), else the title;
 * with the sources of the contracts carrying it, from their lines.
 */
function whyLine({ reason, mover, contracts, since }: CapabilityWhy, all: readonly AnnotatedContract[], lines: readonly ContractLine[]): WhyLine {
  const titles = new Map(all.map(({ id, title }) => [id, title]));
  const named = contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? titles.get(id) ?? id);
  const sources = sourcesOf(lines.filter(({ id }) => contracts.includes(id)));
  return { reason, mover, contracts: named, ...(since === undefined ? {} : { since }), ...(sources === undefined ? {} : { sources }) };
}

/** The sources some contract lines say, local before CI; undefined when none says one. */
function sourcesOf(lines: readonly ContractLine[]): HealthSource[] | undefined {
  const said = SOURCES.filter((source) => lines.some((line) => line.source === source));
  return said.length === 0 ? undefined : said;
}

/** The sources, in the order they are said. */
const SOURCES: readonly HealthSource[] = ["local", "ci"];

/** Whether a column has an entry: a contract's column carries its time once something wrote it. */
function written(column: HealthColumn): boolean {
  return column.at !== undefined;
}

/** Each contract's reported states, oldest first, from the history's health saves. */
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

/** A trail in words, each change of state once: "red, then green"; a single state is "green only". */
function trailWords(trail: readonly HealthState[]): string {
  const steps = trail.filter((state, index) => state !== "not-checked" && state !== trail[index - 1]);
  if (steps.length === 0) return "not reported yet";
  if (steps.length === 1) return `${WORD[steps[0] ?? "not-checked"]} only`;
  return steps.map((state) => WORD[state]).join(", then ");
}

function sentences(description: string | undefined): string {
  return description === undefined || description.trim() === "" ? NO_DESCRIPTION : description;
}
