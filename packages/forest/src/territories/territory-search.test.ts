/**
 * Capability 3 · Story node render (the forest story): the selected island's territories arranged by the mock's
 * network-scored search, run off the page, and the arrangement it finds kept so the island does not reshuffle (3.80,
 * ADR-1236 D1, rollout 2 step 2b).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { islandLayout, LIBRARY_LAND, linkLayout, prepareIsland } from "./link-layout.js";
import { keepArrangement, keptArrangement, pageTerritorySearcher, searchInWorker, searchIsland, shelveOn, storageShelf, structureKey, type SearchAnswer, type SearchAsk, type SearchWorker, type TerritorySearcher } from "./kept-layout.js";
import { networkScore, searchTerritories } from "./territory-search.js";
import { roadMeasures } from "./island-roads.js";
import { capabilityPlates } from "../view/nameplates.js";
import type { Coast } from "./territories.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", lines: 900 }, { capability: "b", lines: 700 }, { capability: "c", lines: 500 }, { capability: "d", lines: 300 }, { lines: 150 }];
// a and b take lanes over the sea; c and d link only at home, d to a far across the island.
const links = [{ from: "z1", to: "a" }, { from: "b", to: "y" }, { from: "c", to: "a" }, { from: "d", to: "c" }, { from: "d", to: "b" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a"] }, { local: { x: -R, z: 0 }, links: ["b->y"] }];
const ask: SearchAsk = { shares, coast, links, docks, steps: 4 };
const scoreOf = (map: ReturnType<typeof linkLayout>) => networkScore(prepareIsland(shares, coast, links, docks)!, map.cells.map((cell) => cell.territory), roadMeasures(map, links, docks, capabilityPlates(map)));

afterEach(() => shelveOn(undefined));

test("3.80 the search scores each arrangement on the road network routed over it and answers one that betters the start the page draws, which the kept seeds draw again", { timeout: 120_000 }, () => {
  const found = searchTerritories({ ...ask, steps: 30 });
  assert.ok(found, "an arrangement grows and routes");
  assert.equal(found.start, scoreOf(linkLayout(shares, coast, links, docks)), "it starts from the arrangement the page draws");
  assert.ok(found.score < found.start, `${found.score} betters the start's ${found.start}`);
  assert.deepEqual(Object.keys(found.seeds).sort(), ["", "a", "b", "c", "d"], "a seed for every territory, the Unclaimed code's included");
  assert.equal(scoreOf(linkLayout(shares, coast, links, docks, found.seeds)), found.score, "grown from the kept seeds, the island is the arrangement found");
});

test("3.80 an interface off the coast costs the arrangement 500, and a link no road reaches refuses it", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const owners = linkLayout(shares, coast, links, docks).cells.map((cell) => cell.territory);
  const none = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0 };
  assert.equal(networkScore(island, owners, { overThird: 1, overThirdBorders: 2, roadDrawn: 100, neighbours: 1, unrouted: 0 }), 10 + 6 + 5 - 4);
  const inland = owners.map((o, c) => (o === 0 && island.frontier[c] ? -1 : o));
  assert.equal(networkScore(island, inland, none), 500, "a, whose lane lands, holds no frontier cell");
  assert.equal(networkScore(island, owners, { ...none, unrouted: 1 }), undefined);
});

test("3.80 a kept arrangement for the island's structure draws from its seeds and asks no search; a change of structure asks one, seeded from what is drawn, and keeps what it finds", async () => {
  shelveOn(undefined);
  const asked: SearchAsk[] = [];
  let answer: (a: SearchAnswer) => void = () => {};
  const searcher: TerritorySearcher = (given) => { asked.push(given); return new Promise((resolve) => { answer = resolve; }); };
  const seeds = { a: { x: -40, z: 30 }, b: { x: 40, z: -30 }, c: { x: 0, z: 40 }, d: { x: 0, z: -40 }, "": { x: 10, z: 10 } };
  keepArrangement("s", { key: structureKey(shares, links, docks), seeds });
  searchIsland("s", ask, searcher);
  assert.equal(asked.length, 0, "the structure the arrangement was kept for asks no search");
  assert.equal(islandLayout("s", shares, coast, links, docks), islandLayout("s", shares, coast, links, docks), "laid out once");
  assert.deepEqual(scoreOf(islandLayout("s", shares, coast, links, docks)), scoreOf(linkLayout(shares, coast, links, docks, seeds)), "drawn from the kept seeds");
  // More lines are no change of structure.
  const grown = shares.map((s) => ({ ...s, lines: s.lines * 2 }));
  searchIsland("s", { ...ask, shares: grown }, searcher);
  assert.equal(asked.length, 0, "a change of lines only resizes");
  const more = [...links, { from: "c", to: "b" }];
  searchIsland("s", { ...ask, links: more }, searcher);
  searchIsland("s", { ...ask, links: more }, searcher);
  assert.equal(asked.length, 1, "a new link asks one search, and asking again while it runs asks no other");
  assert.deepEqual(asked[0]!.kept, seeds, "seeded from the kept seeds the island is drawn from");
  const found = { a: { x: 1, z: 2 }, b: { x: 3, z: 4 }, c: { x: 5, z: 6 }, d: { x: 7, z: 8 }, "": { x: 9, z: 9 } };
  answer({ found: { seeds: found, score: 1, start: 2 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(keptArrangement("s"), { key: structureKey(shares, more, docks), seeds: found });
});

test("3.80 a search asked for another island overtakes the one in flight, whose answer is not kept", async () => {
  shelveOn(undefined);
  const signals: AbortSignal[] = [], answers: ((a: SearchAnswer) => void)[] = [];
  const searcher: TerritorySearcher = (_, signal) => { signals.push(signal); return new Promise((resolve) => answers.push(resolve)); };
  searchIsland("one", ask, searcher);
  searchIsland("two", ask, searcher);
  assert.equal(signals[0]!.aborted, true, "the first island's search is overtaken");
  answers[0]!({ found: { seeds: { a: { x: 0, z: 0 } }, score: 0, start: 0 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(keptArrangement("one"), undefined);
});

test("3.80 a kept arrangement outlives the run, on the page's storage", () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  shelveOn(storageShelf(storage));
  keepArrangement("s", { key: "k", seeds: { a: { x: 1, z: 2 } } });
  shelveOn(storageShelf(storage));
  assert.deepEqual(keptArrangement("s"), { key: "k", seeds: { a: { x: 1, z: 2 } } });
});

test("3.80 the search runs only in the worker the page names: with none the page searches nothing, and a worker that fails keeps nothing", async () => {
  assert.equal(pageTerritorySearcher({ querySelector: () => null }), undefined);
  assert.equal(pageTerritorySearcher(undefined), undefined);
  const failing: SearchWorker = { postMessage() { queueMicrotask(() => failing.onerror?.({ message: "no script" })); }, terminate() {}, onmessage: null, onerror: null };
  const answer = await searchInWorker(() => failing)(ask, new AbortController().signal);
  assert.ok("error" in answer && answer.error.includes("no script"));
});
