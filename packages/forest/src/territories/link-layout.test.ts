/**
 * Capability 3 · Story node render (the forest story): the selected island's territories laid out by their links
 * (ADR-1236 D1, rollout 2 step 2): open land round each dock its sea lanes come ashore at, each capability a lane
 * lands at beside it, every territory one connected piece of its size, laid out at The library's size and drawn at
 * the island's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { islandLayout, linkLayout, LIBRARY_LAND } from "./link-layout.js";
import { islandTerritories, territoryAt, type Coast, type TerritoryMap } from "./territories.js";

/** A round coast of `radius`, as a polygon of 96 sides. */
const round = (radius: number): Coast => [Array.from({ length: 96 }, (_, i) => ({ x: radius * Math.cos(i * Math.PI / 48), z: radius * Math.sin(i * Math.PI / 48) }))];
/** The library's size, so its island scale is 1. */
const LIBRARY_RADIUS = Math.sqrt(LIBRARY_LAND / Math.PI);
const shares = [
  { capability: "a", lines: 900 }, { capability: "b", lines: 700 }, { capability: "c", lines: 500 },
  { capability: "d", lines: 300 }, { capability: "e", lines: 200 }, { capability: "f", lines: 1 }, { lines: 150 },
];
// a and b have lanes over the sea (z1 and z2 on other islands build on a; b builds on y); c to f link only at home.
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "a" }, { from: "z3", to: "a" }, { from: "b", to: "y" },
  { from: "c", to: "a" }, { from: "d", to: "c" }, { from: "e", to: "d" }, { from: "f", to: "e" }];
const east = (r: number) => ({ local: { x: r, z: 0 }, links: ["z1->a", "z2->a", "z3->a"] });
// The west dock also lists links with both ends at home, which are no lanes and open no land.
const west = (r: number) => ({ local: { x: -r, z: 0 }, links: ["b->y", "c->a", "d->c", "e->d"] });
const far = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
const cellsOf = (map: TerritoryMap, capability: string | undefined) => {
  const at = map.territories.findIndex((t) => t.capability === capability);
  return map.cells.filter((cell) => cell.territory === at);
};

test("3.76 the selected island leaves open land round each dock, wider the more lanes it carries, and each capability a lane lands at borders its dock's open land", () => {
  const r = LIBRARY_RADIUS, map = linkLayout(shares, round(r), links, [east(r), west(r)]);
  const open = map.cells.filter((cell) => cell.territory === -1);
  for (const cell of map.cells) if (far(cell.site, east(r).local) < 11 || far(cell.site, west(r).local) < 11) assert.equal(cell.territory, -1, "within 11 units of a dock is open land");
  // A dock carrying three lanes opens land further out than one carrying one.
  assert.ok(open.some((cell) => far(cell.site, east(r).local) > 13), "the three-lane dock's open land reaches past 13 units");
  assert.ok(!open.some((cell) => far(cell.site, west(r).local) > 13 && far(cell.site, east(r).local) > 30), "the one-lane dock's does not");
  for (const [capability, dock] of [["a", east(r).local], ["b", west(r).local]] as const) {
    const besideOpen = cellsOf(map, capability).some((cell) => cell.neighbours.some((n) => map.cells[n]!.territory === -1 && far(map.cells[n]!.site, dock) < 20));
    assert.ok(besideOpen, `${capability} borders the open land round its dock`);
  }
  assert.equal(territoryAt(map, open[0]!.site.x, open[0]!.site.z), undefined, "open land picks no capability");
});

