/**
 * Capability 3 · Story node render (the forest story): the selected island's territories arranged by the mock's
 * network-scored search, run off the page, and the arrangement it finds kept so the island does not reshuffle (3.80,
 * ADR-1236 D1, rollout 2 step 2b).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";
import { islandLayout, LIBRARY_LAND, linkLayout, prepareIsland, type Seeds } from "./link-layout.js";
import { awaitingLayout, keepArrangement, keptArrangement, pageTerritorySearcher, searchFirst, searchInWorker, searchIsland, shelveOn, storageShelf, structureKey, subscribeKept, type SearchAnswer, type SearchAsk, type SearchWorker, type TerritorySearcher } from "./kept-layout.js";
import { borderLength, networkScore, searchTerritories } from "./territory-search.js";
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
  const found = searchTerritories({ ...ask, steps: 2 });
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
  // The border between the strips runs across the land only, never on past the coast: two crossings of a strip 36 / S wide.
  const island = prepareIsland(thirds, strip, [], [])!, held = owners(map), across36 = 36 / S;
  const border = borderLength(island, held);
  assert.ok(border >= 2 * across36 && border < 2 * 1.5 * across36, `two borders across the strip, ${border}, each a little longer than its width ${across36}`);
  assert.ok(Math.abs(borderLength(island, held.map((o) => (o === 2 ? 1 : o))) * 2 - border) < 0.25 * border, "b and c as one, half the border");
});

test("3.80 an interface off the coast costs the arrangement 500, and a link no road reaches refuses it", () => {
  const island = prepareIsland(shares, coast, links, docks)!;
  const held = owners(linkLayout(shares, coast, links, docks));
  const none = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0, tunnels: 0 };
  const network = networkScore(island, held, { overThird: 1, overThirdBorders: 2, roadDrawn: 100, neighbours: 1, unrouted: 0, tunnels: 1 })! - networkScore(island, held, none)!;
  assert.ok(Math.abs(network - (100 + 10 + 6 + 5 - 4)) < 1e-9, `a tunnel, a link over a third territory across two borders, 100 of road and a link between neighbours: ${network}`);
  // a's frontier cells made open land: the border it held there is gone too, at most 0.2 a unit of it.
  const inland = held.map((o, c) => (o === 0 && island.frontier[c] ? -1 : o));
  const offCoast = networkScore(island, inland, none)! - networkScore(island, held, none)!;
  assert.ok(offCoast > 400 && offCoast <= 500, `a, whose lane lands, holds no frontier cell: ${offCoast}`);
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
  keepArrangement("s", { key: structureKey(shares), seeds });
  searchIsland("s", ask, searcher);
  assert.equal(asked.length, 0, "the structure the arrangement was kept for asks no search");
  assert.ok(grownFrom(islandLayout("s", shares, coast, links, docks), seeds), "drawn from the kept seeds");
  assert.ok(!grownFrom(islandLayout("other", shares, coast, links, docks), seeds), "an island with nothing kept draws the start");
  // More lines are no change of structure.
  searchIsland("s", { ...ask, shares: shares.map((s) => ({ ...s, lines: s.lines * 2 })) }, searcher);
  assert.equal(asked.length, 0, "a change of lines only resizes");
  const more = [...shares, { capability: "e", lines: 200 }];
  searchIsland("s", { ...ask, shares: more }, searcher);
  searchIsland("s", { ...ask, shares: more }, searcher);
  assert.equal(asked.length, 1, "a new territory asks one search, and asking again while it runs asks no other");
  assert.deepEqual(asked[0]!.kept, seeds, "seeded from the kept seeds the island is drawn from");
  const found = { a: { x: 1, z: 2 }, b: { x: 3, z: 4 }, c: { x: 5, z: 6 }, d: { x: 7, z: 8 }, e: { x: 0, z: 0 }, "": { x: 9, z: 9 } };
  answer({ found: { seeds: found, score: 1, start: 2 } });
  const now = await waitUntil(() => { const k = keptArrangement("s"); return k?.seeds === found ? k : undefined; }, 2000, "the arrangement found kept");
  assert.equal(now.key, structureKey(more), "kept under the new structure");
});

test("3.94 a new link or a lane moved to another dock keeps the island's kept seeds and asks no search; a territory added or dropped is searched with the kept territories fixed", () => {
  shelveOn(undefined);
  const asked: SearchAsk[] = [];
  const searcher: TerritorySearcher = (given) => { asked.push(given); return new Promise(() => {}); };
  const seeds = { a: { x: 60, z: 10 }, b: { x: -60, z: -10 }, c: { x: 0, z: 50 }, d: { x: 0, z: -50 }, "": { x: 20, z: 20 } };
  keepArrangement("s", { key: structureKey(shares), seeds });
  const moved = [{ ...docks[0]!, links: [] }, { ...docks[1]!, links: ["b->y", "z1->a"] }];
  searchIsland("s", { ...ask, links: [...links, { from: "c", to: "b" }] }, searcher);
  searchIsland("s", { ...ask, docks: moved }, searcher);
  assert.equal(asked.length, 0, "a new link and a lane moved to another dock ask no search");
  assert.equal(keptArrangement("s")?.seeds, seeds, "the kept seeds stay kept");
  assert.ok(grownFrom(islandLayout("s", shares, coast, [...links, { from: "c", to: "b" }], docks), seeds), "and the island is still drawn from them");
  searchIsland("s", { ...ask, shares: [...shares, { capability: "e", lines: 200 }] }, searcher);
  assert.equal(asked.length, 1, "a new territory asks a search");
  assert.deepEqual([...asked[0]!.fixed!].sort(), ["", "a", "b", "c", "d"], "the territories already kept may not move");
  shelveOn(undefined);
  keepArrangement("t", { key: structureKey(shares), seeds });
  searchIsland("t", { ...ask, shares: shares.filter((s) => s.capability !== "d") }, searcher);
  assert.equal(asked.length, 1, "a territory dropped leaves the rest where they were kept, with nothing to search");
  assert.equal(keptArrangement("t")?.key, structureKey(shares.filter((s) => s.capability !== "d")), "kept again under the new structure");
});

test("3.95 an island whose kept arrangement does not place every territory awaits its search where the page offers one, until the search keeps what it found; one that fails or finds nothing ends the wait, and an island with a territory dropped awaits nothing", async () => {
  shelveOn(undefined);
  const asked: { story: string; answer: (a: SearchAnswer) => void }[] = [];
  const searcher = (story: string): TerritorySearcher => () => new Promise((answer) => asked.push({ story, answer }));
  assert.equal(awaitingLayout("s", shares, undefined), false, "a page with no search draws its start at once");
  assert.equal(awaitingLayout("s", shares.slice(0, 1), searcher("s")), false, "nor does an island with one territory, which has nothing to arrange");
  assert.equal(awaitingLayout("s", shares, searcher("s")), true, "an island with nothing kept awaits its first search, before it is asked");
  searchIsland("s", ask, searcher("s"));
  searchIsland("t", ask, searcher("t"));
  searchIsland("u", ask, searcher("u"));
  searchIsland("w", ask, () => Promise.reject(new Error("the worker died")));
  assert.equal(awaitingLayout("t", shares, searcher("t")), true, "and while it waits its turn");
  let heard = 0;
  const stop = subscribeKept(() => { heard++; });
  asked[0]!.answer({ found: { seeds: { a: { x: 1, z: 0 } }, score: 0, start: 0 } });
  await waitUntil(() => keptArrangement("s") !== undefined, 2000, "the first search's answer kept");
  assert.equal(awaitingLayout("s", shares, searcher("s")), false, "the island draws once its search keeps an arrangement");
  await waitUntil(() => asked.length === 2, 2000, "the next island searched");
  asked[1]!.answer({ found: undefined });
  await waitUntil(() => !awaitingLayout("t", shares, searcher("t")), 2000, "a search that finds nothing ends the wait");
  assert.equal(keptArrangement("t"), undefined, "with nothing kept: the island draws its start");
  await waitUntil(() => asked.length === 3, 2000, "the last island searched");
  asked[2]!.answer({ error: "no worker" });
  await waitUntil(() => !awaitingLayout("u", shares, searcher("u")), 2000, "a search that answers an error ends the wait");
  await waitUntil(() => !awaitingLayout("w", shares, searcher("w")), 2000, "a search that throws ends the wait");
  assert.equal(heard, 4, "the page hears the arrangement kept and each wait ended, once each");
  stop();
  const seeds = { "": { x: 0, z: 0 }, a: { x: 1, z: 0 }, b: { x: 2, z: 0 }, c: { x: 3, z: 0 }, d: { x: 4, z: 0 } };
  const more = [...shares, { capability: "e", lines: 200 }], fewer = shares.filter((s) => s.capability !== "d");
  keepArrangement("v", { key: structureKey(shares), seeds });
  assert.equal(awaitingLayout("v", shares, searcher("v")), false, "a kept island draws at once");
  assert.equal(awaitingLayout("v", more, searcher("v")), true, "a territory added to it awaits the search that places it, before it is asked");
  searchIsland("v", { ...ask, shares: more }, searcher("v"));
  assert.equal(awaitingLayout("v", more, searcher("v")), true, "and while it runs");
  asked.at(-1)!.answer({ found: { seeds: { ...seeds, e: { x: 5, z: 0 } }, score: 0, start: 0 } });
  await waitUntil(() => !awaitingLayout("v", more, searcher("v")), 2000, "the island draws once that search keeps an arrangement");
  keepArrangement("x", { key: structureKey(shares), seeds });
  searchIsland("x", { ...ask, shares: more }, searcher("x"));
  asked.at(-1)!.answer({ found: undefined });
  await waitUntil(() => !awaitingLayout("x", more, searcher("x")), 2000, "a search for the added structure that finds nothing ends its wait");
  assert.equal(awaitingLayout("x", [...more, { capability: "f", lines: 100 }], searcher("x")), true, "but not the wait of a structure it was not asked for");
  assert.equal(awaitingLayout("v", fewer, searcher("v")), false, "a territory dropped from a kept island draws at once");
  keepArrangement("y", { key: JSON.stringify(["score 1", ["a"]]), seeds: { a: { x: 1, z: 0 } } });
  assert.equal(awaitingLayout("y", shares, searcher("y")), false, "an arrangement kept under an older score still places its island while it is searched again");
  shelveOn(undefined);
  assert.equal(awaitingLayout("t", shares, searcher("t")), true, "a new shelf forgets the waits ended");
});

test("3.94 a search with territories fixed moves only the others: the fixed come back where the island is drawn from", { timeout: 120_000 }, () => {
  const more = [...shares, { capability: "e", lines: 200 }], wider = [...links, { from: "e", to: "a" }];
  const kept = searchTerritories({ ...ask, steps: 0 })!.seeds, fixed = Object.keys(kept);
  const start = searchTerritories({ shares: more, coast, links: wider, docks, kept, steps: 0 })!.seeds;
  const found = searchTerritories({ shares: more, coast, links: wider, docks, kept, fixed, steps: 2 })!;
  for (const id of fixed) assert.deepEqual(found.seeds[id], start[id], `${id || "the Unclaimed code"} kept its place`);
  const free = searchTerritories({ shares: more, coast, links: wider, docks, kept, steps: 2 })!;
  assert.ok(fixed.some((id) => JSON.stringify(free.seeds[id]) !== JSON.stringify(start[id])), "searched with none fixed, a kept territory moves");
  const all = searchTerritories({ shares: more, coast, links: wider, docks, kept, fixed: [...fixed, "e"], steps: 1 })!;
  assert.deepEqual(all.seeds, start, "with every territory fixed it answers the arrangement it starts from");
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
  assert.notEqual(structureKey(shares), before);
});

test("3.80 a search asked for another island waits its turn behind the one in flight, one at a time; a new structure of the island in flight overtakes it", async () => {
  shelveOn(undefined);
  const asked: { shares: number; signal: AbortSignal; answer: (a: SearchAnswer) => void }[] = [];
  const searcher: TerritorySearcher = (given, signal) => new Promise((answer) => asked.push({ shares: given.shares.length, signal, answer }));
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
  const more = [...shares, { capability: "e", lines: 200 }];
  searchIsland("two", { ...ask, shares: more }, searcher);
  assert.equal(asked[1]!.signal.aborted, true, "the old structure's search is overtaken");
  await waitUntil(() => asked.length === 3, 2000, "the new structure searched");
  assert.equal(asked[2]!.shares, more.length, "searched for the new structure");
  asked[1]!.answer(found(2));
  asked[2]!.answer(found(3));
  await waitUntil(() => asked.length === 4, 2000, "the island waiting its turn searched last");
  assert.equal(keptArrangement("two")?.seeds.a?.x, 3, "the overtaken search's answer is not kept");
  assert.equal(keptArrangement("two")?.key, structureKey(more));
  asked[3]!.answer(found(4));
  await waitUntil(() => keptArrangement("three")?.seeds.a?.x === 4, 2000, "the last island kept");
});

test("3.97 the island on screen is searched next, ahead of those that waited longer, at its full length; it never overtakes the search in flight", async () => {
  shelveOn(undefined);
  const asked: { story: string; steps: number | undefined; signal: AbortSignal; answer: (a: SearchAnswer) => void }[] = [];
  const searcher = (story: string): TerritorySearcher => (given, signal) => new Promise((answer) => asked.push({ story, steps: given.steps, signal, answer }));
  for (const story of ["one", "two", "three", "four"]) searchIsland(story, ask, searcher(story));
  searchFirst("three");
  assert.equal(asked.length, 1, "nothing starts beside the search in flight");
  assert.equal(asked[0]!.signal.aborted, false, "and the search in flight is not overtaken");
  asked[0]!.answer({ found: undefined });
  await waitUntil(() => asked.length === 2, 2000, "the next search");
  assert.equal(asked[1]!.story, "three", "the island on screen is searched before the islands that waited longer");
  assert.equal(asked[1]!.steps, ask.steps, "with every step it was asked");
  searchFirst(undefined);
  asked[1]!.answer({ found: undefined });
  await waitUntil(() => asked.length === 3, 2000, "the next search");
  assert.equal(asked[2]!.story, "two", "with no island on screen the rest go in the order asked");
  searchFirst("one");
  asked[2]!.answer({ found: undefined });
  await waitUntil(() => asked.length === 4, 2000, "the last search");
  assert.equal(asked[3]!.story, "four", "an island on screen that waits for nothing changes nothing");
  asked[3]!.answer({ found: undefined });
});

test("3.80 an island kept for its structure while it waits its turn is passed over, and the island behind it is searched; a new shelf ends the search in flight and forgets those waiting", async () => {
  shelveOn(undefined);
  const asked: { story: string; signal: AbortSignal; answer: (a: SearchAnswer) => void }[] = [];
  const searcher = (story: string): TerritorySearcher => (_, signal) => new Promise((answer) => asked.push({ story, signal, answer }));
  for (const story of ["one", "two", "three"]) searchIsland(story, ask, searcher(story));
  keepArrangement("two", { key: structureKey(shares), seeds: { a: { x: 2, z: 0 } } });
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
