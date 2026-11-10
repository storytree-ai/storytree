/**
 * Capability 3 · Story node render (the forest story): the map's top-left mark while islands are still being laid out
 * (3.96), and the island on screen searched first (3.97), as question_bb933ce50f45's option D asked.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { waitUntil } from "@storytree/test-waits";
import { searchIsland, shelveOn, subscribeSearching, type SearchAnswer, type TerritorySearcher } from "../territories/kept-layout.js";
import { islandRoadsWhenRouted, subscribeRouting, type IslandRoads, type RoadsAsk } from "../territories/island-roads.js";
import type { TerritoryMap } from "../territories/territories.js";
import { LayoutProgress, onScreenIsland } from "./layout-progress.js";

afterEach(() => shelveOn(undefined));

const shares = [{ capability: "a", lines: 900 }, { capability: "b", lines: 700 }];
const ask = { shares, coast: [], links: [], docks: [] };
const mark = (islands: readonly string[]) => renderToStaticMarkup(createElement(LayoutProgress, { islands }));

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
    assert.match(html, /role="status"/);
    assert.match(html, /laying out 3 of 4 islands/, "a search in flight, one waiting its turn and a routing each count");
    answers[0]!({ found: undefined });
    await waitUntil(() => answers.length === 2 || undefined, 2000, "the island waiting its turn searched");
    assert.match(mark(["one", "two", "three", "four"]), /laying out 2 of 4 islands/);
    answers[1]!({ found: undefined });
    routed[0]!({ segments: [], junctions: [], gates: [], passes: [], portals: [], tunnels: [], towns: new Map(), settlements: new Map() });
    await waitUntil(() => mark(["one", "two", "three", "four"]) === "" || undefined, 2000, "the mark to go once both queues are idle");
  } finally { stopSearching(); stopRouting(); }
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
