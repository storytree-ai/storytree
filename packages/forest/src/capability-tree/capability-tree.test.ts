/**
 * Capability 2 · Capability tree (the forest story): each story node is a grove, one tree per
 * capability. A tree's size follows the arc surface's work state, and its leaves the health the
 * agent reports. The story is written out as the library's projectTree() hands it over, and the
 * work states come from agent activity log lines written out as linesSince hands them over, so no
 * database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedCapability, AnnotatedStory, HealthState } from "@storytree/library";

import { grove } from "./capability-tree.js";

function capability(id: string, reported: HealthState, dependsOn: string[] = []): AnnotatedCapability {
  const health = { reported: { state: reported }, verified: { state: "not-checked" as const } };
  return { id, title: `The ${id}`, dependsOn, contracts: [], health };
}

function story(...capabilities: AnnotatedCapability[]): AnnotatedStory {
  return { id: "story_1", title: "Visitor can sign up", capabilities, health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } } };
}

function log(...written: NewLine[]): Line[] {
  return written.map((line, index) => ({ ...line, seq: index + 1, project: "shop", at: new Date(0).toISOString() }));
}

const claimed = (capability: string): NewLine => ({ kind: "claimed", session: "s1", source: "tool", capability, reason: "building it" });
const landed = (capability: string): NewLine => ({ kind: "landed", session: "s1", source: "tool", capability });

test("2.1 planned, being built, landed and passing, and landed and failing give a seedling, a seedling, a full green tree and a dead tree, in build order, each with what it builds on", () => {
  // Created in an order that is not the build order: the dead tree's capability builds on the green one's.
  const trees = grove(
    story(capability("cap_dead", "failing", ["cap_green"]), capability("cap_green", "passing"), capability("cap_planned", "not-checked", ["cap_dead"]), capability("cap_building", "not-checked")),
    workStates(log(claimed("cap_green"), landed("cap_green"), claimed("cap_dead"), landed("cap_dead"), claimed("cap_building"))),
  );
  assert.deepEqual(
    trees.map(({ capability, form, buildsOn }) => ({ capability, form, buildsOn })),
    [
      { capability: "cap_green", form: "green", buildsOn: [] },
      { capability: "cap_dead", form: "dead", buildsOn: ["cap_green"] },
      { capability: "cap_planned", form: "seedling", buildsOn: ["cap_dead"] },
      { capability: "cap_building", form: "seedling", buildsOn: [] },
    ],
  );
});

test("2.2 a capability the agent reports red while it is being built stays a seedling", () => {
  const [tree] = grove(story(capability("cap_a", "failing")), workStates(log(claimed("cap_a"))));
  assert.equal(tree?.form, "seedling");
  assert.equal(tree?.reported, "failing", "the agent's report is kept beside the form, labelled as its own");
});

test("2.3 a landed capability with nothing reported is a pale tree", () => {
  const [tree] = grove(story(capability("cap_a", "not-checked")), workStates(log(claimed("cap_a"), landed("cap_a"))));
  assert.equal(tree?.form, "pale");
});

test("2.4 a story with no capabilities yet shows one seedling", () => {
  const trees = grove(story(), workStates([]));
  assert.deepEqual(trees.map(({ capability, form }) => ({ capability, form })), [{ capability: undefined, form: "seedling" }]);
});
