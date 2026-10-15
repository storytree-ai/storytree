/** Story nodes on the glass sheet: depth runs west to east (ADR-1043 D2). */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";
import { storyNodes } from "../story-nodes/story-nodes.js";
import { SEA_GAP } from "./island-growth.js";
import { sheetPlaces } from "./sheet-places.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };

/** A project whose stories each have one capability, depending on the capabilities of the stories named. */
function project(dependsOn: Record<string, readonly string[]>): AnnotatedTree {
  return { arcs: [], stories: Object.entries(dependsOn).map(([id, on]) => ({ id, title: id, health, capabilities: [
    { id: `${id}-cap`, title: "A part", dependsOn: on.map(other => `${other}-cap`), proposed: true, status: "proposed" as const, contracts: [], health },
  ] })) };
}

test("1.12 on the glass sheet a story's depth runs west to east: the foundations at the west edge, each deeper depth east of every shallower one, and one depth's stories spread north to south, clear of each other", () => {
  const reach: Record<string, number> = { a: 20, b: 35, c: 12, d: 28, e: 20, f: 16 };
  const tree = project({ a: [], b: [], c: [], d: ["a"], e: ["d", "b"], f: ["c"] });
  const placed = sheetPlaces(storyNodes(tree, []).map(({ id, place }) => ({ story: id, place, reach: reach[id]! })));
  const at = (id: string) => placed.at.get(id)!;
  const depth = [["a", "b", "c"], ["d", "f"], ["e"]];
  assert.equal(Math.min(...depth[0]!.map(id => at(id).x - reach[id]!)), placed.bounds.west, "the foundation stories' column stands at the west edge");
  depth.forEach((column, k) => {
    for (const id of column) assert.equal(at(id).x, at(column[0]!).x, "one depth is one column");
    if (k === 0) return;
    for (const id of column) for (const shallower of depth.slice(0, k).flat())
      assert.ok(at(id).x - reach[id]! > at(shallower).x + reach[shallower]! + SEA_GAP - 1e-9, `${id} lies east of ${shallower}, clear of it`);
  });
  for (const column of depth) {
    const southward = [...column].sort((p, q) => at(q).y - at(p).y);
    for (let k = 1; k < southward.length; k++) {
      const north = southward[k - 1]!, south = southward[k]!;
      assert.equal(at(south).x, at(north).x);
      assert.ok(at(north).y - reach[north]! - (at(south).y + reach[south]!) >= SEA_GAP, `${south} lies south of ${north}, clear of it`);
    }
  }
});
