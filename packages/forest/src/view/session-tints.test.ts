/**
 * Capability 5 · Agent capability claims (the forest story): a running session outlines each territory it
 * claimed, in its colour; that outline is the only claim mark (ADR-0825 D3, ADR-0923).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Vector3, type Mesh, type MeshBasicMaterial } from "three";

import { claimTints, type SessionWisp } from "@storytree/forest";
import { territoryLand } from "./territory-land.js";

const wisp = (session: string, story: string, colour: string, capabilities: string[] = []): SessionWisp => ({ session, story, colour, faded: false, capabilities });
const flat = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);

test("5.6 a capability a session has claimed has its territory's border outlined, inset, in that session's colour, fainter once it is quiet", () => {
  const tints = claimTints([wisp("A", "shop", "hsl(200, 80%, 68%)", ["cap-a"]), { ...wisp("C", "shop", "hsl(300, 80%, 68%)", ["cap-c"]), faded: true }]);
  assert.deepEqual([...tints], [["cap-a", { colour: "hsl(200, 80%, 68%)", faded: false }], ["cap-c", { colour: "hsl(300, 80%, 68%)", faded: true }]]);
  // Three territories in a row; cap-a is two cells, so the edge between its own cells is not its border.
  const cell = (x: number, territory: number) => ({ polygon: [{ x, z: -4 }, { x: x + 8, z: -4 }, { x: x + 8, z: 4 }, { x, z: 4 }], territory });
  const land = { territories: [{ capability: "cap-a", status: "healthy" as const }, { capability: "cap-b" }, { capability: "cap-c" }], cells: [cell(-8, 0), cell(0, 0), cell(8, 1), cell(16, 2)], borders: [] };
  const drawn = territoryLand(land, flat, undefined, tints);
  const outline = drawn.getObjectByName("territory-claim:cap-a") as Mesh;
  assert.ok(outline !== undefined, "the claimed territory has an outline");
  assert.equal(drawn.getObjectByName("territory-claim:cap-b"), undefined, "an unclaimed territory has none");
  assert.deepEqual(outline.userData, { claim: true, capability: "cap-a", colour: "hsl(200, 80%, 68%)", faded: false });
  assert.ok((outline.material as MeshBasicMaterial).color.equals(new Color("hsl(200, 80%, 68%)")));
  assert.equal(drawn.getObjectByName("territory:cap-a")!.userData.claimedBy, "hsl(200, 80%, 68%)");
  assert.ok(((drawn.getObjectByName("territory:cap-a") as Mesh).material as MeshBasicMaterial).color.equals(new Color("#97C459")), "the fill still says its word");
  // Inset: every point of the outline lies inside cap-a's land (x -8..8, z -4..4), touching its border and reaching no deeper than a band.
  const position = outline.geometry.getAttribute("position");
  const depth = (x: number, z: number) => Math.min(x + 8, 8 - x, z + 4, 4 - z);
  const depths = Array.from({ length: position.count }, (_, at) => depth(position.getX(at), position.getZ(at)));
  assert.ok(depths.every((d) => d >= -1e-9), "the outline never leaves its territory");
  assert.ok(Math.min(...depths) < 1e-9 && Math.max(...depths) > 0 && Math.max(...depths) < 2, "a band just inside the border");
  const nearMiddle = Array.from({ length: position.count }, (_, at) => Math.abs(position.getX(at)) < 2 && depth(position.getX(at), position.getZ(at)) > 2);
  assert.ok(!nearMiddle.some(Boolean), "the edge between cap-a's own cells is not outlined");
  const quiet = drawn.getObjectByName("territory-claim:cap-c") as Mesh;
  assert.ok((quiet.material as MeshBasicMaterial).opacity < (outline.material as MeshBasicMaterial).opacity, "a quiet claimant's outline fades");
});
