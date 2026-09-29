import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { keptTree } from "./kept-tree.js";

const tree: AnnotatedTree = { arcs: [{ id: "arc_1" }] as AnnotatedTree["arcs"], stories: [{
  id: "story_1", title: "The library", health: { reported: { state: "not-checked" }, verified: { state: "passing" } },
  capabilities: [{ id: "cap_1", title: "Records", dependsOn: [], health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } }, contracts: [] }],
}] as unknown as AnnotatedTree["stories"] };

test("the forest keeps each project's last tree for the next start, and draws no kept value of another shape", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  keptTree("site", storage).write(tree);
  assert.deepEqual(keptTree("site", storage).read(), tree);
  assert.equal(keptTree("other", storage).read(), undefined);
  for (const [key] of values) values.set(key, JSON.stringify({ stories: [{ id: "story_1" }], arcs: [] }));
  assert.equal(keptTree("site", storage).read(), undefined);
});
