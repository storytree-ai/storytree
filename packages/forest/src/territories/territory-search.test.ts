/**
 * Capability 3 · Story node render (the forest story): the selected island's territories arranged by the mock's
 * network-scored search, run off the page, and the arrangement it finds kept so the island does not reshuffle (3.80,
 * ADR-1236 D1, rollout 2 step 2b).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";
import { borderLength, islandLayout, LIBRARY_LAND, linkLayout, prepareIsland, type Seeds } from "./link-layout.js";
import { keepArrangement, keptArrangement, pageTerritorySearcher, searchInWorker, searchIsland, shelveOn, storageShelf, structureKey, type SearchAnswer, type SearchAsk, type SearchWorker, type TerritorySearcher } from "./kept-layout.js";
import { networkScore, searchTerritories } from "./territory-search.js";
import { islandRoads, roadMeasures } from "./island-roads.js";
import { answerSearch } from "./search-worker.js";
import { capabilityPlates } from "../view/nameplates.js";
import { landArea, territoryAt, type Coast, type TerritoryMap } from "./territories.js";

// An island of The library's size, so its scale is 1 and kept seeds are in its own units.
const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", lines: 900 }, { capability: "b", lines: 700 }, { capability: "c", lines: 500 }, { capability: "d", lines: 300 }, { lines: 150 }];
// a and b take lanes over the sea; c and d link only at home, d to a far across the island.
const links = [{ from: "z1", to: "a" }, { from: "b", to: "y" }, { from: "c", to: "a" }, { from: "d", to: "c" }, { from: "d", to: "a" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a"] }, { local: { x: -R, z: 0 }, links: ["b->y"] }];
const ask: SearchAsk = { shares, coast, links, docks, steps: 4 };
const owners = (map: TerritoryMap) => map.cells.map((cell) => cell.territory);
/** Whether every territory of `map` holds the land at its seed. */
const grownFrom = (map: TerritoryMap, seeds: Seeds) => Object.entries(seeds).every(([id, at]) => (territoryAt(map, at.x, at.z)?.capability ?? "") === id);

afterEach(() => shelveOn(undefined));

test("3.80 the search starts from the arrangement the page draws, answers a better one by the network routed over it, and its seeds draw it again", { timeout: 120_000 }, () => {
  const start = searchTerritories({ ...ask, steps: 0 })!;
  assert.deepEqual(owners(linkLayout(shares, coast, links, docks, start.seeds)), owners(linkLayout(shares, coast, links, docks)), "with no steps it answers what the page draws");
  assert.equal(start.score, start.start);
  const found = searchTerritories({ ...ask, steps: 30 });
  assert.ok(found, "an arrangement grows and routes");
  assert.equal(found.start, start.score, "it starts from the same arrangement");
  assert.ok(found.score < found.start, `${found.score} betters the start's ${found.start}`);
  assert.deepEqual(Object.keys(found.seeds).sort(), ["", "a", "b", "c", "d"], "a seed for every territory, the Unclaimed code's included");
  const drawn = linkLayout(shares, coast, links, docks, found.seeds);
  assert.ok(grownFrom(drawn, found.seeds), "grown from the kept seeds, each territory holds its seed");
  assert.notDeepEqual(owners(drawn), owners(linkLayout(shares, coast, links, docks)), "and the island is not the start");
});

test("3.80 an island with nothing to arrange answers no search", () => {
  assert.equal(searchTerritories({ ...ask, shares: [{ capability: "a", lines: 10 }] }), undefined);
});

test("3.80 the network's measures: an inside link through a third territory and the borders it crosses, the inside links between neighbours, and the road drawn", () => {
  // A long thin island cut into three strips, west to east a, b and c: a link from a to c must cross b.
  const strip: Coast = [[{ x: -200, z: -18 }, { x: 200, z: -18 }, { x: 200, z: 18 }, { x: -200, z: 18 }]];
  const S = Math.sqrt(landArea(strip) / LIBRARY_LAND), thirds = [{ capability: "a", lines: 100 }, { capability: "b", lines: 100 }, { capability: "c", lines: 100 }];
  const seeds = { a: { x: -150 / S, z: 0 }, b: { x: 0, z: 0 }, c: { x: 150 / S, z: 0 } };
  const across = [{ from: "a", to: "c" }], beside = [{ from: "a", to: "b" }];
  const map = linkLayout(thirds, strip, [...across, ...beside], [], seeds), names = capabilityPlates(map);
  assert.deepEqual(["a", "b", "c"].map((id) => territoryAt(map, seeds[id as "a"].x * S, 0)?.capability), ["a", "b", "c"], "three strips, west to east");
  const m = roadMeasures(map, across, [], names);
  assert.deepEqual([m.overThird, m.overThirdBorders, m.neighbours, m.unrouted, m.tunnels], [1, 2, 0, 0, 1], "a to c goes through b, over two borders, in a tunnel");
  const next = roadMeasures(map, beside, [], names);
  assert.deepEqual([next.overThird, next.overThirdBorders, next.neighbours, next.tunnels], [0, 0, 1, 0], "a to b, its neighbour, crosses no third territory");
  // The road from a's settlement to c's is at least as long as the straight line between them.
  const towns = islandRoads(map, across, [], names).towns, a = towns.get("a")!, c = towns.get("c")!;
  assert.ok(m.roadDrawn * S >= Math.hypot(a.x - c.x, a.z - c.z), "the road drawn reaches from a to c");
  assert.equal(roadMeasures(map, [], [], names).roadDrawn, 0, "no links, no road");
});

