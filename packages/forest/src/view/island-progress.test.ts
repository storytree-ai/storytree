/** Capability 3 · Story node render: unsurveyed islands still show recorded progress. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { workStates } from "@storytree/arc-surface";
import type { Line } from "@storytree/session-management";
import type { AnnotatedTree, HealthState } from "@storytree/library";
import { forestScene } from "../render/forest-scene.js";
import { islandProgress } from "./island-progress.js";

const project = (reported: HealthState): AnnotatedTree => ({
  arcs: [],
  stories: [{ id: "story", title: "Reader publishes", health: { reported: { state: reported }, verified: { state: "not-checked" } },
    capabilities: ["write", "publish"].map(id => ({ id, title: id, dependsOn: [], proposed: false, status: "untested", contracts: [],
      health: { reported: { state: reported }, verified: { state: "not-checked" } } })) }],
});
const line = (kind: "claimed" | "landed", capability: string, seq: number): Line => ({
  kind, capability, seq, project: "example", session: "agent", source: "tool", at: new Date(seq).toISOString(), reason: "building",
});

test("3.29 unsurveyed island progress follows recorded landings, independently of reported health", () => {
  for (const reported of ["not-checked", "passing", "failing"] as const) {
    const tree = project(reported);
    const stages = [[], [line("claimed", "write", 1)], [line("landed", "write", 2)], [line("landed", "write", 2), line("landed", "publish", 3)]];
    for (const [index, activity] of stages.entries()) {
      const island = forestScene(tree, [], workStates(activity)).islands[0]!;
      assert.deepEqual(islandProgress(island), { landed: Math.max(0, index - 1), total: 2 }, `${reported}, stage ${index}`);
      assert.ok(island.trees.every(tree => tree.status === "untested"), "recorded landing never grants verified health");
    }
  }
});

test("3.29 progress neither counts a placeholder nor replaces surveyed territory presentation", () => {
  const tree = project("passing");
  const surveyed = forestScene(tree, [], workStates([]), { story: { files: [{ path: "src/write.ts", lines: 10, capability: "write" }], imports: [] } }).islands[0]!;
  assert.equal(islandProgress(surveyed), undefined);
  tree.stories[0]!.capabilities = [];
  const empty = forestScene(tree, [], workStates([])).islands[0]!;
  assert.equal(empty.trees.length, 1, "the existing placeholder is present");
  assert.equal(islandProgress(empty), undefined);
});
