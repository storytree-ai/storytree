/**
 * Capability 3 · Story node render: the selected island's roads drawn sandy and faint, the borders quietened and cut
 * open at each gate, a post either side of every gate (ADR-1236 D1, rollout 2 step 3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Vector3 } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { presentTerritories } from "./globe-surfaces.js";
import { islandRoadMarks, landFill, ROAD } from "./island-roads.js";
import { territoryLand } from "./territory-land.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};

test("3.77 the selected island's borders are quietened and cut open at every gate; any other island's are whole", () => {
  assert.ok(roads.gates.length > 0);
  const whole = territoryLand(map, flat, coast).getObjectByName("territory-borders") as LineSegments;
  const cut = territoryLand(map, flat, coast, new Map(), roads.gates).getObjectByName("territory-borders") as LineSegments;
  const ground = (lines: LineSegments) => { const g = lines.userData.ground as number[]; return Array.from({ length: g.length / 4 }, (_, i) => [{ x: g[4 * i]!, z: g[4 * i + 1]! }, { x: g[4 * i + 2]!, z: g[4 * i + 3]! }] as const); };
  for (const gate of roads.gates) {
    assert.ok(ground(whole).some(([a, b]) => toSegment(gate.at, a, b) < 1e-6), "the gate stands on a border");
    for (const [a, b] of ground(cut)) assert.ok(toSegment(gate.at, a, b) > gate.opening / 2 - 1e-6, "no border line across its opening");
  }
  assert.ok((cut.material as LineBasicMaterial).opacity < (whole.material as LineBasicMaterial).opacity, "quieter under the roads");
});

test("3.77 each road is a sandy ribbon as wide as the links it carries, its sand mixed into the land under it, with a post either side of every gate", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads.gates);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const ribbons = marks.children.filter((o) => o.name.startsWith("road:")) as Mesh[];
  assert.equal(ribbons.length, roads.segments.length);
  ribbons.forEach((ribbon, i) => {
    const at = ribbon.geometry.getAttribute("position"), colour = ribbon.geometry.getAttribute("color");
    assert.ok(Math.abs(Math.hypot(at.getX(1) - at.getX(0), at.getZ(1) - at.getZ(0)) - roads.segments[i]!.width) < 1e-4, "its width");
    const shown = new Color(colour.getX(0), colour.getY(0), colour.getZ(0)), sand = new Color(ROAD.colour);
    assert.ok(Math.abs(shown.r - sand.r) < 0.25 && Math.abs(shown.g - sand.g) < 0.25 && !shown.equals(sand), "sand mixed into the land");
  });
  const discs = marks.children.filter((o) => o.name.startsWith("road-junction:")) as Mesh[];
  assert.ok(roads.junctions.length > 0 && discs.length === roads.junctions.length, "a disc at each junction");
  discs.forEach((disc, i) => {
    const { at, width } = roads.junctions[i]!, rim = disc.geometry.getAttribute("position");
    assert.ok(Math.abs(Math.hypot(rim.getX(1) - at.x, rim.getZ(1) - at.z) - width / 2) < 1e-4, "as wide as the widest road meeting there");
    assert.ok(roads.segments.some((s) => s.width >= width - 1e-9 && s.pts.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 1e-6)));
    const colour = (disc.material as MeshBasicMaterial).color, sand = new Color(ROAD.colour);
    assert.ok(Math.abs(colour.r - sand.r) < 0.25 && !colour.equals(sand), "the road's sand mixed into the land");
  });
  assert.equal(marks.children.filter((o) => o.name.startsWith("gate-post:")).length, roads.gates.length * 2, "a post either side of every gate");
  assert.equal(marks.children.filter((o) => o.name.startsWith("gate-face:")).length, roads.gates.length * 2, "each with its paper face");
});

test("3.77 the selected island's roads show and hide with its territories", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads.gates);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  land.add(marks);
  presentTerritories(land, false);
  assert.equal(marks.visible, false, "hidden with the territories");
  presentTerritories(land, "plain");
  assert.equal(marks.visible, true);
  presentTerritories(land, "health");
  assert.equal(marks.visible, true);
});
