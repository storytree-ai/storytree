/**
 * Capability 5 · Agent capability claims (the forest story), as drawn since ADR-0804 D9: no wisps; a
 * running session tints the coast of each island it works on, and its claimed territories, in its colour.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Vector3, type Mesh, type MeshBasicMaterial } from "three";

import { coastArcs, claimTints, type SessionWisp } from "@storytree/forest";
import { coastTintMarks } from "./session-tints.js";
import { territoryLand } from "./territory-land.js";

const wisp = (session: string, story: string, colour: string, capabilities: string[] = []): SessionWisp => ({ session, story, colour, phase: 0, faded: false, capabilities });
const square = [[{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }]];
const flat = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);

test("5.6 an island one running session works on has its coast tinted in that session's colour, all the way round", () => {
  const arcs = coastArcs([wisp("A", "shop", "hsl(200, 80%, 68%)"), wisp("A", "other", "hsl(200, 80%, 68%)")], "shop");
  assert.deepEqual(arcs, [{ session: "A", colour: "hsl(200, 80%, 68%)", faded: false, from: 0, to: 1 }]);
  const marks = coastTintMarks(square, arcs, flat);
  const tint = marks.getObjectByName("coast-tint:A") as Mesh;
  assert.deepEqual(tint.userData, { session: "A", colour: "hsl(200, 80%, 68%)" });
  assert.ok((tint.material as MeshBasicMaterial).color.equals(new Color("hsl(200, 80%, 68%)")));
});

test("5.7 two sessions on one island split its coast into two arcs, one each, in list order", () => {
  const arcs = coastArcs([wisp("A", "shop", "hsl(200, 80%, 68%)"), wisp("B", "shop", "hsl(300, 80%, 68%)")], "shop");
  assert.deepEqual(arcs.map(({ session, from, to }) => ({ session, from, to })), [{ session: "A", from: 0, to: 0.5 }, { session: "B", from: 0.5, to: 1 }]);
  const marks = coastTintMarks(square, arcs, flat);
  assert.deepEqual(marks.children.map(({ name }) => name), ["coast-tint:A", "coast-tint:B"]);
});

test("5.8 a capability a session has claimed has its territory filled faintly in that session's colour", () => {
  const tints = claimTints([wisp("A", "shop", "hsl(200, 80%, 68%)", ["cap-a"])]);
  assert.deepEqual([...tints], [["cap-a", "hsl(200, 80%, 68%)"]]);
  const land = {
    territories: [{ capability: "cap-a" }, { capability: "cap-b" }],
    cells: [{ polygon: square[0]!, territory: 0 }, { polygon: square[0]!.map(({ x, z }) => ({ x: x + 2, z })), territory: 1 }],
    borders: [],
  };
  const drawn = territoryLand(land, flat, undefined, tints);
  assert.equal(drawn.getObjectByName("territory:cap-a")!.userData.claimedBy, "hsl(200, 80%, 68%)");
  assert.ok(((drawn.getObjectByName("territory:cap-a") as Mesh).material as MeshBasicMaterial).color.equals(new Color("hsl(200, 80%, 68%)")));
  assert.equal(drawn.getObjectByName("territory:cap-b")!.userData.claimedBy, undefined);
});
