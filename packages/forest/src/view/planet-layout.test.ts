/** 3.28 on the glass sheet: a host that changes layout moves its islands once, eased. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";

import { workStates } from "@storytree/arc-surface";
import { sheetPoint } from "@storytree/forest-world/planet";
import { forestScene, storyNodes } from "@storytree/forest";

import { movingSpots } from "./planet-navigation.js";
import { sheetLayout } from "./sheet-navigation.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const ids = ["story_05e45963ca9f", "story_16ac26dfa5d6", "story_78b33d16d0b6", "story_20549f1d48af", "story_be32e99ed54f", "story_4c04d95d52a8", "story_69d0ee10bbe7", "story_eb7d623fb9c8"];
const counts = [4, 2, 3, 6, 4, 2, 3, 7];
// The last story depends on the first, so it sits alone in the row above the other seven.
const tree = { arcs: [], stories: ids.map((id, i) => ({ id, title: id, health, capabilities: Array.from({ length: counts[i]! }, (_, c) => ({ id: `${id}-${c}`, title: `Capability ${c}`, dependsOn: i === 7 && c === 0 ? [`${ids[0]}-0`] : [], proposed: true, status: "proposed" as const, contracts: [], health })) })) };
const places = new Map(storyNodes(tree, []).map(({ id, place }) => [id, place]));

test("3.28 a host that changes layout moves each island once on the glass sheet, eased from its old spot to its new; an island new to the layout stands at its spot", () => {
  const full = forestScene(tree, [], workStates([]));
  const growing = forestScene({ ...tree, stories: tree.stories.filter((_, i) => i < 2 || i === 7) }, [], workStates([]));
  const before = sheetLayout(growing, places).spots, after = sheetLayout(full, places).spots;
  const moved = ids[0]!, apart = (a: { x: number; y: number; z: number }, b: typeof a) => { const p = sheetPoint(a), q = sheetPoint(b); return Math.hypot(p.x - q.x, p.y - q.y); };
  assert.ok(apart(before.get(moved)!, after.get(moved)!) > 1, "the island has somewhere to go");
  assert.deepEqual(movingSpots(before, after, 0).get(moved), before.get(moved));
  assert.deepEqual(movingSpots(before, after, 1), after, "the move ends on the new layout");
  const whole = apart(before.get(moved)!, after.get(moved)!);
  const part = (progress: number) => apart(before.get(moved)!, movingSpots(before, after, progress).get(moved)!) / whole;
  assert.ok(Math.abs(part(.5) - .5) < 1e-3 && part(.2) < .2 && part(.8) > .8, "eased in and out");
  for (const story of ids.slice(2, 7)) assert.deepEqual(movingSpots(before, after, .5).get(story), after.get(story), `${story} is new, so it stands at its spot`);
});
