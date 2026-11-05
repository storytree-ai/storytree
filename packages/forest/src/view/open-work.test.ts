/**
 * Capability 3 · Story node render: an arc selected circles the territories its open work names and dims the rest (3.83), and a
 * dot marks every territory any open increment names, clear of its name, its settlement and its gates (3.84) (ADR-1253 D1).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, Vector3 } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { territoryLand } from "./territory-land.js";
import { arcEmphasis, openWorkLayer, openWorkMarks, presentOpenWork } from "./open-work.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }, { lines: 200 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const plates = new Map(capabilityPlates(map).map((plate) => [plate.capability, plate]));
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const inside = (p: Point, polygon: readonly Point[]) => polygon.every((a, i) => { const b = polygon[(i + 1) % polygon.length]!; return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9; });
const territoryOf = (capability: string) => map.territories.findIndex((territory) => territory.capability === capability);

test("3.83 · an arc selected rings each territory its open work names, along the inside of its own border, and dims every other territory", () => {
  const marks = openWorkMarks(map, { circled: new Set(["a", "c", "elsewhere"]), open: new Set() }, undefined, coast);
  assert.deepEqual(marks.rings.map(({ capability }) => capability), ["a", "c"], "a capability on another island rings nothing here");
  for (const ring of marks.rings) {
    const at = territoryOf(ring.capability);
    const own = map.cells.filter(({ territory }) => territory === at).map(({ polygon }) => polygon);
    const edges = (polygons: readonly (readonly Point[])[]) => polygons.flatMap((polygon) => polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as const));
    const border = [...edges(map.cells.filter(({ territory }) => territory !== at).map(({ polygon }) => polygon)), ...edges(coast)];
    const perimeter = border.filter(([a, b]) => own.some((cell) => cell.some((p) => Math.hypot(p.x - a.x, p.z - a.z) < 1e-6) && cell.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 1e-6)))
      .reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.z - a.z), 0);
    assert.ok(ring.outline.reduce((sum, { from, to }) => sum + Math.hypot(to.x - from.x, to.z - from.z), 0) > perimeter * 0.6, "the ring runs most of the way round");
    for (const { from, to } of ring.outline) for (const p of [from, to]) {
      assert.ok(own.some((cell) => inside(p, cell)), "the ring lies on its own territory's land");
      assert.ok(Math.min(...border.map(([a, b]) => toSegment(p, a, b))) < R * 0.05, "hugging its border");
    }
  }
  const unclaimed = map.territories.findIndex(({ capability }) => capability === undefined);
  assert.ok(unclaimed >= 0);
  assert.deepEqual(marks.dimmed, [territoryOf("b"), territoryOf("d"), unclaimed].sort((x, y) => x - y), "unclaimed code is dimmed too");
  assert.deepEqual(openWorkMarks(map, { circled: undefined, open: new Set() }), { rings: [], dots: [], dimmed: [] }, "with no arc selected nothing is ringed or dimmed");
  assert.deepEqual(openWorkMarks(map, { circled: new Set(["elsewhere"]), open: new Set() }).dimmed, [], "an island the arc rings nothing on is dimmed whole, not territory by territory");
});

test("3.84 · a dot marks each territory open work names, whole on its own land, clear of the coast, its border, every name, settlement and gate", () => {
  const marks = openWorkMarks(map, { circled: undefined, open: new Set(["a", "b", "d", "elsewhere"]) }, roads, coast);
  assert.deepEqual(marks.dots.map(({ capability }) => capability), ["a", "b", "d"]);
  const gates = roads.gates.map(({ at }) => at);
  for (const dot of marks.dots) {
    const at = territoryOf(dot.capability), sites = map.cells.filter(({ territory }) => territory === at).map(({ site }) => site);
    assert.ok(sites.some((site) => site.x === dot.x && site.z === dot.z), "a dot stands on one of its territory's cell sites, so on its land");
    // The dot's casing is 0.061 of the island's reach across its middle: it stands whole on its own land, clear of every mark.
    const casing = 0.045 * 1.35 * R;
    const avoided = [...plates.values(), ...[...roads.settlements.values()].map(({ at }) => at), ...gates];
    assert.ok(Math.min(...avoided.map((q) => Math.hypot(dot.x - q.x, dot.z - q.z))) >= 2 * casing, "clear of every name, settlement and gate");
    assert.ok(Math.min(...coast[0]!.map((a, i) => toSegment(dot, a, coast[0]![(i + 1) % coast[0]!.length]!))) >= casing, "whole on the land, not over the coast");
    const border = map.cells.filter(({ territory }) => territory !== at).flatMap(({ polygon }) => polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as const));
    assert.ok(Math.min(...border.map(([a, b]) => toSegment(dot, a, b))) >= casing, "whole inside its own territory");
  }
  assert.deepEqual(openWorkMarks(map, { circled: undefined, open: new Set(["a"]) }).dots.length, 1, "an island not laid out by its roads still has its dots");
});

test("3.83, 3.84 · the open-work layer draws the rings and dots on the land, dims the other territories under their own outlines, and takes no pointer", () => {
  const land = territoryLand(map, flat, coast);
  const marks = openWorkMarks(map, { circled: new Set(["a"]), open: new Set(["a", "b"]) }, roads, coast);
  const layer = openWorkLayer(marks, land, flat, R);
  const named = (prefix: string) => layer.children.filter((child) => child.name.startsWith(prefix)).map(({ name }) => name).sort();
  assert.deepEqual(named("open-work-ring:"), ["open-work-ring:a"]);
  assert.deepEqual(named("open-work-dot:"), ["open-work-dot:a", "open-work-dot:b"]);
  const dims = layer.children.filter((child) => child.name.startsWith("open-work-dim:")) as Mesh[];
  assert.deepEqual(dims.map(({ name }) => name).sort(), map.territories.flatMap((t, at) => marks.dimmed.includes(at) ? [`open-work-dim:${t.capability ?? "unclaimed"}`] : []).sort());
  for (const dim of dims) assert.equal(dim.geometry, (land.getObjectByName(`territory:${dim.name.slice("open-work-dim:".length)}`) as Mesh).geometry, "a dim lies on its territory's own land");
  const hits: unknown[] = [];
  layer.traverse((object) => { if (object instanceof Mesh) object.raycast({} as never, hits as never); });
  assert.equal(hits.length, 0);
  const ring = layer.getObjectByName("open-work-ring:a") as Mesh;
  const position = ring.geometry.getAttribute("position");
  assert.equal(position.count, marks.rings[0]!.outline.length * 6, "a band along each piece of the outline");
  for (let i = 0; i < position.count; i++) {
    const p = { x: position.getX(i), z: position.getZ(i) };
    assert.ok(Math.min(...marks.rings[0]!.outline.map(({ from, to }) => toSegment(p, from, to))) < R * 0.03, "the band runs along the outline");
  }
  assert.equal(openWorkLayer(openWorkMarks(map, { circled: undefined, open: new Set() }), land, flat, R).children.length, 0);
});

test("3.83 · an arc selected dims every island none of whose territories it rings; with none selected no island is dimmed", () => {
  assert.equal(arcEmphasis(map.territories, new Set(["a"])), undefined);
  assert.equal(arcEmphasis(map.territories, new Set(["elsewhere"])), "dimmed");
  assert.equal(arcEmphasis(map.territories, undefined), undefined);
});

test("3.84, 3.86 · from far the open work keeps its dots and drops its rings and dims, which return with the territories", () => {
  const land = territoryLand(map, flat, coast);
  const layer = openWorkLayer(openWorkMarks(map, { circled: new Set(["a"]), open: new Set(["a", "b"]) }, roads, coast), land, flat, R);
  const shown = () => layer.children.filter((mark) => mark.visible).map((mark) => mark.name.split(":")[0]).sort();
  const kinds = [...new Set(shown())];
  assert.ok(kinds.includes("open-work-dot") && kinds.includes("open-work-ring") && kinds.includes("open-work-dim"));
  presentOpenWork(layer, "far");
  assert.deepEqual([...new Set(shown())], ["open-work-dot"], "only the dots from far");
  presentOpenWork(layer, "territories");
  assert.deepEqual([...new Set(shown())], kinds, "rings and dims back with the territories");
});
