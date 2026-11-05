/**
 * Capability 3 · Story node render (the forest story): the selected island's territories arranged by the mock's
 * network-scored search, run off the page, and the arrangement it finds kept so the island does not reshuffle (3.80,
 * ADR-1236 D1, rollout 2 step 2b).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";
import { islandLayout, LIBRARY_LAND, linkLayout, prepareIsland, type Seeds } from "./link-layout.js";
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
const links = [{ from: "z1", to: "a" }, { from: "b", to: "y" }, { from: "c", to: "a" }, { from: "d", to: "c" }, { from: "d", to: "b" }];
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

test("3.80 the network's measures: the road drawn, and the inside links between neighbours", () => {
  const map = linkLayout(shares, coast, links, docks), names = capabilityPlates(map), m = roadMeasures(map, links, docks, names);
  const roads = islandRoads(map, links, docks, names), length = (pts: readonly { x: number; z: number }[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z) : 0), 0);
  const S = Math.sqrt(landArea(coast) / LIBRARY_LAND);
  assert.ok(Math.abs(m.roadDrawn * S - roads.segments.reduce((s, seg) => s + length(seg.pts), 0)) < 1e-6, "the length of the road the island draws, in The library's units");
  const id = (t: number) => (t < 0 ? "open" : map.territories[t]!.capability ?? "");
  const touching = new Set(map.borders.map((b) => [id(map.cells[b.between[0]]!.territory), id(map.cells[b.between[1]]!.territory)].sort().join("|")));
  const home = links.filter((l) => shares.some((s) => s.capability === l.from) && shares.some((s) => s.capability === l.to));
  assert.equal(m.neighbours, home.filter((l) => touching.has([l.from, l.to].sort().join("|"))).length);
  assert.equal(m.unrouted, 0);
  assert.ok(m.overThird <= home.length && m.overThirdBorders >= m.overThird);
});

test("3.80 an interface off the coast costs the arrangement 500, and a link no road reaches refuses it", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const held = owners(linkLayout(shares, coast, links, docks));
  const none = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0 };
  assert.equal(networkScore(island, held, { overThird: 1, overThirdBorders: 2, roadDrawn: 100, neighbours: 1, unrouted: 0 }), 10 + 6 + 5 - 4);
  const inland = held.map((o, c) => (o === 0 && island.frontier[c] ? -1 : o));
  assert.equal(networkScore(island, inland, none), 500, "a, whose lane lands, holds no frontier cell");
  assert.equal(networkScore(island, held, { ...none, unrouted: 1 }), undefined);
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
  const now = await waitUntil(() => keptArrangement("s")?.seeds === found && keptArrangement("s"), 2000, "the arrangement found kept");
  assert.equal(now.key, structureKey(shares, more, docks), "kept under the new structure");
});

test("3.80 a search asked for another island overtakes the one in flight, whose answer is not kept", async () => {
  shelveOn(undefined);
  const signals: AbortSignal[] = [], answers: ((a: SearchAnswer) => void)[] = [];
  const searcher: TerritorySearcher = (_, signal) => { signals.push(signal); return new Promise((resolve) => answers.push(resolve)); };
  searchIsland("one", ask, searcher);
  searchIsland("two", ask, searcher);
  assert.equal(signals[0]!.aborted, true, "the first island's search is overtaken");
  answers[0]!({ found: { seeds: { a: { x: 0, z: 0 } }, score: 0, start: 0 } });
  await quietFor(() => keptArrangement("one") !== undefined, 200, "the overtaken search's answer kept");
});

test("3.80 a kept arrangement outlives the run, on the page's storage; storage it cannot read keeps nothing, and storage that refuses a write keeps it for the run", () => {
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
});

test("3.80 the search runs only in the worker the page names: with none the page searches nothing", () => {
  assert.equal(pageTerritorySearcher({ querySelector: () => null }), undefined);
  assert.equal(pageTerritorySearcher(undefined), undefined);
  const started: string[] = [];
  const was = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class { constructor(script: string) { started.push(script); } postMessage() {} terminate() {} };
  try {
    const searcher = pageTerritorySearcher({ querySelector: (q: string) => (q === 'meta[name="storytree-territory-worker"]' ? { getAttribute: () => "territory-worker.js" } : null) } as unknown as Pick<Document, "querySelector">);
    assert.ok(searcher);
    void searcher(ask, new AbortController().signal);
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
  assert.ok("found" in answered && answered.found !== undefined && Object.keys(answered.found.seeds).length === shares.length);
  const failed = answerSearch({ ...ask, coast: null as unknown as Coast });
  assert.ok("error" in failed && failed.error.length > 0);
});
