/**
 * Capability 2 · Capability tree (the forest story): each story node carries its capability tree:
 * the story's capabilities, which ones build on which, and where each one stands, and it grows as
 * they land. Where a capability stands comes from two records kept side by side: the arc surface's
 * work state (the one rule for planned, in progress or landed, ADR-0632 D3), and the health the
 * agent reports for its tests, always labelled as the agent's own (ADR-0630).
 *
 * Its shelf: a story node is a grove, one tree per capability (T1). A tree's size follows the work
 * state and its leaves follow the agent's report (G1): a seedling while planned or being built, a
 * pale tree once landed with nothing reported, a full green tree once landed and reported passing,
 * and a dead tree once landed with a failing report. A story with no capabilities yet shows one
 * seedling, so a new story is never invisible.
 */
import type { PartState, WorkStates } from "@storytree/arc-surface";
import type { AnnotatedCapability, AnnotatedStory, HealthState } from "@storytree/library";

/** How a capability's tree looks. */
export type TreeForm = "seedling" | "pale" | "green" | "dead";

/** One tree in a story node's grove. */
export interface Tree {
  /** The capability's id in the library; undefined for the one seedling of a story with no capabilities yet. */
  capability: string | undefined;
  title: string;
  /** The capabilities it builds on, by id, as the library stores them (some may be in other stories). */
  buildsOn: string[];
  /** Where it stands, by the arc surface's work states. */
  state: PartState;
  /** Its health as the agent reports it: the agent's word, always labelled so. */
  reported: HealthState;
  form: TreeForm;
}

/** The grove of `story`: one tree per capability, in build order (each after those it builds on in the story, else in creation order). */
export function grove(story: AnnotatedStory, states: WorkStates): Tree[] {
  if (story.capabilities.length === 0) {
    return [{ capability: undefined, title: story.title, buildsOn: [], state: "planned", reported: "not-checked", form: "seedling" }];
  }
  return inBuildOrder(story.capabilities).map((capability) => {
    const state = states.part(capability.id);
    const reported = capability.health.reported.state;
    return { capability: capability.id, title: capability.title, buildsOn: [...capability.dependsOn], state, reported, form: formOf(state, reported) };
  });
}

function formOf(state: PartState, reported: HealthState): TreeForm {
  if (state !== "landed") return "seedling";
  if (reported === "passing") return "green";
  if (reported === "failing") return "dead";
  return "pale";
}

/** `capabilities` with each after those it builds on within the story, otherwise in creation order. A loop is left in creation order. */
function inBuildOrder(capabilities: readonly AnnotatedCapability[]): AnnotatedCapability[] {
  const inStory = new Set(capabilities.map(({ id }) => id));
  const placed = new Set<string>();
  const ordered: AnnotatedCapability[] = [];
  while (ordered.length < capabilities.length) {
    const next =
      capabilities.find(({ id, dependsOn }) => !placed.has(id) && dependsOn.every((on) => !inStory.has(on) || placed.has(on))) ??
      capabilities.find(({ id }) => !placed.has(id));
    if (next === undefined) break;
    placed.add(next.id);
    ordered.push(next);
  }
  return ordered;
}
