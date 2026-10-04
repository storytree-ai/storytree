/** The globe's nameplates: a story's fixed just south of its island, its capabilities' on their own land; where names overlap, one fades. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Euler, Quaternion, Vector3 } from "three";
import { turnToIsland } from "@storytree/forest";
import { plateTransform } from "@storytree/forest-world/planet";
import { territories, type Point } from "../territories/territories.js";
import { focusRotation } from "./planet-navigation.js";
import { capabilityPlates, facesEye, facing, fadedCapabilities, fadedPlates, southOnPlate, storyPlate } from "./nameplates.js";

const coast = [[{ x: 30, z: 0 }, { x: 12, z: 26 }, { x: -28, z: 14 }, { x: -22, z: -22 }, { x: 6, z: -31 }]];

test("3.4 a story's name sits at one point on its island's own plate, just south of its coast, so it turns with the island and opens below it on screen", () => {
  const radius = 400;
  const eye = new Quaternion().setFromEuler(new Euler(-0.3, 0, 0));
  for (const spot of [{ x: 0, y: 0, z: 1 }, { x: 0.3, y: 0.6, z: 0.74 }, { x: -0.5, y: -0.55, z: 0.67 }, { x: 0.05, y: 0.97, z: 0.2 }, { x: 0.9, y: 0.1, z: -0.4 }]) {
    const { position, quaternion } = plateTransform(spot, radius);
    const south = southOnPlate(quaternion);
    const plate = storyPlate(coast, south);
    const why = `island at ${JSON.stringify(spot)}`;
    // On the globe, the plate's south runs toward the south pole along the surface.
    const onGlobe = new Vector3(south.x, 0, south.z).applyQuaternion(quaternion);
    const pole = new Vector3(0, -1, 0).projectOnPlane(new Vector3(spot.x, spot.y, spot.z).normalize()).normalize();
    assert.ok(onGlobe.dot(pole) > 0.999, `${why}: the plate's south is the globe's`);
    assert.ok(plate.x * south.x + plate.z * south.z > Math.max(...coast[0]!.map(p => p.x * south.x + p.z * south.z)), `${why}: the name sits south of every point of the coast`);
    // Turned to face the eye, as a click on the island does: the name is below the island and under it.
    const rotation = focusRotation(turnToIsland(spot), eye);
    const toView = eye.clone().invert().multiply(rotation);
    const view = (p: Point) => new Vector3(p.x, 0, p.z).applyQuaternion(quaternion).add(new Vector3(...position)).applyQuaternion(toView);
    const land = coast[0]!.map(view), at = view(plate);
    assert.ok(at.y < Math.min(...land.map(p => p.y)), `${why}: the name is below every point of the coast`);
    assert.ok(at.x > Math.min(...land.map(p => p.x)) && at.x < Math.max(...land.map(p => p.x)), `${why}: and under the island, not beside it`);
  }
});

test("a story's nameplate hides once its island turns away", () => {
  const eye = new Quaternion();
  assert.equal(facesEye(new Quaternion().setFromEuler(new Euler(0.05, 0, 0)), eye), true, "an island just in front of the rim shows its plate");
  assert.equal(facesEye(new Quaternion().setFromEuler(new Euler(-0.05, 0.3, 0)), eye), false, "one just past it hides its plate");
});

test("3.32 selecting a story shows one capability nameplate per territory, named without its number, each inside its own territory, none for Unclaimed code", () => {
  const map = territories([
    { capability: "cap-a", title: "1 · Draw", lines: 300 }, { capability: "cap-b", title: "12 · Pick the land", lines: 90 },
    { lines: 60 }, { capability: "cap-c", title: "Name", lines: 25 },
  ], coast);
  const plates = capabilityPlates(map);
  assert.deepEqual(plates.map(p => [p.capability, p.title]), [["cap-a", "Draw"], ["cap-b", "Pick the land"], ["cap-c", "Name"]]);
  const inside = (p: Point, polygon: readonly Point[]) => polygon.reduce((odd, a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (a.z > p.z) !== (b.z > p.z) && p.x < a.x + (p.z - a.z) * (b.x - a.x) / (b.z - a.z) ? !odd : odd;
  }, false);
  for (const plate of plates) {
    const cell = map.cells.find(c => inside(plate, c.polygon));
    assert.equal(cell && map.territories[cell.territory]?.capability, plate.capability, `${plate.title} lies in its own territory`);
  }
});

test("3.31 where two story names overlap on screen, the less face-on one fades and neither moves; the selected name always shows, a dimmed one yields, and a name under the Sessions strip fades", () => {
  const box = (left: number, top: number) => ({ left, top, right: left + 120, bottom: top + 20 });
  // As storytree's own globe showed them: The local database's plate over Process ledger's, both islands near the rim.
  const rim = [
    { story: "local database", box: box(388, 785), facing: facing(new Quaternion().setFromEuler(new Euler(0.25, 0, 0)), new Quaternion()) },
    { story: "process ledger", box: box(410, 798), facing: facing(new Quaternion().setFromEuler(new Euler(0.9, 0, 0)), new Quaternion()) },
    { story: "library", box: box(545, 833), facing: 0.8 },
  ];
  // The local database's island is the nearer the rim (facing 0.25 to 0.78): its name fades.
  assert.deepEqual([...fadedPlates(rim)], ["local database"], "the more edge-on of an overlapping pair fades; a name clear of the others shows");
  // A chain of three, each over the next: the middle fades, and a faded name fades no other.
  const chain = [{ story: "a", box: box(0, 0), facing: 1 }, { story: "b", box: box(100, 0), facing: 0.9 }, { story: "c", box: box(200, 0), facing: 0.8 }];
  assert.deepEqual([...fadedPlates(chain)], ["b"]);
  const pair = [{ story: "a", box: box(0, 0), facing: 0.2 }, { story: "b", box: box(10, 5), facing: 0.9 }];
  assert.deepEqual([...fadedPlates(pair, "a")], ["b"], "the selected story's name shows, however edge-on");
  assert.deepEqual([...fadedPlates([{ ...pair[1]!, dimmed: true }, pair[0]!])], ["b"], "a dimmed name yields to a name in focus");
  const library = { story: "library", box: { left: 660, right: 760, top: 897, bottom: 916 }, facing: 0.7 };
  for (const selected of [undefined, "library"]) {
    assert.deepEqual([...fadedPlates([library], selected, { left: 0, right: 1440, top: 886, bottom: 960 })], ["library"], "a name under the strip fades rather than lifting");
  }
  assert.deepEqual([...fadedPlates([library], undefined, { left: 0, right: 600, top: 886, bottom: 960 })], [], "a strip narrowed beside a story panel fades no name outside its width");
});

test("3.33 where a selected island's capability names overlap, the smaller territory's fades", () => {
  const box = (left: number, top: number) => ({ left, top, right: left + 80, bottom: top + 30 });
  // As The agent link showed them: Sessions over Claims, Context readings over Settings.
  const names = [
    { capability: "sessions", box: box(500, 400), size: 9 }, { capability: "claims", box: box(530, 415), size: 14 },
    { capability: "context readings", box: box(600, 480), size: 6 }, { capability: "settings", box: box(620, 500), size: 3 },
    { capability: "hooks", box: box(400, 300), size: 1 },
  ];
  assert.deepEqual([...fadedCapabilities(names)].sort(), ["sessions", "settings"], "the larger territory's name shows; a name clear of the others shows however small");
});
