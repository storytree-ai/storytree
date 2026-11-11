/**
 * Capability 3 · Story node render (the forest story): the map's top-left mark while islands are still being laid out
 * (3.96), and the island on screen searched first (3.97), as question_bb933ce50f45's option D asked.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { waitUntil } from "@storytree/test-waits";
import { keepArrangement, searchIsland, shelveOn, structureKey, subscribeSearching, type SearchAnswer, type TerritorySearcher } from "../territories/kept-layout.js";
import { islandRoadsWhenRouted, subscribeRouting, type IslandRoads, type RoadsAsk } from "../territories/island-roads.js";
import type { TerritoryMap } from "../territories/territories.js";
import { holdLayingOut, LayoutProgress, onScreenIsland } from "./layout-progress.js";

afterEach(() => shelveOn(undefined));

const shares = [{ capability: "a", lines: 900 }, { capability: "b", lines: 700 }];
const ask = { shares, coast: [], links: [], docks: [] };
const settled = '<div hidden="" data-layout="settled"></div>';
/** The mark over `islands` named alone, as an island with no land yet is: settled is no mark the eye reads. */
const mark = (islands: readonly string[]) => {
  const html = renderToStaticMarkup(createElement(LayoutProgress, { islands: islands.map((story) => ({ story })) }));
  return html === settled ? "" : html;
};

test("3.96 the map's top-left mark counts the islands whose layout is searched or whose roads are routed, and goes when none are", async () => {
  shelveOn(undefined);
  const answers: ((a: SearchAnswer) => void)[] = [];
  const searcher: TerritorySearcher = () => new Promise((answer) => answers.push(answer));
  let searching = 0, routing = 0;
  const stopSearching = subscribeSearching(() => { searching++; }), stopRouting = subscribeRouting(() => { routing++; });
  try {
    assert.equal(mark(["one", "two", "three", "four"]), "", "no mark while nothing is laid out");
    searchIsland("one", ask, searcher);
    searchIsland("two", ask, searcher);
    const routed: ((roads: IslandRoads) => void)[] = [];
    const roadsAsk: RoadsAsk = { map: { radius: 1, territories: [], cells: [], borders: [] } as TerritoryMap, links: [], docks: [], names: [], story: "three" };
    islandRoadsWhenRouted(roadsAsk, () => new Promise((resolve) => routed.push(resolve)), new AbortController().signal);
    assert.ok(searching > 0 && routing > 0, "both queues tell the mark when they change");
    const html = mark(["one", "two", "three", "four"]);
    assert.match(html, /role="status" data-layout="laying-out"/);
    assert.match(html, /laying out 3 of 4 islands/, "a search in flight, one waiting its turn and a routing each count");
    answers[0]!({ found: undefined });
    await waitUntil(() => answers.length === 2 || undefined, 2000, "the island waiting its turn searched");
    assert.match(mark(["one", "two", "three", "four"]), /laying out 2 of 4 islands/);
    answers[1]!({ found: undefined });
    routed[0]!({ segments: [], junctions: [], gates: [], passes: [], portals: [], tunnels: [], towns: new Map(), settlements: new Map() });
    await waitUntil(() => mark(["one", "two", "three", "four"]) === "" || undefined, 2000, "the mark to go once both queues are idle");
    // An island let go while it routes or waits its turn, or already let go when asked, is no longer counted.
    const island = (story: string): RoadsAsk => ({ ...roadsAsk, map: { ...roadsAsk.map }, story });
    const letGo = ["five", "six", "seven"].map((story) => ({ story, shown: new AbortController() }));
    for (const { story, shown } of letGo) islandRoadsWhenRouted(island(story), () => new Promise(() => {}), shown.signal);
    assert.match(mark(["five", "six", "seven", "eight"]), /laying out 3 of 4 islands/, "two routing and one waiting its turn");
    for (const { shown } of letGo) shown.abort();
    const gone = new AbortController();
    gone.abort();
    islandRoadsWhenRouted(island("eight"), () => new Promise(() => {}), gone.signal);
    assert.equal(mark(["five", "six", "seven", "eight"]), "", "islands let go are not counted");
  } finally { stopSearching(); stopRouting(); }
});

test("3.98 the map says it has settled once no island awaits its first layout, nor is searched or routed; until then its mark counts the islands awaiting one", () => {
  shelveOn(undefined);
  const searcher: TerritorySearcher = () => new Promise(() => {});
  const progress = (islands: readonly { story: string; territories?: typeof shares }[]) => renderToStaticMarkup(createElement(LayoutProgress, { islands, searcher }));
  const map = [{ story: "one", territories: shares }, { story: "two", territories: shares }, { story: "three" }];
  const awaiting = progress(map);
  assert.match(awaiting, /data-layout="laying-out"[^>]*>laying out 2 of 3 islands/, "two islands await their first search before any is asked, the one with no land none");
  assert.doesNotMatch(awaiting, /data-layout="settled"/, "and the map has not settled");
  keepArrangement("one", { key: structureKey(shares), seeds: { a: { x: 1, z: 0 } } });
  assert.match(progress(map), /laying out 1 of 3 islands/, "an island kept no longer awaits");
  keepArrangement("two", { key: structureKey(shares), seeds: { a: { x: 1, z: 0 } } });
  assert.equal(progress(map), settled, "with every island kept and nothing searched or routed, one hidden mark says the map has settled");
  searchIsland("three", { ...ask, shares: [...shares, { capability: "c", lines: 100 }] }, searcher);
  assert.match(progress(map), /laying out 1 of 3 islands/, "an island searched again unsettles it");
  assert.equal(progress([]), "", "a map with no islands yet has not settled: it has nothing laid out to say so of");
});

test("3.101 an island whose land is not yet laid out as its docks are now keeps the map unsettled, kept or not, until it lets go", () => {
  shelveOn(undefined);
  const searcher: TerritorySearcher = () => new Promise(() => {});
  const progress = () => renderToStaticMarkup(createElement(LayoutProgress, { islands: [{ story: "one", territories: shares }, { story: "two" }], searcher }));
  keepArrangement("one", { key: structureKey(shares), seeds: { a: { x: 1, z: 0 } } });
  assert.equal(progress(), settled, "a kept island, nothing searched or routed");
  const letGo = holdLayingOut("one"), again = holdLayingOut("one");
  assert.match(progress(), /data-layout="laying-out"[^>]*>laying out 1 of 2 islands/, "held while its land is laid out again for docks that came after the layout it kept");
  letGo();
  letGo();
  assert.match(progress(), /laying out 1 of 2 islands/, "each hold lets go once, and the island stays held while another holds it");
  again();
  assert.equal(progress(), settled, "settled once nothing holds it");
});

test("3.97 the island on screen is the one selected, else the island that joined the map last; the map's first islands name none", () => {
  const onScreen = onScreenIsland();
  assert.equal(onScreen(["a", "b"], undefined), undefined, "the islands the map opens with are not new");
  assert.equal(onScreen(["a", "b"], "a"), "a", "the selected island");
  assert.equal(onScreen(["a", "b", "c"], undefined), "c", "an island that joins later is the newest");
  assert.equal(onScreen(["a", "b", "c", "d"], "b"), "b", "the selected island wins over the newest");
  assert.equal(onScreen(["a", "b", "c", "d"], undefined), "d");
  assert.equal(onScreen(["a", "b", "c"], undefined), "c", "the newest gone, the one before it");
});
