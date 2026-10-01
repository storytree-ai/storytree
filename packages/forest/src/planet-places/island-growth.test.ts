/** Islands grow from their row anchors (ADR-0804 D3, D7, as the rows decision anchors them): a bigger island nudges its neighbours, the globe grows when it is full. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { growPlanet, MAX_NUDGE, SEA_GAP, type GrowingIsland } from "./island-growth.js";
import { placeInRow, PLANET_RADIUS, rowLatitude, type PlanetPoint } from "./planet-places.js";

const angle = (a: PlanetPoint, b: PlanetPoint) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
/** Eight rows, about 46 ground units apart: one island alone in each of rows 0, 1 and 7. */
const ROWS = 8;
const stacked = (reach: number): GrowingIsland[] => [0, 1, 7].map(row => ({ story: `row_${row}`, place: placeInRow(row, 0), reach }));
/** Where a lone island in row `row` is anchored: on the front of the globe, at its row's latitude. */
const anchorOf = (row: number): PlanetPoint => ({ x: 0, y: Math.sin(rowLatitude(row, ROWS)), z: Math.cos(rowLatitude(row, ROWS)) });

/** How far two islands' reaches overlap at radius `radius` (negative: room to spare beyond the sea gap). */
function overlap(a: GrowingIsland, b: GrowingIsland, spots: ReadonlyMap<string, PlanetPoint>, radius: number): number {
  return a.reach + b.reach + SEA_GAP - radius * angle(spots.get(a.story)!, spots.get(b.story)!);
}

test("1.7 small islands never move from their anchors, and the globe keeps its radius", () => {
  const grown = growPlanet(stacked(10));
  assert.equal(grown.radius, PLANET_RADIUS);
  for (const row of [0, 1, 7]) assert.ok(angle(grown.spots.get(`row_${row}`)!, anchorOf(row)) < 1e-6);
});

test("1.7 two neighbours whose sizes would overlap are nudged apart, neither overlapping, each within a bound of its anchor", () => {
  const set = stacked(30);
  const anchors = new Map([0, 1, 7].map(row => [`row_${row}`, anchorOf(row)]));
  const need = overlap(set[0]!, set[1]!, anchors, PLANET_RADIUS);
  assert.ok(need > 0, "at their anchors the two would overlap");
  const grown = growPlanet(set);
  assert.equal(grown.radius, PLANET_RADIUS, "nudging makes the room, so the globe does not grow");
  assert.ok(overlap(set[0]!, set[1]!, grown.spots, grown.radius) <= 1e-6, "neither overlaps the other");
  for (const { story } of set.slice(0, 2)) {
    const moved = angle(grown.spots.get(story)!, anchors.get(story)!);
    assert.ok(moved > 0, `${story} gives way`);
    assert.ok(moved <= MAX_NUDGE, `${story} stays within the bound of its anchor`);
    assert.ok(moved * PLANET_RADIUS <= need, `${story} is nudged no further than the room needed`);
  }
  assert.ok(angle(grown.spots.get("row_7")!, anchors.get("row_7")!) < 1e-6, "a far island does not move");
});

test("1.8 when a row no longer fits round the globe, the radius grows until nothing overlaps", () => {
  const set = Array.from({ length: 20 }, (_, slot): GrowingIsland => ({ story: `story_${slot}`, place: placeInRow(0, slot), reach: 40 }));
  assert.ok(set.length * (2 * 40 + SEA_GAP) > 2 * Math.PI * PLANET_RADIUS * Math.cos(rowLatitude(0, 1)), "longer than the equator");
  const grown = growPlanet(set);
  assert.ok(grown.radius > PLANET_RADIUS, "the globe grew");
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    assert.ok(overlap(set[i]!, set[j]!, grown.spots, grown.radius) <= 1e-6, `${set[i]!.story} and ${set[j]!.story} do not overlap`);
  }
  assert.deepEqual(growPlanet(set), grown, "the same islands always give the same globe");
});

test("1.4 after nudging, on storytree's own seven rows at their real sizes, every island sits north of every island in a lower row, and none overlap", () => {
  // Rows and coast reaches as storytree's library and code gave them on 2026-10-02 (view/evidence/code-rows): seven rows, The world the largest.
  const rows: [string, number, number][][] = [
    [["The local database", 26.6], ["Process ledger", 23.3], ["The library", 54.1], ["The world", 102], ["Keys", 13.5]],
    [["The librarian", 20.4]],
    [["The agent link", 75.6]],
    [["The app", 33.5], ["The knowledge core", 31.9], ["The app setup", 28.8]],
    [["The dev loop", 33.2], ["The arc surface", 26.8]],
    [["The forest", 37]],
    [["The command line", 35.5], ["The website", 20]],
  ].map((row, r) => row.map(([story, reach], slot) => [story as string, placeInRow(r, slot), reach as number]));
  const set = rows.flat().map(([story, place, reach]): GrowingIsland => ({ story, place, reach }));
  const grown = growPlanet(set);
  const latitude = (story: string) => Math.asin(grown.spots.get(story)!.y);
  rows.forEach((row, r) => rows.slice(0, r).flat().forEach(([below]) => row.forEach(([story]) => {
    assert.ok(latitude(story) > latitude(below), `${story} (row ${r}) sits north of ${below}`);
  })));
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    assert.ok(overlap(set[i]!, set[j]!, grown.spots, grown.radius) <= 1e-6, `${set[i]!.story} and ${set[j]!.story} do not overlap`);
  }
});
