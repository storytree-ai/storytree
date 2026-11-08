/**
 * Capability 3 · Story node render (the forest story): the selected island's links as one shared road network with
 * gates (ADR-1236 D1, rollout 2 step 3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";
import { answerRoads, GATE_POSTS_APART, inTunnelMouth, islandRoads, ROUTING_AT_ONCE, islandRoadsWhenRouted, knownIslandRoads, pageIslandRouter, routeIslandInWorker, subscribeRoads, type IslandRoads, type RoadsAsk, type RoadsWorker } from "./island-roads.js";
import { answerAsk } from "./search-worker.js";
import { RELIEF } from "./island-relief.js";
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
/** Every link the island's roads should carry: each one at home, and each dock's arrival or way out per capability. */
const LINKS = ["d->a", "e->d", "e->b", "arrive:0->a", "arrive:0->b", "c->leave:1"];
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

/** Where each road drawn crosses a border of `map`. */
const borderCrossings = (map: TerritoryMap, roads: IslandRoads) => {
  const borders = map.borders.map((b) => [b.from, b.to] as const);
  return roads.segments.flatMap((s) => s.pts.slice(1).flatMap((p, i) => {
    const a = s.pts[i]!, out: Point[] = [];
    for (const [c, d] of borders) {
      const r = { x: p.x - a.x, z: p.z - a.z }, e = { x: d.x - c.x, z: d.z - c.z }, den = r.x * e.z - r.z * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * e.z - (c.z - a.z) * e.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ x: a.x + t * r.x, z: a.z + t * r.z });
    }
    return out;
  }));
};
/** The capability under a point of `map`, by its nearest cell ("open" on open land). */
const ownerAt = (map: TerritoryMap, p: Point) => {
  const cell = map.cells.reduce((b, c) => (far(c.site, p) < far(b.site, p) ? c : b));
  return cell.territory < 0 ? "open" : map.territories[cell.territory]!.capability!;
};

test("3.77 one gate per linked pair and none elsewhere (ADR-1253 D3): where the road enters the capability depended on, its opening wider than the road; any other crossing is open road", () => {
  const { map, roads } = library;
  assert.deepEqual(roads.gates.flatMap((g) => g.entrances).sort(), [...LINKS].sort(), "each link has exactly one gate, and every gate is one link's or a few links' whose gates stand together");
  assert.ok(roads.gates.every((g) => g.entrances.length > 0), "no gate that is no link's");
  const n = { x: 0, z: 0 }, sides = (g: { at: Point; along: Point }) => { n.x = -g.along.z; n.z = g.along.x; return [ownerAt(map, { x: g.at.x + n.x * 0.6, z: g.at.z + n.z * 0.6 }), ownerAt(map, { x: g.at.x - n.x * 0.6, z: g.at.z - n.z * 0.6 })]; };
  for (const g of roads.gates) {
    assert.ok(map.borders.some((b) => toSegment(g.at, b.from, b.to) < 1e-6), "on a border");
    for (const key of g.entrances) {
      const [from, to] = key.split("->") as [string, string], own = to.startsWith("leave:") ? from : to;
      assert.ok(sides(g).includes(own), `${key}'s gate on a border of ${own}`);
    }
    const carried = Math.max(...roads.segments.filter((s) => s.links.join() === g.links.join()).map((s) => s.width));
    assert.ok(g.opening > carried + 1.9, "its opening clears the road, posts and all");
  }
  const crossings = borderCrossings(map, roads);
  for (const x of crossings) assert.ok([...roads.gates, ...roads.passes, ...roads.portals].some((g) => far(g.at, x) < 0.3), "every crossing a gate, open road or a tunnel's portal");
  for (const p of roads.passes) assert.ok(!roads.gates.some((g) => far(g.at, p.at) < 0.3), "open road is no gate");
});

// Six capabilities where f's road to c must cross a third territory, and leaves f with no gate.
const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "e", to: "c" }, { from: "d", to: "b" }, { from: "c", to: "b" }, { from: "c", to: "a" },
  { from: "f", to: "a" }, { from: "f", to: "c" }, { from: "b", to: "e" }];
