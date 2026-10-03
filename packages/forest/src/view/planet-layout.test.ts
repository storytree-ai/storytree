/** 1.7 / 1.8 on the real coasts: the globe's layout leaves every pair of drawn coasts clear, moving only what it must. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";

import { workStates } from "@storytree/arc-surface";
import { buildPlanetPathways, plateTransform } from "@storytree/forest-world/geometry";
import { forestScene, PLANET_RADIUS, SEA_GAP, storyNodes } from "@storytree/forest";

import { planetLayout } from "./planet-navigation.js";
import type { StorySurvey } from "@storytree/map";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const ids = ["story_05e45963ca9f", "story_16ac26dfa5d6", "story_78b33d16d0b6", "story_20549f1d48af", "story_be32e99ed54f", "story_4c04d95d52a8", "story_69d0ee10bbe7", "story_eb7d623fb9c8"];
const counts = [8, 4, 5, 11, 7, 4, 6, 13];
// The last story depends on the first, so it sits alone in the row above the other seven.
const tree = { arcs: [], stories: ids.map((id, i) => ({ id, title: id, health, capabilities: Array.from({ length: counts[i]! }, (_, c) => ({ id: `${id}-${c}`, title: `Capability ${c}`, dependsOn: i === 7 && c === 0 ? [`${ids[0]}-0`] : [], proposed: true, status: "proposed" as const, contracts: [], health })) })) };
const places = new Map(storyNodes(tree, []).map(({ id, place }) => [id, place]));
const survey = (lines: number): StorySurvey => ({ files: [{ path: "src/a.ts", lines }], imports: [] });

/** The nearest two drawn coasts come, in ground units, over every pair. */
function nearestCoasts(scene: ReturnType<typeof forestScene>, layout: ReturnType<typeof planetLayout>): number {
  const plates = buildPlanetPathways(scene, layout.spots, layout.radius).plates;
  const coasts = scene.islands.map(island => {
    const spot = layout.spots.get(island.story)!;
    const { position, quaternion } = plateTransform(spot, layout.radius);
    return plates.get(island.story)!.coast.flat().map(p => new Vector3(p.x, 0, p.z).applyQuaternion(quaternion).add(new Vector3(...position)));
  });
  let nearest = Infinity;
  for (let i = 0; i < coasts.length; i++) for (let j = i + 1; j < coasts.length; j++)
    for (const a of coasts[i]!) for (const b of coasts[j]!) nearest = Math.min(nearest, a.distanceTo(b));
  return nearest;
}

test("1.7 an island that outgrows its neighbours' room moves them along its row, and every drawn coast stays clear; islands in other rows stay where they were", () => {
  const before = planetLayout(forestScene(tree, [], workStates([])), places);
  assert.equal(before.radius, PLANET_RADIUS, "the seed's islands at their capability sizes fit as placed");
  const anchor = (story: string) => { const p = before.spots.get(story)!; return new Vector3(p.x, p.y, p.z); };

  const scene = forestScene(tree, [], workStates([]), { [ids[0]!]: survey(12000) });
  const layout = planetLayout(scene, places);
  assert.equal(layout.radius, PLANET_RADIUS, "nudging alone made the room");
  const moved = (id: string) => new Vector3(layout.spots.get(id)!.x, layout.spots.get(id)!.y, layout.spots.get(id)!.z).angleTo(anchor(id));
  assert.ok(moved(ids[1]!) > 0 && moved(ids[0]!) > 0, "the big island and its neighbour give way");
  assert.equal(moved(ids[7]!), 0, "an island in another row does not move");
  assert.ok(nearestCoasts(scene, layout) >= SEA_GAP - 1, "the drawn coasts keep the sea between them");
});

test("1.8 when the code no longer fits the globe, the globe and its islands' coasts grow apart", () => {
  const surveys = Object.fromEntries(ids.map(id => [id, survey(50000)]));
  const scene = forestScene(tree, [], workStates([]), surveys);
  const layout = planetLayout(scene, places);
  assert.ok(layout.radius > PLANET_RADIUS, "the radius grew");
  assert.ok(nearestCoasts(scene, layout) >= SEA_GAP - 1, "and nothing overlaps");
});

test("1.7 a change on one island keeps every unmoved island's spot as it was, so its plate is not drawn again (ADR-0836 D1)", () => {
  const before = planetLayout(forestScene(tree, [], workStates([])), places);
  const after = planetLayout(forestScene(tree, [], workStates([]), { [ids[7]!]: survey(40) }), places, before);
  assert.equal(after.spots.get(ids[0]!), before.spots.get(ids[0]!));
  const same = planetLayout(forestScene(tree, [], workStates([])), places, before);
  assert.equal(same.spots, before.spots, "nothing moved: the same spots");
});

test("3.28 a plan still growing, framed by its full plan, keeps every island where the full plan puts it and the full plan's radius", () => {
  const full = forestScene(tree, [], workStates([]));
  // Three of the eight stories, the last of them alone in the row above: the frame still holds two rows.
  const growing = forestScene({ ...tree, stories: tree.stories.filter((_, i) => i < 2 || i === 7) }, [], workStates([]));
  const whole = planetLayout(full, places);
  const framed = planetLayout(growing, places, undefined, full);
  assert.equal(framed.radius, whole.radius);
  assert.deepEqual([...framed.spots.keys()], [ids[0], ids[1], ids[7]], "only the growing plan's islands are drawn");
  for (const [story, spot] of framed.spots) assert.deepEqual(spot, whole.spots.get(story), `${story} sits where the full plan puts it`);
  assert.notDeepEqual(planetLayout(growing, places).spots.get(ids[0]!), whole.spots.get(ids[0]!), "unframed, the growing plan would sit elsewhere");
});