test("3.76 laid out by its links, every territory is one connected piece holding its share of the territories' land, never under round 13's minimum", () => {
  const r = LIBRARY_RADIUS, map = linkLayout(shares, round(r), links, [east(r), west(r)]);
  const owned = map.cells.filter((cell) => cell.territory >= 0).length;
  const sizes = shares.map((share) => cellsOf(map, share.capability).length);
  assert.equal(sizes.reduce((s, n) => s + n, 0), owned, "every cell not open is held");
  sizes.forEach((n, at) => {
    assert.ok(n >= Math.round((5 / 246) * owned), `${shares[at]!.capability ?? "Unclaimed"} holds ${n} cells`);
    const cells = cellsOf(map, shares[at]!.capability), reached = new Set([cells[0]!.index]);
    for (let grew = true; grew;) { grew = false; for (const cell of cells) if (!reached.has(cell.index) && cell.neighbours.some((x) => reached.has(x))) { reached.add(cell.index); grew = true; } }
    assert.equal(reached.size, cells.length, `${shares[at]!.capability ?? "Unclaimed"} is in one piece`);
  });
  assert.ok(sizes[0]! > sizes[2]! && sizes[2]! > sizes[4]!, "more lines, more land");
  for (const cell of map.cells) if (cell.territory >= 0) assert.equal(territoryAt(map, cell.site.x, cell.site.z), map.territories[cell.territory]);
});

test("3.76 a small island is laid out at The library's size and drawn at its own: as many cells, its open land scaled down with it", () => {
  const r = LIBRARY_RADIUS / 2, scale = 0.5;
  const small = linkLayout(shares, round(r), links, [east(r), west(r)]), big = linkLayout(shares, round(LIBRARY_RADIUS), links, [east(LIBRARY_RADIUS), west(LIBRARY_RADIUS)]);
  assert.ok(Math.abs(small.cells.length - big.cells.length) <= big.cells.length * 0.05, `${small.cells.length} cells against The library's ${big.cells.length}`);
  for (const cell of small.cells) if (far(cell.site, west(r).local) < 11 * scale) assert.equal(cell.territory, -1, "within its dock's scaled reach is open land");
  assert.ok(small.cells.some((cell) => cell.territory >= 0 && far(cell.site, west(r).local) < 11), "land The library would leave open is held here");
  assert.ok(small.cells.every((cell) => Math.hypot(cell.site.x, cell.site.z) <= r + 1e-6), "drawn on its own coast");
});

test("3.76 only an island given its docks is laid out by its links; any other keeps the map's own cut", () => {
  const coast = round(40);
  assert.equal(islandLayout("s", shares, coast, links, undefined), islandTerritories(shares, coast));
  const laid = islandLayout("s", shares, coast, links, [east(40)]);
  assert.notEqual(laid, islandTerritories(shares, coast));
  assert.equal(islandLayout("s", shares, coast, links, [east(40)]), laid, "laid out once for the same docks");
});

test("3.76 land the open land cuts off from the rest of the island is open land too", () => {
  // A long thin island, cut across off its middle by the open land round two docks facing each other.
  const coast: Coast = [[{ x: -200, z: -18 }, { x: 200, z: -18 }, { x: 200, z: 18 }, { x: -200, z: 18 }]];
  const many = Array.from({ length: 64 }, (_, i) => `z${i}->a`);
  const map = linkLayout(shares, coast, links, [90, 100, 110].flatMap((x) => [{ local: { x, z: -18 }, links: many }, { local: { x, z: 18 }, links: many }]));
  const beyond = map.cells.filter((cell) => cell.site.x > 140);
  assert.ok(beyond.length > 0);
  for (const cell of beyond) assert.equal(cell.territory, -1, "the end beyond the cut is open land");
  assert.ok(map.cells.filter((cell) => cell.site.x < 50).every((cell) => cell.territory >= 0), "the rest is held");
});

test("3.76 an island whose open land leaves fewer cells than it has territories keeps the map's own cut", () => {
  const coast = round(LIBRARY_RADIUS), crowd = Array.from({ length: 300 }, (_, i) => ({ capability: `c${i}`, lines: 1 }));
  assert.equal(linkLayout(crowd, coast, [], [{ local: { x: LIBRARY_RADIUS, z: 0 }, links: ["z->c0"] }]), islandTerritories(crowd, coast));
});