test("3.80 an interface off the coast costs the arrangement 500, and a link no road reaches refuses it", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const held = owners(linkLayout(shares, coast, links, docks));
  const none = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0, tunnels: 0 };
  const borders = 0.2 * borderLength(island, held);
  assert.equal(networkScore(island, held, { overThird: 1, overThirdBorders: 2, roadDrawn: 100, neighbours: 1, unrouted: 0, tunnels: 1 }), 100 + 10 + 6 + 5 + borders - 4);
  const inland = held.map((o, c) => (o === 0 && island.frontier[c] ? -1 : o));
  assert.equal(networkScore(island, inland, none), 500 + 0.2 * borderLength(island, inland), "a, whose lane lands, holds no frontier cell");
  assert.equal(networkScore(island, held, { ...none, unrouted: 1 }), undefined);
});

test("3.80 a tunnel is a last resort: one road under a third territory costs the arrangement more than a thousand units more road round it", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const held = owners(linkLayout(shares, coast, links, docks));
  const none = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0, tunnels: 0 };
  const under = networkScore(island, held, { ...none, overThird: 1, overThirdBorders: 2, roadDrawn: 100, tunnels: 1 })!;
  const round = networkScore(island, held, { ...none, roadDrawn: 1100 })!;
  assert.ok(round < under, `the way round, ${round}, betters the tunnel, ${under}`);
});

test("3.80 a territory reaching into its neighbours' land costs the arrangement its longer borders, so the search grows territories outward", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const held = owners(linkLayout(shares, coast, links, docks));
  const m = { overThird: 0, overThirdBorders: 0, roadDrawn: 150, neighbours: 2, unrouted: 0, tunnels: 0 };
  // a and b each give three of their inmost cells to the other: the same land each, reaching into the other's.
  const inmost = (t: number) => held.map((o, c) => c).filter((c) => held[c] === t && island.fine.cells[c]!.neighbours.every((n) => held[n] === t)).slice(0, 3);
  const reaching = [...held];
  for (const c of inmost(0)) reaching[c] = 1;
  for (const c of inmost(1)) reaching[c] = 0;
  assert.equal(inmost(0).length + inmost(1).length, 6);
  assert.ok(borderLength(island, reaching) > borderLength(island, held), "more border between them");
  assert.ok(networkScore(island, reaching, m)! > networkScore(island, held, m)!, "the compact arrangement scores better on the same network");
});

test("3.80 a kept arrangement for the island's structure draws from its seeds and asks no search; a change of structure asks one, seeded from what is drawn, and keeps what it finds", async () => {
  shelveOn(undefined);
  const asked: SearchAsk[] = [];
  let answer: (a: SearchAnswer) => void = () => {};
  const searcher: TerritorySearcher = (given) => { asked.push(given); return new Promise((resolve) => { answer = resolve; }); };
  const seeds = { a: { x: 60, z: 10 }, b: { x: -60, z: -10 }, c: { x: 0, z: 50 }, d: { x: 0, z: -50 }, "": { x: 20, z: 20 } };
  keepArrangement("s", { key: structureKey(shares, links, docks), seeds });
  searchIsland("s", ask, searcher);
  assert.equal(asked.length, 0, "the structure the arrangement was kept for asks no search");
  assert.ok(grownFrom(islandLayout("s", shares, coast, links, docks), seeds), "drawn from the kept seeds");
  assert.ok(!grownFrom(islandLayout("other", shares, coast, links, docks), seeds), "an island with nothing kept draws the start");
  // More lines are no change of structure.
  searchIsland("s", { ...ask, shares: shares.map((s) => ({ ...s, lines: s.lines * 2 })) }, searcher);
  assert.equal(asked.length, 0, "a change of lines only resizes");
  const more = [...links, { from: "c", to: "b" }];
  searchIsland("s", { ...ask, links: more }, searcher);
  searchIsland("s", { ...ask, links: more }, searcher);
  assert.equal(asked.length, 1, "a new link asks one search, and asking again while it runs asks no other");
  assert.deepEqual(asked[0]!.kept, seeds, "seeded from the kept seeds the island is drawn from");
  const found = { a: { x: 1, z: 2 }, b: { x: 3, z: 4 }, c: { x: 5, z: 6 }, d: { x: 7, z: 8 }, "": { x: 9, z: 9 } };
  answer({ found: { seeds: found, score: 1, start: 2 } });
  const now = await waitUntil(() => { const k = keptArrangement("s"); return k?.seeds === found ? k : undefined; }, 2000, "the arrangement found kept");
  assert.equal(now.key, structureKey(shares, more, docks), "kept under the new structure");
});

