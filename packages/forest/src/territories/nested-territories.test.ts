/**
 * Capability 3 · Story node render (the forest story): an opened capability's code parts laid out as territories inside
 * its own, with roads and gates of their own (ADR-1339 D1, arc_0c4277f81731).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { islandRoads } from "./island-roads.js";
import { linkLayout, LIBRARY_LAND, type Link } from "./link-layout.js";
import { keepPartSeeds, keptPartSeeds, nestedLayout, nestedLayoutSteps, PART_SHARE, partCrossings, regionOf, shelvePartsOn } from "./nested-territories.js";
import type { ArrangementShelf, KeptArrangement } from "./kept-layout.js";
import { landArea, onLand, territoryAt, type Coast, type Point, type TerritoryMap } from "./territories.js";

const round = (radius: number): Coast => [Array.from({ length: 96 }, (_, i) => ({ x: radius * Math.cos(i * Math.PI / 48), z: radius * Math.sin(i * Math.PI / 48) }))];
const LIBRARY_RADIUS = Math.sqrt(LIBRARY_LAND / Math.PI);
const shares = [
  { capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 },
  { capability: "d", title: "4 · Delta", lines: 300 }, { capability: "e", title: "5 · Epsilon", lines: 200 }, { lines: 150 },
];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "a" }, { from: "z3", to: "b" }, { from: "c", to: "y" },
  { from: "d", to: "a" }, { from: "e", to: "d" }, { from: "e", to: "b" }, { from: "a", to: "c" }];
const docks = [{ local: { x: LIBRARY_RADIUS, z: 0 }, links: ["z1->a", "z2->a", "z3->b"] }, { local: { x: -LIBRARY_RADIUS, z: 0 }, links: ["c->y"] }];
const names = (map: TerritoryMap) => map.territories.flatMap((t, at) => {
  const sites = map.cells.filter((c) => c.territory === at).map((c) => c.site);
  return t.capability === undefined || sites.length === 0 ? [] : [{ capability: t.capability, title: t.title ?? t.capability, x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length }];
});
const island = linkLayout(shares, round(LIBRARY_RADIUS), links, docks);
const roads = islandRoads(island, links, docks, names(island));
const A = island.territories.findIndex((t) => t.capability === "a");
// Alpha's code: three folders with their own entry files, and a few files of its own in none.
const parts = [{ capability: "p", title: "p", lines: 400 }, { capability: "q", title: "q", lines: 300 }, { capability: "r", title: "r", lines: 150 }, { capability: "a", title: "1 · Alpha", lines: 50 }];
const partLinks: Link[] = [{ from: "p", to: "q" }, { from: "q", to: "r" }];
// Which parts each of Alpha's links reaches, by the files behind it: d's imports reach p and r, z1's p, z2's q; a->c
// starts in q. No file is behind z2's second link, which reaches no part.
const lanes = { "d->a": ["p", "r"], "z1->a": ["p"], "z2->a": ["q"], "a->c": ["q"] };
const far = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.z - q.z);
const shifted = (p: Point, by: Point): Point => ({ x: p.x + by.x, z: p.z + by.z });

test("3.112 · a capability's land is traced as a coast of its own: on its land inside, off it outside", () => {
  const region = regionOf(island, A);
  assert.ok(region.length >= 1, "it has a coast");
  const cells = island.cells.filter((cell) => cell.territory === A);
  const step = Math.sqrt(landArea(region) / cells.length);
  // Every point of the island well inside or well outside Alpha's land reads the same on its traced coast.
  for (let x = -LIBRARY_RADIUS; x <= LIBRARY_RADIUS; x += 3) for (let z = -LIBRARY_RADIUS; z <= LIBRARY_RADIUS; z += 3) {
    const p = { x, z }, own = territoryAt(island, x, z) === island.territories[A];
    const sure = [0, 1, 2, 3].every((k) => { const q = { x: x + Math.cos(k * Math.PI / 2) * step * 0.3, z: z + Math.sin(k * Math.PI / 2) * step * 0.3 }; return (territoryAt(island, q.x, q.z) === island.territories[A]) === own; });
    if (sure) assert.equal(onLand(p, region), own && onLand(p, island.coast!), `at ${x},${z}`);
  }
});

test("3.112 · an opened capability's parts are laid out inside its land, each one piece sized by its lines and never under its least share", () => {
  const region = regionOf(island, A), crossings = partCrossings(island, roads, "a", lanes, docks);
  const laid = nestedLayout(region, parts, partLinks, crossings)!;
  const { map, centre } = laid;
  const owned = map.cells.filter((cell) => cell.territory >= 0);
  // Traced on a grid, its coast may stand a step past the island's: no part's cell lies on another capability's land.
  const under = owned.map((cell) => territoryAt(island, cell.site.x + centre.x, cell.site.z + centre.z));
  assert.ok(under.every((t) => t === island.territories[A] || t === undefined), "no part's cell lies on another capability's land");
  assert.ok(under.filter((t) => t === undefined).length <= owned.length * 0.02, "and hardly any off the island's coast");
  const sizes = parts.map((part) => map.cells.filter((cell) => map.territories[cell.territory]?.capability === part.capability).length);
  assert.equal(sizes.reduce((s, n) => s + n, 0), owned.length, "every cell held is a part's");
  assert.ok(owned.length >= 120, `the capability has its own fine cut: ${owned.length} cells`);
  sizes.forEach((n, at) => {
    assert.ok(n >= Math.round(PART_SHARE * owned.length) - 2, `${parts[at]!.capability} holds ${n} of ${owned.length} cells`);
    const cells = map.cells.filter((cell) => map.territories[cell.territory]?.capability === parts[at]!.capability), reached = new Set([cells[0]!.index]);
    for (let grew = true; grew;) { grew = false; for (const cell of cells) if (!reached.has(cell.index) && cell.neighbours.some((x) => reached.has(x))) { reached.add(cell.index); grew = true; } }
    assert.equal(reached.size, cells.length, `${parts[at]!.capability} is in one piece`);
  });
  assert.ok(sizes[0]! > sizes[1]! && sizes[1]! > sizes[2]!, "more lines, more land");
});

test("3.112 · each road crossing the capability's border carries its lanes on to the parts its files reach, and the parts' roads are routed from there through gates of their own", () => {
  const crossings = partCrossings(island, roads, "a", lanes, docks);
  const all = crossings.flatMap((crossing) => crossing.links).sort();
  assert.deepEqual(all, ["arrive:0->p", "arrive:0->q", "d->p", "d->r", "q->c"].sort(), "a lane per part each road reaches, none for a link no file shows");
  for (const crossing of crossings) {
    const by = island.territories[A];
    const near = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => territoryAt(island, crossing.local.x + Math.cos(k * Math.PI / 4), crossing.local.z + Math.sin(k * Math.PI / 4)));
    assert.ok(near.includes(by) && near.some((t) => t !== by), "it stands on Alpha's border");
  }
  const entering = crossings.find((crossing) => crossing.links.includes("d->p"))!;
  assert.ok(entering.gate !== undefined && roads.gates[entering.gate]!.entrances.includes("d->a"), "d's road comes in at its gate into Alpha");

  const laid = nestedLayout(regionOf(island, A), parts, partLinks, crossings)!;
  const local = crossings.map((crossing) => ({ local: shifted(crossing.local, { x: -laid.centre.x, z: -laid.centre.z }), links: crossing.links }));
  const lanesIn = crossings.flatMap((crossing) => crossing.links.map((key) => { const [from, to] = key.split("->") as [string, string]; return { from, to }; }));
  const inner = islandRoads(laid.map, [...partLinks, ...lanesIn], local, names(laid.map));
  assert.deepEqual([...inner.settlements.keys()].sort(), ["p", "q", "r"], "each part a road reaches has its junction; Alpha's own files, reached by none, have none");
  const carried = new Set(inner.segments.flatMap((segment) => segment.links));
  for (const key of ["p->q", "q->r"]) assert.ok(carried.has(key), `the parts' road ${key} is drawn`);
  assert.ok(inner.gates.some((gate) => gate.entrances.includes("p->q") && gate.between.includes("q")), "the road from p enters q through a gate of q's");
  // Each road in comes ashore where the island's crosses Alpha's border.
  for (const crossing of local) assert.ok(inner.segments.some((segment) => [segment.pts[0]!, segment.pts.at(-1)!].some((p) => far(p, crossing.local) < 6)), "a part road starts at the crossing");
});

test("3.113 · opening a capability lays its parts out on its land as drawn, and moves nothing on the island", () => {
  const before = JSON.stringify(island);
  nestedLayout(regionOf(island, A), parts, partLinks, partCrossings(island, roads, "a", lanes, docks));
  assert.equal(JSON.stringify(island), before, "the island's layout is as it was");
  const region = regionOf(island, A), crossings = partCrossings(island, roads, "a", lanes, docks);
  nestedLayout(region, parts, partLinks, crossings);
  const again = nestedLayoutSteps(region, parts, partLinks, crossings);
  assert.equal(again.next().done, true, "asked again, it takes no step: laid out once");
});

test("3.113 · a part added or dropped is laid out with the others' kept seeds, so each part kept still grows from its own place", () => {
  const region = regionOf(island, A), crossings = partCrossings(island, roads, "a", lanes, docks);
  const first = nestedLayout(region, parts, partLinks, crossings)!;
  assert.ok(first.seeds !== undefined);
  const holder = (laid: NonNullable<ReturnType<typeof nestedLayout>>, p: Point) => {
    const at = { x: p.x - laid.centre.x, z: p.z - laid.centre.z };
    return laid.map.cells.reduce((best, cell) => (far(cell.site, at) < far(best.site, at) ? cell : best)).territory;
  };
  const added = [{ capability: "o", title: "o", lines: 700 }, ...parts];
  const grown = nestedLayout(region, added, [...partLinks, { from: "o", to: "r" }, { from: "o", to: "a" }], crossings, first.seeds)!;
  for (const part of parts) assert.equal(grown.map.territories[holder(grown, first.seeds[part.capability]!)]?.capability, part.capability, `${part.capability} still holds its kept seed with o added`);
  const dropped = parts.filter((part) => part.capability !== "q");
  const shrunk = nestedLayout(region, dropped, partLinks.filter((l) => l.from !== "q" && l.to !== "q"), crossings, first.seeds)!;
  for (const part of dropped) assert.equal(shrunk.map.territories[holder(shrunk, first.seeds[part.capability]!)]?.capability, part.capability, `${part.capability} still holds its kept seed with q dropped`);
});

test("3.114 · each crossing on the capability's border counts the part roads it rolls up, read without laying the parts out", () => {
  const crossings = partCrossings(island, roads, "a", lanes, docks);
  const at = (key: string) => crossings.find((crossing) => crossing.gate !== undefined && roads.gates[crossing.gate]!.entrances.includes(key));
  assert.deepEqual(at("d->a")?.links, ["d->p", "d->r"], "d's gate rolls up its two part roads");
  assert.deepEqual(at("arrive:0->a")?.links, ["arrive:0->p", "arrive:0->q"], "the sea road's gate rolls up z1's and z2's");
  assert.deepEqual(at("a->c")?.links, ["q->c"], "the road out to c rolls up q's");
});

test("3.115 · an opened capability is laid out in steps, so the frame that opens it lays out none of it at once", () => {
  const region = regionOf(island, A), crossings = partCrossings(island, roads, "a", lanes, docks);
  const steps = nestedLayoutSteps(region, [...parts, { capability: "t", title: "t", lines: 90 }], partLinks, crossings);
  let taken = 0;
  for (let at = steps.next(); !at.done; at = steps.next()) taken++;
  // The fine cut alone takes a step for each 32 cells it cuts and each 32 it hands out (3.87), then a step for each try at growing.
  const laid = nestedLayout(region, [...parts, { capability: "t", title: "t", lines: 90 }], partLinks, crossings)!;
  assert.ok(taken >= Math.floor(laid.map.cells.length / 32), `${taken} steps for a cut of ${laid.map.cells.length} cells`);
});

test("3.113 · each opened capability's part seeds are kept on the page's storage, merged, so a later run and a part dropped and back keep their places", () => {
  const stored = new Map<string, KeptArrangement>();
  const shelf: ArrangementShelf = { read: (key) => stored.get(key), write: (key, kept) => { stored.set(key, kept); } };
  shelvePartsOn(shelf);
  keepPartSeeds("s", "a", { p: { x: 1, z: 2 }, q: { x: 3, z: 4 } });
  keepPartSeeds("s", "a", { p: { x: 5, z: 6 } });
  shelvePartsOn(shelf);
  assert.deepEqual(keptPartSeeds("s", "a"), { p: { x: 5, z: 6 }, q: { x: 3, z: 4 } }, "a later run reads them back, q's kept while it was not laid out");
  assert.equal(keptPartSeeds("s", "b"), undefined, "another capability's are its own");
  shelvePartsOn(undefined);
});
