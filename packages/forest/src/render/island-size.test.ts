/** 3.18 An island's land follows its story's lines of code (ADR-0804 D3, D7), through to the ground the globe draws. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { workStates } from "@storytree/arc-surface";
import type { InstanceDescriptor } from "@storytree/forest-world";
import { buildPlanetPathways } from "@storytree/forest-world/geometry";

import { forestScene, placeOnPackedGlobe, PLANET_RADIUS } from "../index.js";
import { islandArea, LAND_PER_LINE, MIN_ISLAND_AREA } from "../planet-places/island-growth.js";
import type { StorySurvey } from "../code-survey/code-survey.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const capability = (id: string) => ({ id, title: id, dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health });
const tree = { arcs: [], stories: ["big", "small", "tiny", "unsurveyed"].map(id => ({ id, title: id, health, capabilities: [capability(`${id}1`), capability(`${id}2`), capability(`${id}3`)] })) };
const survey = (lines: number): StorySurvey => ({ files: [{ path: "src/a.ts", lines }], imports: [] });
const surveys = { big: survey(9000), small: survey(1500), tiny: survey(20) };

/** The land a plate's ground descriptors draw, in ground units²: the sum of its cells' rings. */
function drawnArea(descriptors: readonly { kind: string; points?: readonly { x: number; z: number }[] }[]): number {
  let area = 0;
  for (const d of descriptors) {
    if (d.kind !== "cell-ground" || d.points === undefined) continue;
    let twice = 0;
    d.points.forEach((p, i) => { const q = d.points![(i + 1) % d.points!.length]!; twice += p.x * q.z - q.x * p.z; });
    area += Math.abs(twice) / 2;
  }
  return area;
}

test("3.18 a surveyed island's area follows its lines, a tiny story keeps a floor, and an unsurveyed island keeps its capability ratio", () => {
  assert.ok(LAND_PER_LINE > 0 && MIN_ISLAND_AREA > 0);
  assert.equal(islandArea(9000), 9000 * LAND_PER_LINE);
  assert.ok(islandArea(9000) > islandArea(1500), "more lines, more land");
  assert.equal(islandArea(20), MIN_ISLAND_AREA);

  const scene = forestScene(tree, [], workStates([]), surveys);
  const areaOf = (story: string) => scene.islands.find(i => i.story === story)!.area;
  assert.equal(areaOf("big"), islandArea(9000));
  assert.equal(areaOf("small"), islandArea(1500));
  assert.equal(areaOf("tiny"), MIN_ISLAND_AREA);
  assert.equal(areaOf("unsurveyed"), undefined, "no survey, no area: the capability ratio stands");

  const spots = new Map(tree.stories.map((s, i) => [s.id, placeOnPackedGlobe(i + 1)]));
  const plates = buildPlanetPathways(scene, spots, PLANET_RADIUS).plates;
  const drawn = (story: string) => drawnArea(plates.get(story)!.descriptors as InstanceDescriptor[]);
  for (const story of ["big", "small", "tiny"]) assert.ok(Math.abs(drawn(story) - areaOf(story)! ) < 1e-3 * areaOf(story)!, `${story} draws the land its lines give it`);
  assert.ok(drawn("big") > drawn("small") && drawn("small") > drawn("tiny"), "drawn land follows lines, though each has three capabilities");
  assert.ok(Math.abs(drawn("unsurveyed") - 3 * MIN_ISLAND_AREA) < 1e-3 * 3 * MIN_ISLAND_AREA, "an unsurveyed island is its capabilities times the ratio; the floor is one capability's worth");
  assert.ok(Math.abs(drawn("tiny") - MIN_ISLAND_AREA) < 1e-3 * MIN_ISLAND_AREA);
});
