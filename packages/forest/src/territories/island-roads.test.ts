/**
 * Capability 3 · Story node render (the forest story): the selected island's links as one shared road network with
 * gates (ADR-1236 D1, rollout 2 step 3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { islandRoads, type IslandRoads } from "./island-roads.js";
import { linkLayout, LIBRARY_LAND } from "./link-layout.js";
import { type Coast, type Point, type TerritoryMap } from "./territories.js";

const round = (radius: number): Coast => [Array.from({ length: 96 }, (_, i) => ({ x: radius * Math.cos(i * Math.PI / 48), z: radius * Math.sin(i * Math.PI / 48) }))];
const LIBRARY_RADIUS = Math.sqrt(LIBRARY_LAND / Math.PI);
const shares = [
  { capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 },
  { capability: "d", title: "4 · Delta", lines: 300 }, { capability: "e", title: "5 · Epsilon", lines: 200 }, { lines: 150 },
];
// Other islands' z1 to z3 build on a and on b, arriving at the east dock; c builds on y over the sea; d and e link at home.
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "a" }, { from: "z3", to: "b" }, { from: "c", to: "y" },
  { from: "d", to: "a" }, { from: "e", to: "d" }, { from: "e", to: "b" }];
const docks = (r: number) => [{ local: { x: r, z: 0 }, links: ["z1->a", "z2->a", "z3->b"] }, { local: { x: -r, z: 0 }, links: ["c->y"] }];
const far = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.z - q.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const names = (map: TerritoryMap) => map.territories.flatMap((t, at) => {
  const sites = map.cells.filter((c) => c.territory === at).map((c) => c.site);
  return t.capability === undefined ? [] : [{ capability: t.capability, title: t.title ?? t.capability, x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length }];
});
const laid = (radius: number, among: typeof links = links) => {
  const coast = round(radius), map = linkLayout(shares, coast, among, docks(radius));
  return { map, roads: islandRoads(map, among, docks(radius), names(map)) };
};
const library = laid(LIBRARY_RADIUS);
/** Each link's way, as the segments carrying it joined end to end. */
const carrying = (roads: IslandRoads, key: string) => roads.segments.filter((s) => s.links.includes(key));

test("3.77 every link on the selected island has a road from its start to its end: between two settlements, or from its dock to one", () => {
  const { roads } = library;
  const keys = new Set(roads.segments.flatMap((s) => s.links));
  assert.deepEqual([...keys].sort(), ["arrive:0->a", "arrive:0->b", "c->leave:1", "d->a", "e->b", "e->d"],
    "one arrival per dock and capability, one way out, and each link between two of its capabilities");
  for (const key of keys) {
    const ends = carrying(roads, key).flatMap((s) => [s.pts[0]!, s.pts.at(-1)!]);
    // A way's own two ends are met by one of its segments only; every other end of its segments joins another of them.
    const loose = ends.filter((p) => ends.filter((q) => far(p, q) < 1e-6).length === 1);
    assert.equal(loose.length, 2, `${key} is one unbroken way`);
  }
  const east = { x: LIBRARY_RADIUS, z: 0 };
  assert.ok(carrying(roads, "arrive:0->a").some((s) => [s.pts[0]!, s.pts.at(-1)!].some((p) => far(p, east) < 1)), "an arrival starts at its dock");
  for (const key of ["d->a", "e->d"]) {
    const [from, to] = key.split("->") as [string, string];
    const ends = carrying(roads, key).flatMap((s) => [s.pts[0]!, s.pts.at(-1)!]);
    assert.ok(ends.some((p) => far(p, roads.towns.get(from)!) < 1e-6) && ends.some((p) => far(p, roads.towns.get(to)!) < 1e-6), `${key} runs between their settlements`);
  }
});

test("3.77 links going the same way share one road, a step wider where it carries more, and no road passes another territory's settlement", () => {
  const { roads } = library;
  assert.ok(roads.segments.some((s) => s.links.includes("arrive:0->a") && s.links.includes("arrive:0->b")), "the two arrivals at one dock come in on one trunk");
  const widths = [...new Set(roads.segments.map((s) => s.links.length))].sort((x, y) => x - y).map((n) => roads.segments.find((s) => s.links.length === n)!.width);
  widths.slice(1).forEach((w, i) => assert.ok(w > widths[i]!, "a road carrying more links is wider"));
  for (const s of roads.segments) for (const [id, town] of roads.towns) {
    if (s.links.some((k) => k.split("->").includes(id))) continue;
    s.pts.forEach((p) => assert.ok(far(p, town) > 1.5, `no road for ${s.links.join(",")} through ${id}'s settlement`));
  }
});

test("3.77 a gate stands wherever a road crosses a border, its opening wider than the road, and each link enters the territory it calls by an entrance gate", () => {
  const { map, roads } = library;
  const borders = map.borders.map((b) => [b.from, b.to] as const);
  const crossings = roads.segments.flatMap((s) => s.pts.slice(1).flatMap((p, i) => {
    const a = s.pts[i]!, out: Point[] = [];
    for (const [c, d] of borders) {
      const r = { x: p.x - a.x, z: p.z - a.z }, e = { x: d.x - c.x, z: d.z - c.z }, den = r.x * e.z - r.z * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * e.z - (c.z - a.z) * e.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ x: a.x + t * r.x, z: a.z + t * r.z });
    }
    return out;
  }));
  assert.ok(crossings.length > 0);
  for (const x of crossings) assert.ok(roads.gates.some((g) => far(g.at, x) < 0.3), "a gate at every crossing");
  for (const g of roads.gates) {
    assert.ok(borders.some(([a, b]) => toSegment(g.at, a, b) < 1e-6), "on a border");
    const carried = Math.max(...roads.segments.filter((s) => s.links.join() === g.links.join()).map((s) => s.width));
    assert.ok(g.opening > carried + 1.9, "its opening clears the road, posts and all");
  }
  const entrances = roads.gates.filter((g) => g.entrance);
  assert.ok(["arrive:0->a", "arrive:0->b", "d->a", "e->d", "e->b"].every((key) => entrances.some((g) => g.links.includes(key))), "each link has its entrance");
});

