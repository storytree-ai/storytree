/**
 * Capability 3 · Story node render: the selected island's relief (ADR-1236 D1, rollout 2 step 3b): every territory a
 * plateau above the open land, walls and rims round it, a ramp only where a road climbs from the open land, and the
 * gate posts standing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Mesh, Vector3 } from "three";

import { islandRelief, LIGHT } from "../territories/island-relief.js";
import { islandRoads } from "../territories/island-roads.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { presentTerritories } from "./globe-surfaces.js";
import { islandReliefMarks } from "./island-relief.js";
import { islandRoadMarks, landFill, shade } from "./island-roads.js";
import { capabilityPlates } from "./nameplates.js";
import { territoryLand } from "./territory-land.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const relief = islandRelief(map, roads);
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
const territoryOf = (p: Point) => map.cells.reduce((b, c) => (far(c.site, p) < far(b.site, p) ? c : b)).territory;
const open = map.cells.filter((c) => c.territory < 0);

test("3.78 every territory on the selected island stands one plateau's height above its open land, all at one height", () => {
  assert.ok(open.length > 0 && relief.height > 0);
  for (const cell of map.cells) {
    if (cell.territory >= 0) assert.equal(relief.raise(cell.site), relief.height, "a territory's land on the plateau");
    else if (relief.ramps.every((r) => far(r.at, cell.site) > relief.rampWidth + relief.rampDepth)) assert.equal(relief.raise(cell.site), 0, "open land stays low");
  }
  assert.equal(relief.raise({ x: R * 2, z: 0 }), 0, "nothing off the coast");
});

test("3.78 a ramp only where a road climbs from the open land onto a territory, sloping from the plateau's edge down to the open land", () => {
  const onto = roads.gates.filter((g) => { const n = { x: -g.along.z, z: g.along.x }; const sides = [territoryOf(at(g.at, n, 0.8)), territoryOf(at(g.at, n, -0.8))]; return sides.includes(-1) && sides.some((t) => t >= 0); });
  assert.ok(onto.length > 0 && onto.length < roads.gates.length, "some gates between territories, some onto the open land");
  assert.equal(relief.ramps.length, onto.length, "a ramp at every gate onto the open land, and nowhere else");
  for (const r of relief.ramps) {
    assert.ok(onto.includes(r.gate));
    assert.equal(territoryOf(at(r.at, r.out, 0.8)), -1, "it runs out onto the open land");
    assert.equal(territoryOf(at(r.at, r.out, -0.8)), r.territory, "from its territory");
    const h = (k: number) => relief.raise(at(r.at, r.out, relief.rampDepth * k));
    assert.ok(Math.abs(h(0.01) - relief.height) < relief.height * 0.05 && Math.abs(h(0.5) - relief.height / 2) < 1e-9 && h(1.01) === 0, "a slope from the plateau's edge to the open land");
  }
});

test("3.78 a wall wherever a plateau meets the open land or the coast, open at each ramp; a bevel rim inside each border on every territory's side, broken at every gate", () => {
  assert.ok(relief.walls.some((w) => w.onto === "open") && relief.walls.some((w) => w.onto === "coast"));
  for (const w of relief.walls) {
    const mid = at({ x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 }, w.out, 0.3);
    assert.equal(w.onto === "open" ? territoryOf(mid) : Math.hypot(mid.x, mid.z) > R - 0.5, w.onto === "open" ? -1 : true, "it faces off the plateau");
    for (const r of relief.ramps) assert.ok(toSegment(r.at, w.from, w.to) > 0.6 || [w.from, w.to].every((p) => far(p, r.at) >= relief.rampWidth / 2 - 1e-6), "no wall across a ramp");
  }
  assert.ok(relief.rims.length > 0);
  for (const rim of relief.rims) {
    assert.equal(territoryOf(at({ x: (rim.from.x + rim.to.x) / 2, z: (rim.from.z + rim.to.z) / 2 }, rim.into, 0.4)), rim.territory, "inside its territory");
    for (const g of roads.gates) assert.ok(toSegment(g.at, rim.from, rim.to) > 0.6 || [rim.from, rim.to].every((p) => far(p, g.at) >= g.opening / 2 - 1e-6), "broken at the gate");
  }
  const between = map.borders.filter((b) => map.cells[b.between[0]]!.territory >= 0 && map.cells[b.between[1]]!.territory >= 0);
  assert.ok(between.length > 0 && relief.rims.filter((r) => between.some((b) => toSegment(r.from, b.from, b.to) < 1e-6 && toSegment(r.to, b.from, b.to) < 1e-6)).length >= 2, "both sides of a border between territories");
});

test("3.78 the walls, ramps and rims are drawn, a face toward the light lighter than one turned away, and they show and hide with the territories", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads.gates);
  const marks = islandReliefMarks(relief, flat, landFill(map, land));
  const walls = marks.getObjectByName("relief-walls") as Mesh, ramps = marks.getObjectByName("relief-ramps") as Mesh, rims = marks.getObjectByName("relief-rims") as Mesh;
  assert.equal(walls.geometry.getAttribute("position").count, relief.walls.length * 6);
  const heights = Array.from({ length: walls.geometry.getAttribute("position").count }, (_, i) => walls.geometry.getAttribute("position").getY(i));
  assert.ok(Math.abs(Math.max(...heights) - relief.height) < 1e-6 && Math.min(...heights) <= 0, "from the open land up to the plateau");
  assert.equal(ramps.geometry.getAttribute("position").count, relief.ramps.length * 6);
  assert.equal(rims.geometry.getAttribute("position").count, relief.rims.length * 12);
  const grey = new Color("#808080"), lit = shade(grey, LIGHT), away = shade(grey, { x: -LIGHT.x, z: -LIGHT.z });
  assert.ok(lit.r > away.r, "a face toward the light shows lighter");
  land.add(marks);
  presentTerritories(land, false);
  assert.equal(marks.visible, false);
  presentTerritories(land, "health");
  assert.equal(marks.visible, true);
});

test("3.78 the roads follow the relief, and every gate's posts stand up from the land, an entrance's larger, clear of its ramp", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads.gates);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), relief);
  for (const road of marks.children.filter((o) => o.name.startsWith("road:")) as Mesh[]) {
    const p = road.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i += 7) {
      // Stored as 32-bit floats, so a point on a border may read from either side of it.
      const near = [[0, 0], [1e-4, 0], [-1e-4, 0], [0, 1e-4], [0, -1e-4]].map(([dx, dz]) => relief.raise({ x: p.getX(i) + dx!, z: p.getZ(i) + dz! }));
      assert.ok(near.some((h) => Math.abs(p.getY(i) - h) < 1e-4), "on the land under it");
    }
  }
  const posts = marks.children.filter((o) => o.name.startsWith("gate-post:")) as Mesh[];
  assert.equal(posts.length, roads.gates.length * 2);
  for (const post of posts) {
    const p = post.geometry.getAttribute("position"), ys = Array.from({ length: p.count }, (_, i) => p.getY(i));
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - post.userData.height) < 1e-5 && post.userData.height > 0, "standing its height");
    const [, gate, sign] = post.name.split(":"), g = roads.gates[Number(gate)]!, ramp = relief.ramps.find((r) => r.gate === g);
    const middle = { x: (Math.max(...Array.from({ length: p.count }, (_, i) => p.getX(i))) + Math.min(...Array.from({ length: p.count }, (_, i) => p.getX(i)))) / 2, z: (Math.max(...Array.from({ length: p.count }, (_, i) => p.getZ(i))) + Math.min(...Array.from({ length: p.count }, (_, i) => p.getZ(i)))) / 2 };
    if (ramp !== undefined) assert.ok(Math.abs((middle.x - g.at.x) * g.along.x + (middle.z - g.at.z) * g.along.z) > relief.rampWidth / 2, `post ${gate}:${sign} beside its ramp`);
  }
  assert.ok(relief.post.entranceHeight > relief.post.height && relief.post.entrance > relief.post.side);
  for (const post of posts) assert.equal(post.userData.height, post.userData.entrance ? relief.post.entranceHeight : relief.post.height, "an entrance's posts stand taller");
});
