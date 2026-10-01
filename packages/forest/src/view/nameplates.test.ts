/** The globe's nameplates: a story's below its island whatever the turn, its capabilities' on their own land. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Euler, Quaternion, Vector3 } from "three";
import { turnToIsland } from "@storytree/forest";
import { plateTransform } from "@storytree/forest-world/planet";
import { territories, type Point } from "../territories/territories.js";
import { dragTurn, focusRotation } from "./planet-navigation.js";
import { capabilityPlates, storyPlate } from "./nameplates.js";

const coast = [[{ x: 30, z: 0 }, { x: 12, z: 26 }, { x: -28, z: 14 }, { x: -22, z: -22 }, { x: 6, z: -31 }]];

test("a story's nameplate sits just below its island on screen, whatever the globe's spin and tilt", () => {
  const radius = 400;
  const eye = new Quaternion().setFromEuler(new Euler(-0.3, 0, 0));
  for (const spot of [{ x: 0, y: 0, z: 1 }, { x: 0.3, y: 0.6, z: 0.74 }, { x: -0.5, y: -0.55, z: 0.67 }, { x: 0.05, y: 0.97, z: 0.2 }, { x: 0.9, y: 0.1, z: -0.4 }]) {
    const plate = storyPlate(coast, spot);
    const { position, quaternion } = plateTransform(spot, radius);
    const facing = turnToIsland(spot);
    for (const turn of [facing, dragTurn(facing, { x: 60, y: 0 }, 800), dragTurn(facing, { x: -40, y: 50 }, 800), dragTurn(facing, { x: 20, y: -45 }, 800)]) {
      const toView = eye.clone().invert().multiply(focusRotation(turn, eye));
      const view = (p: Point) => new Vector3(p.x, 0, p.z).applyQuaternion(quaternion).add(new Vector3(...position)).applyQuaternion(toView);
      const why = `island at ${JSON.stringify(spot)}, turned ${JSON.stringify(turn)}`;
      const land = coast[0]!.map(view), at = view(plate);
      assert.ok(at.y < Math.min(...land.map(p => p.y)), `${why}: the plate is below every point of the coast`);
      assert.ok(at.x > Math.min(...land.map(p => p.x)) && at.x < Math.max(...land.map(p => p.x)), `${why}: and under the island, not beside it`);
    }
  }
});

test("selecting a story shows one capability nameplate per territory, each inside its own territory, none for Unclaimed code", () => {
  const map = territories([
    { capability: "cap-a", title: "1 · Draw", lines: 300 }, { capability: "cap-b", title: "2 · Pick", lines: 90 },
    { lines: 60 }, { capability: "cap-c", title: "3 · Name", lines: 25 },
  ], coast);
  const plates = capabilityPlates(map);
  assert.deepEqual(plates.map(p => [p.capability, p.title]), [["cap-a", "1 · Draw"], ["cap-b", "2 · Pick"], ["cap-c", "3 · Name"]]);
  const inside = (p: Point, polygon: readonly Point[]) => polygon.reduce((odd, a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (a.z > p.z) !== (b.z > p.z) && p.x < a.x + (p.z - a.z) * (b.x - a.x) / (b.z - a.z) ? !odd : odd;
  }, false);
  for (const plate of plates) {
    const cell = map.cells.find(c => inside(plate, c.polygon));
    assert.equal(cell && map.territories[cell.territory]?.capability, plate.capability, `${plate.title} lies in its own territory`);
  }
});
