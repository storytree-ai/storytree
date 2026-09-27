/** Story nodes' globe book (ADR-0646): fixed places, unchanged by other stories, with room for real shores. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { workStates } from "@storytree/arc-surface";
import type { AnnotatedStory, Change } from "@storytree/library";

import { clipToCoast, SHIPPED_COAST } from "../../../forest-world/src/coast-clip.js";
import { forestDescriptors, islandReach } from "../../../forest-world/src/forest-ground/forest-ground.js";
import type { InstanceDescriptor } from "../../../forest-world/src/world-to-3d.js";
import { forestScene } from "../render/forest-scene.js";
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

test("1.4 the same places always give the same globe spots, spread across a fixed sphere", () => {
  const spots = Array.from({ length: PLANET_CAPACITY }, (_, i) => placeOnGlobe(i + 1));
  for (let i = spots.length - 1; i >= 0; i--) {
    assert.deepEqual(placeOnGlobe(i + 1), spots[i], "reading in another order changes nothing");
    assert.ok(Math.abs(Math.hypot(spots[i]!.x, spots[i]!.y, spots[i]!.z) - 390) < 1e-9);
  }
  // These places must remain fixed across releases, not just across calls in one process.
  const anchors: [number, PlanetPoint][] = [
    [1, { x: 48.654691990951655, y: 0, z: 386.953125 }],
    [2, { x: -48.56466373969717, y: -2.9584605092037637, z: -386.953125 }],
    [3, { x: -120.25390510238827, y: 370.6843834395849, z: 15.234375 }],
    [128, { x: 77.39631358715313, y: 100.94978567140905, z: 368.671875 }],
  ];
  for (const [place, point] of anchors) assert.ok(distance(placeOnGlobe(place), point) < 1e-9, `place ${place} stays fixed`);
  for (const axis of ["x", "y", "z"] as const) {
    const firstFive = spots.slice(0, 5).map(p => p[axis]);
    assert.ok(Math.min(...firstFive) < -0.3 * PLANET_RADIUS && Math.max(...firstFive) > 0.3 * PLANET_RADIUS,
      `even a young project spreads across ${axis}`);
  }
  // A caller must not be able to move a later read by mutating the returned point.
  placeOnGlobe(1).x = 0;
  assert.deepEqual(placeOnGlobe(1), spots[0]);
  for (const invalid of [0, -1, 1.5, 129, NaN, Infinity]) assert.throws(() => placeOnGlobe(invalid), RangeError);
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

test("1.6 the first 100 historical globe places fit islands with up to 19 capabilities, including their beaches", () => {
  // Build at zero, as the globe mounts each rigid plate. Use the shipped coast operation as well
  // as descriptors: the beach reaches beyond the descriptor mesh. Nothing is drawn in a browser.
  const shores = Array.from({ length: 100 }, (_, s) => {
    const shapes = [19, s % 19]; // all large, plus every smaller size and the lone seedling
    return Math.max(...shapes.map(caps => {
      const current = story(s, caps);
      const scene = forestScene({ stories: [current], arcs: [] }, [], workStates([]));
      const cells = forestDescriptors(scene).filter((d): d is InstanceDescriptor => d.kind === "cell-ground" && d.points !== undefined);
      const coast = clipToCoast(cells, SHIPPED_COAST);
      const reach = islandReach(coast, new Map([[current.id, { x: 0, z: 0 }]])).get(current.id)!;
      assert.ok(reach > 0, `${current.id} has a shore`);
      return reach;
    }));
  });
  const spots = shores.map((_, i) => placeOnGlobe(i + 1));
  for (let i = 1; i < spots.length; i++) for (let j = 0; j < i; j++) {
    // Disjoint enclosing balls imply disjoint tangent plates, whatever their local rotation.
    assert.ok(distance(spots[i]!, spots[j]!) > shores[i]! + shores[j]!, `shores at places ${j + 1}/${i + 1} overlap`);
  }
});
