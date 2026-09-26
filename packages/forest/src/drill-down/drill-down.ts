/**
 * Capability 4 · Drill-down (stories/forest.md): what the panel a click on a story node opens says.
 * It explains the story in plain words: its sentences, then each capability's sentences with its
 * health as the agent reports it, and its contracts on request; and a small diagram of how the
 * capabilities connect, each pointing at the ones it builds on, including any in other stories,
 * named with their story and marked if not yet landed.
 *
 * Its shelf: the user's agent writes every description, and storytree writes none (ADR-0625 D1),
 * so a missing one says so. Each contract shows whether the agent reported it red before green,
 * from the history the library keeps (ADR-0630 D2): the page already holds that history, since the
 * live reading hands on the library's changes, health saves included. Storytree's own column shows
 * only where something wrote it.
 *
 * Everything here is a pure function of what the app hands the page, so it is tested without one.
 */
import type { PartState, WorkStates } from "@storytree/arc-surface";
import type { AnnotatedContract, AnnotatedTree, Change, HealthColumn, HealthState, Note, SchemaRecord } from "@storytree/library";

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
  /** Where it stands, by the arc surface's work states. */
  state: PartState;
  contracts: ContractLine[];
  /** Its shelf of front covers, once they are read (capability 7). */
  shelf?: Shelf;
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
}

/** The panel for one story. */
export interface StoryPanel {
  story: string;
  title: string;
  description: string;
  /** In build order. */
  capabilities: CapabilityLine[];
  arrows: Arrow[];
  /** The story's own shelf of front covers, once they are read (capability 7). */
  shelf?: Shelf;
}

/** One book on a shelf, as its spine shows it: a front cover's title and first line. */
export interface Spine {
  id: string;
  title: string;
  firstLine: string;
  /** Whether it is the shelf's founding book, its first. */
  founding: boolean;
}

/** A story's or capability's shelf: its front covers as spines, founding book first, then oldest first. */
export interface Shelf {
  node: string;
  spines: Spine[];
  /** EMPTY_SHELF, when there are no spines. */
  empty?: string;
}

/** A book opened: its full text, and the titles of the notes that link to it and that it links to. One step in, and no further. */
export interface Book {
  id: string;
  title: string;
  text: string;
  linksIn: string[];
  linksOut: string[];
}

/** What an empty shelf says. */
export const EMPTY_SHELF = "no decisions on this shelf yet";

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
        contracts,
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
  };
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

/** `panel` with the story's and each capability's shelf, from `covers`, the front covers read for them. */
export function shelved(panel: StoryPanel, _covers: readonly SchemaRecord<"decision">[]): StoryPanel {
  return panel;
}

/** `cover` opened: `linkingIn` are the notes that link to it (the library's relatedNotes), and `history` the project's changes, where the titles of the notes it links to are found. */
export function openBook(cover: SchemaRecord<"decision">, _linkingIn: readonly Note[], _history: readonly Change[]): Book {
  return { id: cover.id, title: "", text: "", linksIn: [], linksOut: [] };
}
