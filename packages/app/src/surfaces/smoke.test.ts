/**
 * Capability 3 · Surfaces: the smoke check's judgement, contract 3.3 in the app story. It is a
 * plain function of the project's tree and what the surface on show says it drew, so it is tested
 * without Electron; `pnpm desktop:smoke` runs it in the real app.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedCapability, AnnotatedStory, AnnotatedTree, NodeHealth } from "@storytree/library";

import { smokeProblems } from "./smoke.js";

const HEALTH: NodeHealth = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };
const capability = (id: string, title: string): AnnotatedCapability => ({ id, title, dependsOn: [], proposed: true, contracts: [], health: HEALTH, status: "proposed" });
const story = (id: string, title: string, capabilities: AnnotatedCapability[]): AnnotatedStory => ({ id, title, capabilities, health: HEALTH });

/** A project of two stories: the first with two capabilities, the second with one. */
const TREE: AnnotatedTree = {
  arcs: [],
  stories: [
    story("s1", "Visitor can sign up", [capability("c1", "Email form"), capability("c2", "Welcome email")]),
    story("s2", "Visitor can sign in", [capability("c3", "Password check")]),
  ],
};

test("3.3 the smoke check, pointed at the surface on show, passes only if that surface says it drew every story and capability of the project", () => {
  const everything = { surface: "forest", stories: ["s1", "s2"], capabilities: ["c1", "c2", "c3"] };
  assert.deepEqual(
    smokeProblems("ready", TREE, JSON.stringify({ ...everything, trees: { c1: "seedling" } })),
    [],
    "it passes when the surface drew everything, whatever else it says",
  );

  const problems = smokeProblems("ready", TREE, JSON.stringify({ ...everything, stories: ["s1"], capabilities: ["c1", "c3"] }));
  assert.deepEqual(
    new Set(problems),
    new Set(['the forest did not draw story "Visitor can sign in"', 'the forest did not draw capability "Welcome email"']),
    "it fails naming each story and capability the surface did not draw",
  );

  for (const said of [undefined, "", "{not json", JSON.stringify({ surface: "forest" })]) {
    assert.deepEqual(smokeProblems("ready", TREE, said), ["the surface on show did not say what it drew"], `and it fails when the surface said ${JSON.stringify(said)}`);
  }
});
