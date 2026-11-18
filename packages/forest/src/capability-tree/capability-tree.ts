// Capability 2 · Capability tree
import type { AnnotatedCapability, AnnotatedStory, HealthState } from "@storytree/library";

export type PartState = "planned" | "in-progress" | "landed";
export type PartStates = { part(id: string): PartState };

export type TreeForm = "seedling" | "pale" | "green" | "dead";

export interface Tree {
  capability: string | undefined;
  title: string;
  buildsOn: string[];
  state: PartState;
  reported: HealthState;
  status?: AnnotatedCapability["status"];
  form: TreeForm;
}

export function grove(story: AnnotatedStory, states: PartStates): Tree[] {
  if (story.capabilities.length === 0) {
    return [{ capability: undefined, title: story.title, buildsOn: [], state: "planned", reported: "not-checked", form: "seedling" }];
  }
  return inBuildOrder(story.capabilities).map((capability) => {
    const state = states.part(capability.id);
    const reported = capability.health.reported.state;
    return { capability: capability.id, title: capability.title, buildsOn: [...capability.dependsOn], state, reported, status: capability.status, form: formOf(state, reported) };
  });
}

function formOf(state: PartState, reported: HealthState): TreeForm {
  if (state !== "landed") return "seedling";
  if (reported === "passing") return "green";
  if (reported === "failing") return "dead";
  return "pale";
}

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
