/**
 * Capability 3 · Story node render: an arc selected draws a hollow ring round each capability its open work names, round its
 * settlement or its nameplate, and dims the rest (3.83); with no arc selected open work draws nothing (3.84); at every zoom, every
 * ring one width on screen (3.86) (ADR-1253 D1, ADR-1272 D2).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, Vector3 } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { territoryLand } from "./territory-land.js";
import { arcEmphasis, openWorkLayer, openWorkMarks, RING_LEAST_PX, RING_PX, sizeOpenWork } from "./open-work.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }, { lines: 200 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const plates = new Map(capabilityPlates(map).map((plate) => [plate.capability, plate]));
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const territoryOf = (capability: string) => map.territories.findIndex((territory) => territory.capability === capability);
/** The distances from `centre` of every corner of `mesh`'s triangles. */
const reaches = (mesh: Mesh, centre: Point) => {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i) - centre.x, position.getZ(i) - centre.z));
};

test("3.83 · an arc selected rings each capability its open work names, a hollow circle round its settlement, and dims every other territory", () => {
  const marks = openWorkMarks(map, new Set(["a", "c", "elsewhere"]), roads);
  assert.deepEqual(marks.rings.map(({ capability }) => capability), ["a", "c"], "a capability on another island rings nothing here");
  for (const ring of marks.rings) {
    const settlement = roads.settlements.get(ring.capability)!;
    assert.deepEqual({ x: ring.x, z: ring.z }, settlement.at, "round its settlement");
    // The symbol's 24-unit box is as large as its size: its corners lie 0.71 of the size from its middle.
    assert.ok(ring.radius > settlement.size * 0.71 && ring.radius < settlement.size * 1.2, "sized to the symbol, with a little room");
  }
  const unclaimed = map.territories.findIndex(({ capability }) => capability === undefined);
  assert.ok(unclaimed >= 0);
  assert.deepEqual(marks.dimmed, [territoryOf("b"), territoryOf("d"), unclaimed].sort((x, y) => x - y), "unclaimed code is dimmed too");
  const bare = openWorkMarks(map, new Set(["a"]));
  assert.deepEqual(bare.rings.map(({ capability, x, z }) => ({ capability, x, z })), [{ capability: "a", x: plates.get("a")!.x, z: plates.get("a")!.z }], "round its nameplate where it has no settlement");
  assert.deepEqual(openWorkMarks(map, new Set(["elsewhere"]), roads), { rings: [], dimmed: [] }, "an island the arc rings nothing on is dimmed whole, not territory by territory");
});

test("3.83 · the open-work layer draws each ring hollow on the land, dims the other territories under their own outlines, and takes no pointer", () => {
  const land = territoryLand(map, flat, coast);
  const marks = openWorkMarks(map, new Set(["a"]), roads);
  // Near enough that the ring is sized to its settlement, not to the least it is across on screen.
  const zoom = 40, width = RING_PX / zoom;
  const layer = openWorkLayer(marks, land, flat, zoom);
  const ring = layer.getObjectByName("open-work-ring:a") as Mesh;
  const distances = reaches(ring, marks.rings[0]!);
  assert.ok(Math.min(...distances) >= marks.rings[0]!.radius - width, "nothing filled inside the ring");
  assert.ok(Math.max(...distances) <= marks.rings[0]!.radius + width, "a thin line");
  const dims = layer.children.filter((child) => child.name.startsWith("open-work-dim:")) as Mesh[];
  assert.deepEqual(dims.map(({ name }) => name).sort(), map.territories.flatMap((t, at) => marks.dimmed.includes(at) ? [`open-work-dim:${t.capability ?? "unclaimed"}`] : []).sort());
  for (const dim of dims) assert.equal(dim.geometry, (land.getObjectByName(`territory:${dim.name.slice("open-work-dim:".length)}`) as Mesh).geometry, "a dim lies on its territory's own land");
  const hits: unknown[] = [];
  layer.traverse((object) => { if (object instanceof Mesh) object.raycast({} as never, hits as never); });
  assert.equal(hits.length, 0);
});

test("3.84 · with no arc selected open work draws nothing on the map", () => {
  const land = territoryLand(map, flat, coast);
  assert.equal(openWorkLayer(openWorkMarks(map, undefined, roads), land, flat, 1).children.length, 0);
});

test("3.83 · an arc selected dims every island none of whose territories it rings; with none selected no island is dimmed", () => {
  assert.equal(arcEmphasis(map.territories, new Set(["a"])), undefined);
  assert.equal(arcEmphasis(map.territories, new Set(["elsewhere"])), "dimmed");
  assert.equal(arcEmphasis(map.territories, undefined), undefined);
});

test("3.86 · an arc selected rings its capabilities and dims the rest at every zoom, with no ring round the island; one width on screen at every zoom", () => {
  const land = territoryLand(map, flat, coast);
  const layer = openWorkLayer(openWorkMarks(map, new Set(["a", "c"]), roads), land, flat, 1);
  /** A ring's line across, in CSS pixels at `zoom`. */
  const onScreen = (name: string, centre: Point, zoom: number) => { const d = reaches(layer.getObjectByName(name) as Mesh, centre); return (Math.max(...d) - Math.min(...d)) * zoom; };
  const far = 0.3, near = 3;
  assert.deepEqual([...new Set(layer.children.map((mark) => mark.name.split(":")[0]!))].sort(), ["open-work-dim", "open-work-ring"], "the capabilities' rings and the dims, and no island ring");
  sizeOpenWork(layer, far);
  const ring = layer.getObjectByName("open-work-ring:a")!, at = roads.settlements.get("a")!.at;
  const farWidth = onScreen("open-work-ring:a", at, far);
  assert.ok(Math.max(...reaches(ring as Mesh, at)) * 2 * far >= RING_LEAST_PX, "zoomed out, the ring is still at least its least across on screen");
  assert.equal(sizeOpenWork(layer, near), true);
  const nearWidth = onScreen("open-work-ring:a", at, near);
  assert.ok(Math.abs(nearWidth - farWidth) < 0.01 * farWidth && farWidth > 1, `one width on screen, far ${farWidth} px and near ${nearWidth} px`);
  const drawn = (ring as Mesh).geometry;
  assert.equal(sizeOpenWork(layer, near * 1.01), false, "a zoom that barely moves redraws nothing");
  assert.equal((ring as Mesh).geometry, drawn);
  // Where its settlement is drawn only a few pixels wide, the ring keeps the least it is across on screen, so it still reads.
  const settlement = roads.settlements.get("a")!, small = RING_LEAST_PX / 4 / settlement.size;
  sizeOpenWork(layer, small);
  const across = Math.max(...reaches(ring as Mesh, settlement.at)) * 2 * small;
  assert.ok(across >= RING_LEAST_PX && across <= RING_LEAST_PX + 2 * RING_PX, `at least ${RING_LEAST_PX} px across, ${across} px`);
});
