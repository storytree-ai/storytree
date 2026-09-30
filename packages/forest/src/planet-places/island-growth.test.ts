/** Islands grow from their anchored places (ADR-0804 D3, D7): a bigger island nudges its neighbours, the globe grows when it is full. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { growPlanet, MAX_NUDGE, SEA_GAP, type GrowingIsland } from "./island-growth.js";
import { placeOnPackedGlobe, PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";

const angle = (a: PlanetPoint, b: PlanetPoint) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
const anchorOf = (place: number): PlanetPoint => { const p = placeOnPackedGlobe(place); return { x: p.x / PLANET_RADIUS, y: p.y / PLANET_RADIUS, z: p.z / PLANET_RADIUS }; };
const islands = (places: readonly number[], reach: number): GrowingIsland[] => places.map(place => ({ story: `story_${place}`, place, reach }));

/** How far two islands' reaches overlap at radius `radius` (negative: room to spare beyond the sea gap). */
function overlap(a: GrowingIsland, b: GrowingIsland, spots: ReadonlyMap<string, PlanetPoint>, radius: number): number {
  return a.reach + b.reach + SEA_GAP - radius * angle(spots.get(a.story)!, spots.get(b.story)!);
}

test("1.7 small islands never move from their anchors, and the globe keeps its radius", () => {
  const set = islands([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 32);
  const grown = growPlanet(set);
  assert.equal(grown.radius, PLANET_RADIUS);
  for (const { story, place } of set) assert.deepEqual(grown.spots.get(story), anchorOf(place));
});

test("1.7 two neighbours whose sizes would overlap are nudged apart, neither overlapping, each within a bound of its anchor", () => {
  const set = islands([2, 3], 50);
  const anchors = new Map(set.map(({ story, place }) => [story, anchorOf(place)]));
  const need = overlap(set[0]!, set[1]!, anchors, PLANET_RADIUS);
  assert.ok(need > 0, "at their anchors the two would overlap");
  const grown = growPlanet(set);
  assert.equal(grown.radius, PLANET_RADIUS, "nudging makes the room, so the globe does not grow");
  assert.ok(overlap(set[0]!, set[1]!, grown.spots, grown.radius) <= 1e-6, "neither overlaps the other");
  for (const { story } of set) {
    const moved = angle(grown.spots.get(story)!, anchors.get(story)!);
    assert.ok(moved > 0, `${story} gives way`);
    assert.ok(moved <= MAX_NUDGE, `${story} stays within the bound of its anchor`);
    assert.ok(moved * PLANET_RADIUS <= need, `${story} is nudged no further than the room needed`);
  }
});

test("1.8 when the islands' total land exceeds what the globe holds, the radius grows until nothing overlaps", () => {
  const set = islands(Array.from({ length: 36 }, (_, i) => i + 1), 80);
  assert.ok(set.length * Math.PI * 80 ** 2 > 4 * Math.PI * PLANET_RADIUS ** 2, "more land than the globe's surface");
  const grown = growPlanet(set);
  assert.ok(grown.radius > PLANET_RADIUS, "the globe grew");
  for (let i = 0; i < set.length; i++) {
    assert.ok(angle(grown.spots.get(set[i]!.story)!, anchorOf(set[i]!.place)) <= MAX_NUDGE + 1e-9, "each stays within the bound of its anchor");
    for (let j = i + 1; j < set.length; j++) assert.ok(overlap(set[i]!, set[j]!, grown.spots, grown.radius) <= 1e-6, `${set[i]!.story} and ${set[j]!.story} do not overlap`);
  }
  assert.deepEqual(growPlanet(set), grown, "the same islands always give the same globe");
});
