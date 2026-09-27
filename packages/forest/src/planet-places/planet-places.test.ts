/** Story nodes' globe book (ADR-0648): fixed places, unchanged by other stories, with room for real shores. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedStory, Change } from "@storytree/library";

import { storyNodes } from "../story-nodes/story-nodes.js";
import { placeOnGlobe, PLANET_CAPACITY, PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
function story(index: number, capabilities = 0): AnnotatedStory {
  return { id: `story_${index}`, title: `Story ${index}`, health,
    capabilities: Array.from({ length: capabilities }, (_, c) => ({
      id: `cap_${index}_${c}`, title: `Capability ${c}`, health, dependsOn: [], contracts: [],
    })),
  };
}

const distance = (a: PlanetPoint, b: PlanetPoint): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("1.4 the same places always give the same globe spots, packed from the front pole on a fixed sphere", () => {
  const spots = Array.from({ length: PLANET_CAPACITY }, (_, i) => placeOnGlobe(i + 1));
  for (let i = spots.length - 1; i >= 0; i--) {
    assert.deepEqual(placeOnGlobe(i + 1), spots[i], "reading in another order changes nothing");
    assert.ok(Math.abs(Math.hypot(spots[i]!.x, spots[i]!.y, spots[i]!.z) - 160) < 1e-9);
  }
  // These places must remain fixed across releases, not just across calls in one process.
  const anchors: [number, PlanetPoint][] = [
    [1, { x: 0, y: 0, z: 160 }],
    [2, { x: 68.77474840531116, y: -4.489463666016254, z: 144.3948707460818 }],
    [36, { x: 18.934663105978217, y: 150.03550374065165, z: -52.25730714791963 }],
  ];
  for (const [place, point] of anchors) assert.ok(distance(placeOnGlobe(place), point) < 1e-9, `place ${place} stays fixed`);
  assert.equal(PLANET_CAPACITY, 36);
  // The occupied patch grows outward; seven stories still share the front of the ball.
  for (let i = 1; i < spots.length; i++) assert.ok(spots[i]!.z < spots[i - 1]!.z);
  assert.ok(spots.slice(0, 7).every(p => p.z > Math.SQRT1_2 * PLANET_RADIUS));
  // A caller must not be able to move a later read by mutating the returned point.
  placeOnGlobe(1).x = 123;
  assert.deepEqual(placeOnGlobe(1), spots[0]);
  for (const invalid of [0, -1, 1.5, 37, NaN, Infinity]) assert.throws(() => placeOnGlobe(invalid), RangeError);
});

test("1.5 adding or retiring a story moves no other globe island and never reuses a retired spot", () => {
  const stories = Array.from({ length: 6 }, (_, i) => story(i));
  const at = "2026-09-27T00:00:00.000Z";
  const history = stories.map(({ id, title }, i): Change => ({
    seq: i + 1, recordId: id, type: "story", action: "created",
    record: { id, type: "story", version: 1, fields: { title }, createdAt: at, updatedAt: at },
  }));
  const placed = (live: AnnotatedStory[], changes: Change[]) => new Map(
    storyNodes({ stories: live, arcs: [] }, changes).map(node => [node.id, placeOnGlobe(node.place)]),
  );
  const before = placed(stories.slice(0, 5), history.slice(0, 5));
  const retired: Change = { ...history[1]!, seq: 7, action: "retired" };
  const after = placed(stories.filter((_, i) => i !== 1).reverse(), [...history, retired]);
  assert.equal(after.has("story_1"), false);
  for (const [id, point] of before) if (id !== "story_1") assert.deepEqual(after.get(id), point);
  assert.equal(after.size, 5);
  for (const point of before.values()) assert.notDeepEqual(after.get("story_5"), point);
});