const sixDocks = [{ local: { x: LIBRARY_RADIUS, z: 0 }, links: ["z1->a", "z2->b"] }];
const sixMap = linkLayout(sixShares, round(LIBRARY_RADIUS), sixLinks, sixDocks), six = islandRoads(sixMap, sixLinks, sixDocks, names(sixMap));

test("3.77 a road that must cross a third territory goes under it (ADR-1253 D3): its mouths set back from the border on the land of the territories its links run between, not the land it passes under, and no road or gate drawn between (Mick, 2026-11-07)", () => {
  const ends = (key: string) => key.split("->").map((e) => (e.includes(":") ? "sea" : e));
  const third = (t: string, keys: readonly string[]) => t !== "open" && keys.every((k) => !ends(k).includes(t));
  assert.ok(six.portals.length >= 2 && six.tunnels.length > 0, "the island has a tunnel");
  // The land across the border from its mouth: where its road goes under, or, for a mouth set back on the land passed
  // under because open land lies on its road's side, that open land.
  const across = (p: { at: Point; border: Point }) => { const d = far(p.at, p.border); return ownerAt(sixMap, { x: p.border.x + (p.border.x - p.at.x) / d * 0.6, z: p.border.z + (p.border.z - p.at.z) / d * 0.6 }); };
  for (const p of six.portals) {
    assert.ok(sixMap.borders.some((b) => toSegment(p.border, b.from, b.to) < 1e-6), "where its road meets the border");
    assert.ok(far(p.at, p.border) >= 1 && far(p.at, p.border) <= 3.6, "its mouth set back a short way from the border, not standing on it as a gate does");
    const side = ownerAt(sixMap, p.at);
    if (third(side, p.links)) assert.equal(across(p), "open", `${p.links.join(",")}'s mouth on ${side}, which it neither starts nor ends in, though its road's side is no open land`);
    else assert.ok(third(across(p), p.links), `${p.links.join(",")}'s mouth on ${side}, its road going under ${across(p)}`);
    assert.ok(six.segments.some((s) => s.links.join() === p.links.join() && [s.pts[0]!, s.pts.at(-1)!].some((q) => far(q, p.at) < 1e-6)), "its road drawn up to it");
    assert.ok([...six.gates, ...six.passes].some((g) => far(g.at, p.border) < 1e-6), "the border cut open where its road crosses onto that land");
    // Its tunnel's other end: a portal for the same links.
    assert.ok(six.portals.some((q) => q !== p && q.links.join() === p.links.join()), "a portal at each end");
  }
  assert.ok(six.portals.some((p) => !third(ownerAt(sixMap, p.at), p.links)), "a mouth on the land of a territory its road runs between");
  for (const p of six.portals) for (const [id, t] of six.settlements) assert.ok(far(p.at, t.at) > t.size / 2 + p.width / 2, `${p.links.join(",")}'s mouth clear of ${id}'s settlement`);
  for (const t of six.tunnels) {
    assert.ok(t.pts.slice(1).some((b, i) => third(ownerAt(sixMap, { x: (t.pts[i]!.x + b.x) / 2, z: (t.pts[i]!.z + b.z) / 2 }), t.links)), "under land it neither starts nor ends in");
    assert.ok(six.portals.some((p) => far(p.at, t.pts[0]!) < 1e-6 || far(p.at, t.pts.at(-1)!) < 1e-6), "a tunnel's way runs on from a mouth");
    for (let i = 1; i < t.pts.length; i++) {
      const mid = { x: (t.pts[i - 1]!.x + t.pts[i]!.x) / 2, z: (t.pts[i - 1]!.z + t.pts[i]!.z) / 2 };
      if (far(mid, t.pts[0]!) < 0.5 || far(mid, t.pts.at(-1)!) < 0.5) continue;
      for (const s of six.segments) if (s.links.some((k) => t.links.includes(k))) assert.ok(s.pts.every((q) => far(q, mid) > 0.3), `no road for ${s.links.join(",")} drawn over its tunnel`);
    }
  }
  for (const g of six.gates) if (six.tunnels.some((t) => t.pts.some((q) => far(q, g.at) < 0.3))) assert.ok(six.portals.some((p) => far(p.border, g.at) < 1e-6), "no gate on a tunnel's way but where it comes up into the territory it calls, its portal standing for it");
  assert.deepEqual(six.gates.flatMap((g) => g.entrances).sort(), ["arrive:0->a", "arrive:0->b", "b->e", "c->a", "c->b", "d->b", "e->c", "f->a", "f->c"], "still one gate per link");
});

