/**
 * Capability 4 · Drill-down (the forest story): what the panel a click on a story node opens says.
 * It explains the story in plain words: its sentences, and a small diagram of how the capabilities
 * connect, each pointing at the ones it builds on, including any in other stories, named with their
 * story and marked if not yet landed. Below the diagram it shows one capability, the one selected:
 * its sentences, its health as the agent reports it, and its contracts on request (ADR-0659).
 *
 * Its shelf: the user's agent writes every description, and storytree writes none (ADR-0625 D1),
 * so a missing one says so. Each contract shows whether the agent reported it red before green,
 * from the history the library keeps (ADR-0630 D2): the page already holds that history, since the
 * live reading hands on the library's changes, health saves included. Storytree's own column shows
 * only where something wrote it. Front covers are not shown here (ADR-0659 D4).
 *
 * Everything here is a pure function of what the app hands the page, so it is tested without one.
 */
import type { PartState, WorkStates } from "@storytree/arc-surface";
import type { AnnotatedContract, AnnotatedTree, CapabilityStatus, CapabilityWhy, Change, EarlierVerdict, HealthColumn, HealthState } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";

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
  /** The verdict storytree last saw for it, when the latest run did not reproduce it: "not re-run" (ADR-0825 D2). */
  lastSeen?: EarlierVerdict;
}

/** Why a capability is not healthy, and who moves it, with its contracts named for the owner (ADR-0825 D1). */
export interface WhyLine {
  reason: CapabilityWhy["reason"];
  mover: CapabilityWhy["mover"];
  /** The contracts carrying the reason, each by the number its title starts with, else its title. */
  contracts: string[];
  /** The earliest time one of them was recorded so, when a time was recorded. */
  since?: string;
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
  /** Where it stands, by the arc surface's work states: for choosing which to show, not for its card. */
  state: PartState;
  /** Its word, as the library gives it: proposed, healthy, unhealthy or untested (ADR-0744). */
  status: CapabilityStatus;
  contracts: ContractLine[];
  /** Why it is not healthy; absent when it is healthy. */
  why?: WhyLine;
}

/** An arrow of the diagram: a capability pointing at one it builds on. */
export interface Arrow {
  from: string;
  to: string;
  /** The title of the capability pointed at. */
  toTitle: string;
  /** The title of its story, when it is in another story. */
  toStory?: string;
  /** Whether the capability pointed at has landed. */
  landed: boolean;
  /** The word for the capability pointed at, as the library gives it (ADR-0744). */
  toStatus: CapabilityStatus;
}

/** The panel for one story. */
export interface StoryPanel {
  story: string;
  title: string;
  description: string;
  /** In build order. */
  capabilities: CapabilityLine[];
  arrows: Arrow[];
}

/** What stands in for a description nobody has written. */
export const NO_DESCRIPTION = "no description yet";

/** The words for each reported state in a trail. */
const WORD: Readonly<Record<HealthState, string>> = { passing: "green", failing: "red", "not-checked": "not checked" };

/** The panel for story `story` of `tree`, or undefined if the tree has no such story. `history` is the project's changes from the start. */
export function drillDown(tree: AnnotatedTree, story: string, states: WorkStates, history: readonly Change[]): StoryPanel | undefined {
  const found = tree.stories.find(({ id }) => id === story);
  if (found === undefined) return undefined;
  const everywhere = new Map(tree.stories.flatMap((owner) => owner.capabilities.map((capability) => [capability.id, { capability, owner }] as const)));
  const byId = new Map(found.capabilities.map((capability) => [capability.id, capability]));
  const trails = reportedTrails(history);

  const capabilities = grove(found, states).flatMap(({ capability: id, state }): CapabilityLine[] => {
    const capability = id === undefined ? undefined : byId.get(id);
    if (capability === undefined) return [];
    const contracts = capability.contracts.map((contract) => contractLine(contract, trails.get(contract.id) ?? []));
    const seen = contracts.flatMap(({ verified }) => (verified === undefined ? [] : [verified]));
    return [
      {
        id: capability.id,
        title: capability.title,
        description: sentences(capability.description),
        reported: capability.health.reported.state,
        ...(seen.length === 0 ? {} : { verified: capability.health.verified.state }),
        state,
        status: capability.status,
        contracts,
        ...(capability.why === undefined ? {} : { why: whyLine(capability.why, capability.contracts) }),
      },
    ];
  });

  const arrows = capabilities.flatMap(({ id }) =>
    (byId.get(id)?.dependsOn ?? []).map((to): Arrow => {
      const target = everywhere.get(to);
      return {
        from: id,
        to,
        toTitle: target?.capability.title ?? to,
        ...(target === undefined || target.owner.id === story ? {} : { toStory: target.owner.title }),
        landed: states.part(to) === "landed",
        toStatus: target?.capability.status ?? "untested",
      };
    }),
  );

  return { story: found.id, title: found.title, description: sentences(found.description), capabilities, arrows };
}

function contractLine(contract: AnnotatedContract, trail: readonly HealthState[]): ContractLine {
  return {
    id: contract.id,
    title: contract.title,
    reported: contract.health.reported.state,
    trail: trailWords(trail),
    ...(written(contract.health.verified) ? { verified: contract.health.verified.state } : {}),
    ...(contract.health.verified.was === undefined ? {} : { lastSeen: contract.health.verified.was }),
  };
}

/** `why` with its contract ids turned into what the owner reads: the number their title starts with ("8.1 · …"), else the title. */
function whyLine({ reason, mover, contracts, since }: CapabilityWhy, all: readonly AnnotatedContract[]): WhyLine {
  const titles = new Map(all.map(({ id, title }) => [id, title]));
  const named = contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? titles.get(id) ?? id);
  return { reason, mover, contracts: named, ...(since === undefined ? {} : { since }) };
}

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

/**
 * The capability the panel shows below its diagram (ADR-0659 D2): `chosen`, when it is one of the
 * story's own; otherwise the first in build order that has not landed, or the first if all have.
 * Undefined for a story with no capabilities.
 */
export function selectedCapability(panel: StoryPanel, chosen?: string): string | undefined {
  const own = panel.capabilities;
  if (chosen !== undefined && own.some(({ id }) => id === chosen)) return chosen;
  return (own.find(({ state }) => state !== "landed") ?? own[0])?.id;
}