test("3.80 an arrangement kept before the search's score changed is searched again, once, for the island's structure", () => {
  shelveOn(undefined);
  const asked: SearchAsk[] = [];
  const searcher: TerritorySearcher = (given) => { asked.push(given); return new Promise(() => {}); };
  // The key an arrangement was kept under before the score counted tunnels as a last resort: the structure alone.
  const before = JSON.stringify([["", "a", "b", "c", "d"], ["c->a", "d->a", "d->c"], [["b->y"], ["z1->a"]]]);
  const seeds = { a: { x: 60, z: 10 }, b: { x: -60, z: -10 }, c: { x: 0, z: 50 }, d: { x: 0, z: -50 }, "": { x: 20, z: 20 } };
  keepArrangement("s", { key: before, seeds });
  searchIsland("s", ask, searcher);
  assert.equal(asked.length, 1, "searched again with today's score");
  assert.deepEqual(asked[0]!.kept, seeds, "from the arrangement it draws");
  searchIsland("s", ask, searcher);
  assert.equal(asked.length, 1, "and asked again while it runs, no other");
  assert.notEqual(structureKey(shares, links, docks), before);
});

test("3.80 a search asked for another island waits its turn behind the one in flight, one at a time; a new structure of the island in flight overtakes it", async () => {
  shelveOn(undefined);
  const asked: { links: number; signal: AbortSignal; answer: (a: SearchAnswer) => void }[] = [];
  const searcher: TerritorySearcher = (given, signal) => new Promise((answer) => asked.push({ links: given.links.length, signal, answer }));
  const found = (x: number) => ({ found: { seeds: { a: { x, z: 0 } }, score: 0, start: 0 } });
  searchIsland("one", ask, searcher);
  searchIsland("two", ask, searcher);
  searchIsland("three", ask, searcher);
  assert.equal(asked.length, 1, "one search at a time");
  assert.equal(asked[0]!.signal.aborted, false, "the island in flight is not overtaken by another island");
  asked[0]!.answer(found(1));
  await waitUntil(() => asked.length === 2, 2000, "the next island's search to start once the first answers");
  assert.equal(keptArrangement("one")?.seeds.a?.x, 1, "the first island keeps what it found");
  // "two" is in flight: a new structure for it overtakes it, and is searched in its place, ahead of "three".
  const more = [...links, { from: "c", to: "b" }];
  searchIsland("two", { ...ask, links: more }, searcher);
  assert.equal(asked[1]!.signal.aborted, true, "the old structure's search is overtaken");
  await waitUntil(() => asked.length === 3, 2000, "the new structure searched");
  assert.equal(asked[2]!.links, more.length, "searched for the new structure");
  asked[1]!.answer(found(2));
  asked[2]!.answer(found(3));
  await waitUntil(() => asked.length === 4, 2000, "the island waiting its turn searched last");
  assert.equal(keptArrangement("two")?.seeds.a?.x, 3, "the overtaken search's answer is not kept");
  assert.equal(keptArrangement("two")?.key, structureKey(shares, more, docks));
  asked[3]!.answer(found(4));
  await waitUntil(() => keptArrangement("three")?.seeds.a?.x === 4, 2000, "the last island kept");
});

test("3.80 an island kept for its structure while it waits its turn is passed over, and the island behind it is searched; a new shelf ends the search in flight and forgets those waiting", async () => {
  shelveOn(undefined);
  const asked: { story: string; signal: AbortSignal; answer: (a: SearchAnswer) => void }[] = [];
  const searcher = (story: string): TerritorySearcher => (_, signal) => new Promise((answer) => asked.push({ story, signal, answer }));
  for (const story of ["one", "two", "three"]) searchIsland(story, ask, searcher(story));
  keepArrangement("two", { key: structureKey(shares, links, docks), seeds: { a: { x: 2, z: 0 } } });
  asked[0]!.answer({ found: undefined });
  await waitUntil(() => asked.length === 2, 2000, "the island behind the one kept meanwhile searched");
  assert.equal(asked[1]!.story, "three", "the island kept while it waited is passed over");
  searchIsland("four", ask, searcher("four"));
  shelveOn(undefined);
  assert.equal(asked[1]!.signal.aborted, true, "a new shelf ends the search in flight");
  asked[1]!.answer({ found: undefined });
  await quietFor(() => asked.length > 2, 200, "an island forgotten with the old shelf searched");
});

