/** Capability 1 under the glass sheet: notes hang beneath their shelves, loose ones in a pool on the south edge (ADR-1043 D5). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledge, sheetPoints, underShelves } from "@storytree/knowledge-core";
import { History } from "../testing/changes.js";

const shelves = new Map([["west", { x: -100, y: 20 }], ["east", { x: 100, y: -10 }], ["cap", { x: 130, y: -30 }]]);
const pool = { x: -150, y: -120, width: 300, height: 40 };

test("1.10 under the glass sheet each shelf's notes hang beneath its place, a step deeper per depth; loose notes lie in the south pool, and each stored link between two hung notes is one line", () => {
  const history = new History().story("west").story("east").capability("cap", "east")
    .decision("deep")
    .decision("middle", { links: ["deep"] })
    .decision("cover", { frontCoverOf: "cap", links: ["middle"] })
    .decision("other", { frontCoverOf: "west", links: ["deep"] })
    .decision("loose-a", { links: ["loose-b"] }).decision("loose-b").decision("loose-c");
  const known = knowledge(history.changes);
  const core = underShelves(history.changes, known);
  const { points, links } = sheetPoints(core, { shelfAt: node => shelves.get(node), pool, depthStep: 7 }, known.notes);
  assert.deepEqual(points.map(point => point.id).sort(), ["cover", "deep", "loose-a", "loose-b", "loose-c", "middle", "other"]);
  for (const point of points) {
    const placement = core.placed.get(point.id);
    if (placement === undefined) {
      // A loose note lies in the pool, along the south edge, just under the glass.
      assert.equal(point.depth, undefined);
      assert.ok(point.at.x >= pool.x && point.at.x <= pool.x + pool.width && point.at.y >= pool.y && point.at.y <= pool.y + pool.height, `${point.id} lies in the pool`);
      continue;
    }
    const shelf = shelves.get(placement.home)!;
    assert.ok(Math.hypot(point.at.x - shelf.x, point.at.y - shelf.y) < 20, `${point.id} hangs under its shelf ${placement.home}`);
    assert.ok(point.at.z < 0, "beneath the glass");
    assert.equal(point.depth, placement.depth);
  }
  const below = (id: string) => -points.find(point => point.id === id)!.at.z;
  assert.equal(below("middle") - below("cover"), 7, "one step deeper per depth");
  assert.ok(Math.max(...points.filter(p => p.depth === undefined).map(p => p.at.y)) < Math.min(...points.filter(p => p.depth !== undefined).map(p => p.at.y)), "the pool lies south of every shelf");
  const pairs = links.map(pair => [...pair].sort().join(" ")).sort();
  assert.deepEqual(pairs, ["cover middle", "deep middle", "deep other", "loose-a loose-b"]);
  assert.deepEqual(sheetPoints(core, { shelfAt: node => shelves.get(node), pool, depthStep: 7 }, known.notes), { points, links }, "the same library hangs the same way");
});