test("3.77 a small island's roads are routed at The library's size and drawn at its own, widths and gates scaled with it", () => {
  const small = laid(LIBRARY_RADIUS / 2);
  assert.ok(small.roads.segments.length > 0);
  const lib = Math.min(...library.roads.segments.map((s) => s.width)), mine = Math.min(...small.roads.segments.map((s) => s.width));
  assert.ok(Math.abs(mine - lib / 2) < 0.02, "half the size, half as wide");
  assert.ok(Math.abs(Math.min(...small.roads.gates.map((g) => g.opening)) - Math.min(...library.roads.gates.map((g) => g.opening)) / 2) < 0.02);
  assert.ok(small.roads.segments.every((s) => s.pts.every((p) => Math.hypot(p.x, p.z) <= LIBRARY_RADIUS / 2 + 1e-6)), "on its own land");
});

test("3.77 each settlement stands in its own territory beside its name, clear of every name on the island", () => {
  const { map, roads } = library, plates = names(map);
  assert.ok(roads.towns.size > 0);
  for (const [id, town] of roads.towns) {
    const own = plates.find((p) => p.capability === id)!, at = map.territories.findIndex((t) => t.capability === id);
    const cell = map.cells.reduce((b, c) => (far(c.site, town) < far(b.site, town) ? c : b));
    assert.equal(cell.territory, at, `${id}'s settlement on its own land`);
    assert.ok(far(town, own) < 40, `${id}'s settlement beside its name`);
    for (const name of plates) {
      const w = (name.title.length * 6.5 + 12) / 2.6, h = 7;
      assert.ok(Math.abs(town.x - name.x) > w / 2 || Math.abs(town.z - name.z) > h / 2, `${id}'s settlement off ${name.capability}'s name`);
    }
  }
});

/** The roads that meet at each settlement: every link's way that ends there. */
const meeting = (roads: IslandRoads) => {
  const per = new Map<string, number>();
  for (const key of new Set(roads.segments.flatMap((s) => s.links))) {
    for (const end of key.split("->").filter((e) => !e.includes(":"))) per.set(end, (per.get(end) ?? 0) + 1);
  }
  return per;
};

test("3.79 each settlement's symbol is 3.4, 4.0 or 4.7 across by the roads meeting there (1-2, 3-5, 6 or more), at the island's own size", () => {
  // And b and c calling on a too, so a meets four roads: its arrival, d's, b's and c's.
  const busier = [...links, { from: "b", to: "a" }, { from: "c", to: "a" }];
  for (const [{ roads }, S] of [[laid(LIBRARY_RADIUS, busier), 1], [laid(LIBRARY_RADIUS / 2, busier), 0.5]] as const) {
    assert.deepEqual([...roads.settlements.keys()].sort(), [...roads.towns.keys()].sort(), "one settlement per town");
    const per = meeting(roads);
    for (const [id, s] of roads.settlements) {
      assert.equal(s.roads, per.get(id), `${id}'s roads`);
      assert.ok(far(s.at, roads.towns.get(id)!) < 1e-9, "at its town");
      const across = s.roads >= 6 ? 4.7 : s.roads >= 3 ? 4.0 : 3.4;
      assert.ok(Math.abs(s.size - across * S) < 0.01, `${id} is ${across} across at The library's size`);
    }
    assert.ok(new Set([...roads.settlements.values()].map((s) => s.size)).size > 1, "graded");
  }
});

test("3.79 each settlement's whole symbol stands clear of every name and every border, so of every gate", () => {
  for (const radius of [LIBRARY_RADIUS, LIBRARY_RADIUS / 2]) {
    const { map, roads } = laid(radius), S = radius / LIBRARY_RADIUS;
    for (const [id, { at, size }] of roads.settlements) {
      const half = size / 2;
      const inside = (p: Point) => Math.abs(p.x - at.x) <= half && Math.abs(p.z - at.z) <= half;
      for (const name of names(map)) {
        // A name's box at The library's size, padded by the mock's 4 pixels (2.6 to a ground unit).
        const w = ((name.title.length * 6.5 + 12) / 2.6 + 8 / 2.6) * S, h = (7 + 8 / 2.6) * S;
        assert.ok(Math.abs(at.x - name.x) > w / 2 + half || Math.abs(at.z - name.z) > h / 2 + half, `${id}'s symbol off ${name.capability}'s name`);
      }
      for (const b of map.borders) for (let k = 0; k <= 40; k++) {
        const p = { x: b.from.x + (b.to.x - b.from.x) * k / 40, z: b.from.z + (b.to.z - b.from.z) * k / 40 };
        if (Math.hypot(p.x, p.z) < radius) assert.ok(!inside(p), `no border under ${id}'s symbol`);
      }
      for (const g of roads.gates) assert.ok(!inside(g.at), `no gate under ${id}'s symbol`);
    }
  }
});