// Eight capabilities where d's land meets the dock's open land, but its neighbour e's lies nearer the dock (Mick, 2026-11-06:
// "why did it need to go into waits").
const eightShares = [488, 525, 216, 207, 563, 351, 636, 617].map((lines, i) => ({ capability: "abcdefgh"[i]!, title: `${i + 1} · ${"ABCDEFGH"[i]}`, lines }));
const eightLinks = [{ from: "d", to: "f" }, { from: "f", to: "d" }, { from: "g", to: "e" }, { from: "b", to: "e" }, { from: "b", to: "e" }, { from: "h", to: "e" },
  { from: "c", to: "f" }, { from: "e", to: "d" }, { from: "b", to: "g" }, { from: "z0", to: "a" }, { from: "z1", to: "d" }, { from: "z2", to: "h" }];
const eightDocks = [{ local: { x: 87.58148475977568, z: 1.530795131118608 }, links: ["z0->a", "z1->d", "z2->h"] }];

test("3.77 an arrival whose capability's land meets the open land comes in from the open land, never under a third territory (Mick, 2026-11-06)", () => {
  const meetsOpen = (map: TerritoryMap, capability: string) => {
    const at = map.territories.findIndex((t) => t.capability === capability);
    return map.borders.some((b) => { const pair = b.between.map((c) => map.cells[c]!.territory); return pair.includes(-1) && pair.includes(at); });
  };
  const eightMap = linkLayout(eightShares, round(LIBRARY_RADIUS), eightLinks, eightDocks), eight = islandRoads(eightMap, eightLinks, eightDocks, names(eightMap));
  assert.ok(meetsOpen(eightMap, "d") && eight.segments.some((s) => s.links.includes("arrive:0->d")), "d's land meets the open land, and its arrival has a road");
  for (const [map, roads] of [[library.map, library.roads], [sixMap, six], [eightMap, eight]] as const) {
    for (const key of new Set(roads.portals.flatMap((p) => p.links))) {
      if (!key.startsWith("arrive:")) continue;
      const to = key.split("->")[1]!;
      assert.ok(!meetsOpen(map, to), `${key} goes under a third territory though ${to}'s land meets the open land`);
    }
  }
});

test("3.77 a road leaves the capability that depends with no gate, and its one gate is where it enters the capability depended on (ADR-1253 D3)", () => {
  const sides = (g: { at: Point; along: Point }) => [-0.6, 0.6].map((k) => ownerAt(sixMap, { x: g.at.x - g.along.z * k, z: g.at.z + g.along.x * k }));
  assert.ok(six.passes.some((p) => p.links.includes("f->c") && sides(p).includes("f")), "f's road to c leaves f with no gate");
  assert.ok(sides(six.gates.find((g) => g.entrances.includes("f->c"))!).includes("c"), "and enters c by its gate");
});