test("3.80 a kept arrangement outlives the run, on the page's storage; storage it cannot read keeps nothing, storage that refuses a write keeps it for the run, and a page that refuses its storage keeps none", () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  shelveOn(storageShelf(storage));
  keepArrangement("s", { key: "k", seeds: { a: { x: 1, z: 2 } } });
  shelveOn(storageShelf(storage));
  assert.deepEqual(keptArrangement("s"), { key: "k", seeds: { a: { x: 1, z: 2 } } });
  stored.set("storytree.territories.bad", "{not json");
  stored.set("storytree.territories.odd", JSON.stringify({ seeds: {} }));
  assert.equal(keptArrangement("bad"), undefined);
  assert.equal(keptArrangement("odd"), undefined, "an entry with no structure key is none");
  shelveOn(storageShelf({ getItem: () => null, setItem: () => { throw new Error("full"); } }));
  keepArrangement("s", { key: "k2", seeds: {} });
  assert.equal(keptArrangement("s")?.key, "k2");
  assert.equal(storageShelf(undefined), undefined, "no storage, no shelf");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Access is denied for this document"); } });
  try { assert.equal(storageShelf(), undefined, "a page that refuses its storage has no shelf, and still draws"); } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test("3.80 the search runs only in the worker the page names: with none the page searches nothing", () => {
  assert.equal(pageTerritorySearcher({ querySelector: () => null }), undefined);
  assert.equal(pageTerritorySearcher(undefined), undefined);
  const started: string[] = [];
  const was = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class { constructor(script: string) { started.push(script); } postMessage() {} terminate() {} };
  try {
    const searcher = pageTerritorySearcher({ querySelector: (q: string) => (q === 'meta[name="storytree-territory-worker"]' ? { getAttribute: () => "territory-worker.js" } : null) } as unknown as Pick<Document, "querySelector">);
    void searcher!(ask, new AbortController().signal);
    assert.deepEqual(started, ["territory-worker.js"], "it starts the script the page names");
  } finally { (globalThis as { Worker?: unknown }).Worker = was; }
});

test("3.80 a search in a worker answers what the worker posts, ends it when overtaken, and answers an error when it fails to load", async () => {
  const ended: string[] = [];
  const worker = (then: (w: SearchWorker) => void): SearchWorker => {
    const w: SearchWorker = { postMessage() { queueMicrotask(() => then(w)); }, terminate() { ended.push("ended"); }, onmessage: null, onerror: null };
    return w;
  };
  const seeds = { a: { x: 1, z: 1 } };
  const answered = await searchInWorker(() => worker((w) => w.onmessage?.({ data: { found: { seeds, score: 1, start: 2 } } })))(ask, new AbortController().signal);
  assert.deepEqual(answered, { found: { seeds, score: 1, start: 2 } });
  assert.equal(ended.length, 1, "the worker is ended once it answers");
  const overtaken = new AbortController(), running = searchInWorker(() => worker(() => {}))(ask, overtaken.signal);
  overtaken.abort(new Error("overtaken"));
  await assert.rejects(running, /overtaken/);
  assert.equal(ended.length, 2, "an overtaken search ends its worker");
  const failed = await searchInWorker(() => worker((w) => w.onerror?.({ message: "no script" })))(ask, new AbortController().signal);
  assert.ok("error" in failed && failed.error.includes("no script"));
  const refused = await searchInWorker(() => { throw new Error("no workers here"); })(ask, new AbortController().signal);
  assert.ok("error" in refused && refused.error.includes("no workers here"));
});

test("3.80 the territory worker answers the search the page posts, or why it failed", () => {
  const answered = answerSearch({ ...ask, steps: 1 });
  const seeds = "found" in answered ? answered.found?.seeds : undefined;
  assert.ok(seeds !== undefined && Object.keys(seeds).length === shares.length && grownFrom(linkLayout(shares, coast, links, docks, seeds), seeds), "seeds the island grows from, one in each territory");
  const failed = answerSearch({ ...ask, coast: null as unknown as Coast });
  assert.match("error" in failed ? failed.error : "", /null/, "it says what failed");
});
