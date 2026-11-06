/**
 * Capability 3 · Story node render (the forest story): the selected island's links as one shared road network with
 * gates (ADR-1236 D1, rollout 2 step 3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";
import { answerRoads, islandRoads, ROUTING_AT_ONCE, islandRoadsWhenRouted, knownIslandRoads, pageIslandRouter, routeIslandInWorker, subscribeRoads, type IslandRoads, type RoadsAsk, type RoadsWorker } from "./island-roads.js";
import { answerAsk } from "./search-worker.js";
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

// Six capabilities where the arrival to a must cross a third territory, and c's road to a leaves c to join e's.
const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "e", to: "a" }, { from: "c", to: "f" }, { from: "f", to: "b" }, { from: "c", to: "a" }];
const sixDocks = [{ local: { x: LIBRARY_RADIUS, z: 0 }, links: ["z1->a", "z2->b"] }];
const sixMap = linkLayout(sixShares, round(LIBRARY_RADIUS), sixLinks, sixDocks), six = islandRoads(sixMap, sixLinks, sixDocks, names(sixMap));

test("3.77 a road that must cross a third territory goes under it (ADR-1253 D3): a portal where it meets that territory's border at each end, no road or gate drawn over it", () => {
  const ends = (key: string) => key.split("->").map((e) => (e.includes(":") ? "sea" : e));
  const third = (t: string, keys: readonly string[]) => t !== "open" && keys.every((k) => !ends(k).includes(t));
  assert.ok(six.portals.length >= 2, "the island has a tunnel");
  const beneath = (p: { at: Point; into: Point }) => ownerAt(sixMap, { x: p.at.x + p.into.x * 0.6, z: p.at.z + p.into.z * 0.6 });
  for (const p of six.portals) {
    assert.ok(sixMap.borders.some((b) => toSegment(p.at, b.from, b.to) < 1e-6), "on a border");
    assert.ok(third(beneath(p), p.links), `${p.links.join(",")} goes under ${beneath(p)}, which it neither starts nor ends in`);
    assert.ok(six.segments.some((s) => s.links.join() === p.links.join() && [s.pts[0]!, s.pts.at(-1)!].some((q) => far(q, p.at) < 1e-6)), "its road drawn up to it");
    // Its tunnel's other end: a portal for the same links under land they do not call.
    assert.ok(six.portals.some((q) => q !== p && q.links.join() === p.links.join() && third(beneath(q), q.links)), "a portal at each end");
    for (const s of six.segments) if (s.links.every((k) => p.links.includes(k))) s.pts.slice(1).forEach((q, i) => {
      assert.notEqual(ownerAt(sixMap, { x: (q.x + s.pts[i]!.x) / 2, z: (q.z + s.pts[i]!.z) / 2 }), beneath(p), `no road for ${s.links.join(",")} drawn over ${beneath(p)}`);
    });
  }
  for (const g of six.gates) for (const key of g.entrances) assert.ok(!six.portals.some((p) => p.links.includes(key) && far(p.at, g.at) < 0.3 && third(ownerAt(sixMap, { x: g.at.x - p.into.x * 0.6, z: g.at.z - p.into.z * 0.6 }), [key])), "no gate on the land a tunnel passes under");
  assert.deepEqual(six.gates.flatMap((g) => g.entrances).sort(), ["arrive:0->a", "arrive:0->b", "c->a", "c->f", "e->a", "f->b"], "still one gate per link");
});

test("3.77 a road leaves the capability that depends with no gate, and its one gate is where it enters the capability depended on (ADR-1253 D3)", () => {
  const sides = (g: { at: Point; along: Point }) => [-0.6, 0.6].map((k) => ownerAt(sixMap, { x: g.at.x - g.along.z * k, z: g.at.z + g.along.x * k }));
  assert.ok(six.passes.some((p) => p.links.includes("c->a") && sides(p).includes("c")), "c's road to a leaves c with no gate");
  assert.ok(sides(six.gates.find((g) => g.entrances.includes("c->a"))!).includes("a"), "and enters a by its gate");
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