test("3.77 two gates on one island stand apart where their border has room: their posts at least GATE_POSTS_APART apart, never touching (Mick, 2026-11-08)", () => {
  // A gate's posts stand either side of its opening, wider where a ramp climbs to it from the open land (island-roads.ts in view).
  const reach = (g: IslandRoads["gates"][number]) => (g.between.includes("open") ? Math.max(g.opening, RELIEF.ramp.width) : g.opening) / 2 + RELIEF.post.side;
  const eightMap = linkLayout(eightShares, round(LIBRARY_RADIUS), eightLinks, eightDocks);
  const islands = [library.roads, six, islandRoads(eightMap, eightLinks, eightDocks, names(eightMap))];
  let pairs = 0;
  for (const roads of islands) {
    const gates = roads.gates.filter((g) => !inTunnelMouth(roads, g));
    gates.forEach((g, i) => gates.slice(i + 1).forEach((h) => {
      pairs++;
      const gap = far(g.at, h.at) - reach(g) - reach(h);
      assert.ok(gap >= GATE_POSTS_APART, `${g.entrances.join(",")}'s gate and ${h.entrances.join(",")}'s: ${gap.toFixed(2)} between their posts`);
    }));
  }
  assert.ok(pairs > 20, "gates enough to crowd");
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

const fresh = (): RoadsAsk => {
  const coast = round(LIBRARY_RADIUS), map = linkLayout(shares, coast, links, docks(LIBRARY_RADIUS));
  return { map, links, docks: docks(LIBRARY_RADIUS), names: names(map) };
};
const carried = (roads: IslandRoads) => [...new Set(roads.segments.flatMap((s) => s.links))].sort();
/** A router the test answers by hand: the asks it was given, and the answer to give the latest. */
const byHand = () => {
  const asked: RoadsAsk[] = [], answers: { resolve(r: IslandRoads): void; reject(e: Error): void }[] = [];
  const router = (a: RoadsAsk) => { asked.push(a); return new Promise<IslandRoads>((resolve, reject) => { answers.push({ resolve, reject }); }); };
  return { router, asked, answers };
};

test("3.82 selecting an island draws its territories without waiting on its roads: the roads arrive when routed, and are had at once after", async () => {
  const ask = fresh(), { router, asked, answers } = byHand();
  let heard = 0;
  const unsubscribe = subscribeRoads(() => { heard++; });
  try {
    assert.equal(islandRoadsWhenRouted(ask, router, new AbortController().signal), undefined, "nothing is routed on the page while it is drawn");
    assert.deepEqual(asked, [ask], "the router is asked for the island");
    assert.equal(knownIslandRoads(ask), undefined);
    const roads = islandRoads(fresh().map, ask.links, ask.docks, ask.names);
    answers[0]!.resolve(roads);
    await waitUntil(() => heard === 1 || undefined, 2000, "the roads to arrive");
    assert.equal(knownIslandRoads(ask), roads, "the roads are kept for the island when they arrive");
    assert.equal(islandRoadsWhenRouted(ask, router, new AbortController().signal), roads, "the next ask has them at once");
    assert.equal(asked.length, 1, "and routes nothing again");
  } finally { unsubscribe(); }
});

test("3.82 an island overtaken before its roads arrive keeps none, and says nothing of a routing that failed; one not overtaken says why", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { router, answers } = byHand();
  const overtaken = new AbortController(), other = fresh();
  islandRoadsWhenRouted(other, router, overtaken.signal);
  overtaken.abort();
  answers[0]!.resolve(islandRoads(fresh().map, other.links, other.docks, other.names));
  const failing = new AbortController(), third = fresh();
  islandRoadsWhenRouted(third, router, failing.signal);
  failing.abort();
  answers[1]!.reject(new Error("overtaken routing failed"));
  const fourth = fresh();
  islandRoadsWhenRouted(fourth, router, new AbortController().signal);
  answers[2]!.reject(new Error("no coast"));
  await waitUntil(() => logged.mock.callCount() > 0 || undefined, 2000, "the failure to be logged");
  assert.equal(knownIslandRoads(other), undefined, "an overtaken island keeps no roads");
  assert.deepEqual(logged.mock.calls.map((c) => (c.arguments[1] as Error).message), ["no coast"], "only the failure of an island still shown is logged");
});

test("3.82 every island's roads route a few at a time: the rest wait their turn, and an island let go while it waits is never routed", async () => {
  const { router, asked, answers } = byHand();
  const islands = Array.from({ length: ROUTING_AT_ONCE + 2 }, () => ({ ask: fresh(), shown: new AbortController() }));
  for (const { ask, shown } of islands) islandRoadsWhenRouted(ask, router, shown.signal);
  assert.equal(asked.length, ROUTING_AT_ONCE, `${ROUTING_AT_ONCE} islands route at once`);
  islands[ROUTING_AT_ONCE]!.shown.abort();
  answers[0]!.resolve(islandRoads(fresh().map, islands[0]!.ask.links, islands[0]!.ask.docks, islands[0]!.ask.names));
  await waitUntil(() => asked.length === ROUTING_AT_ONCE + 1 || undefined, 2000, "the next island waiting to route");
  assert.equal(asked.at(-1), islands[ROUTING_AT_ONCE + 1]!.ask, "the island let go is passed over");
  islands[1]!.shown.abort();
  answers[1]!.reject(new Error("overtaken"));
  answers[2]!.resolve(islandRoads(fresh().map, islands[3]!.ask.links, islands[3]!.ask.docks, islands[3]!.ask.names));
  await quietFor(() => asked.length > ROUTING_AT_ONCE + 1, 100, "an island let go routed");
});

test("3.82 the territory worker routes the island's roads it is asked for, every link on a road, in a form it can post; a search it is asked is searched", () => {
  const ask = fresh(), answered = answerAsk({ roads: ask });
  assert.ok("roads" in answered, "it answers roads");
  assert.deepEqual(carried(answered.roads), [...LINKS].sort(), "every link the island has is on a road");
  assert.deepEqual(structuredClone(answered), answered, "the answer survives the post back to the page");
  const failed = answerAsk({ roads: { ...ask, map: { ...ask.map, cells: null as unknown as TerritoryMap["cells"] } } });
  assert.match("error" in failed ? failed.error : "", /null/, "it says what failed");
  const searched = answerAsk({ shares, coast: round(LIBRARY_RADIUS), links, docks: docks(LIBRARY_RADIUS), steps: 1 });
  assert.ok("found" in searched && searched.found !== undefined && Object.keys(searched.found.seeds).length === shares.length, "a search finds seeds for each territory");
});

test("3.82 the roads route in the territory worker the page names, else on the page; a worker that fails to load leaves them to the page", async () => {
  const started: string[] = [], posted: unknown[] = [];
  const was = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class { constructor(script: string) { started.push(script); } postMessage(m: unknown) { posted.push(m); } terminate() {} };
  const ask = fresh();
  try {
    const router = pageIslandRouter({ querySelector: (q: string) => (q === 'meta[name="storytree-territory-worker"]' ? { getAttribute: () => "territory-worker.js" } : null) } as unknown as Pick<Document, "querySelector">);
    void router(ask, new AbortController().signal);
    assert.deepEqual(started, ["territory-worker.js"], "it starts the script the page names");
    assert.deepEqual(posted, [{ roads: ask }], "and posts it the island");
  } finally { (globalThis as { Worker?: unknown }).Worker = was; }
  const onPage = await pageIslandRouter({ querySelector: () => null })(ask, new AbortController().signal);
  assert.deepEqual(carried(onPage), [...LINKS].sort(), "a page with no worker routes them itself, after a frame");
});

test("3.82 a routing in a worker answers what it posts, fails on the error it posts, ends it when overtaken, and falls back to the page when it fails to load", async () => {
  const ask = fresh(), roads = islandRoads(ask.map, ask.links, ask.docks, ask.names);
  const worker = (ended: string[], then: (w: RoadsWorker) => void): RoadsWorker => {
    const w: RoadsWorker = { postMessage() { queueMicrotask(() => then(w)); }, terminate() { ended.push("ended"); }, onmessage: null, onerror: null };
    return w;
  };
  const answeredEnds: string[] = [];
  assert.equal(await routeIslandInWorker(() => worker(answeredEnds, (w) => w.onmessage?.({ data: { roads } })))(ask, new AbortController().signal), roads);
  assert.deepEqual(answeredEnds, ["ended"], "a worker that answers is ended");
  const failedEnds: string[] = [];
  await assert.rejects(routeIslandInWorker(() => worker(failedEnds, (w) => w.onmessage?.({ data: { error: "no coast" } })))(ask, new AbortController().signal), /no coast/);
  assert.deepEqual(failedEnds, ["ended"], "a worker that fails is ended");
  const overtakenEnds: string[] = [], overtaken = new AbortController(), running = routeIslandInWorker(() => worker(overtakenEnds, () => {}))(ask, overtaken.signal);
  overtaken.abort(new Error("overtaken"));
  await assert.rejects(running, /overtaken/);
  assert.deepEqual(overtakenEnds, ["ended"], "an overtaken worker is ended");
  const unloaded: string[] = [], fallback = async () => roads;
  assert.equal(await routeIslandInWorker(() => worker(unloaded, (w) => w.onerror?.({})), fallback)(ask, new AbortController().signal), roads, "a worker that fails to load leaves the routing to the page");
  assert.deepEqual(unloaded, ["ended"]);
  assert.equal(await routeIslandInWorker(() => { throw new Error("no workers here"); }, fallback)(ask, new AbortController().signal), roads, "so does one that cannot start");
});
