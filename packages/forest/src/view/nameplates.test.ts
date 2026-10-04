/** The globe's nameplates: a story's below its island whatever the turn, its capabilities' on their own land. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Euler, Quaternion, Vector3 } from "three";
import { turnToIsland } from "@storytree/forest";
import { plateTransform } from "@storytree/forest-world/planet";
import { territories, type Point } from "../territories/territories.js";
import { dragTurn, focusRotation } from "./planet-navigation.js";
import { capabilityPlates, facesEye, facing, furthestDrop, MAX_DROP, PLATE_STEP_GAP, screenOnPlate, settlePlates, storyPlate, type ShownPlate } from "./nameplates.js";

const coast = [[{ x: 30, z: 0 }, { x: 12, z: 26 }, { x: -28, z: 14 }, { x: -22, z: -22 }, { x: 6, z: -31 }]];

test("a story's nameplate sits just below its island on screen, whatever the globe's spin and tilt", () => {
  const radius = 400;
  const eye = new Quaternion().setFromEuler(new Euler(-0.3, 0, 0));
  for (const spot of [{ x: 0, y: 0, z: 1 }, { x: 0.3, y: 0.6, z: 0.74 }, { x: -0.5, y: -0.55, z: 0.67 }, { x: 0.05, y: 0.97, z: 0.2 }, { x: 0.9, y: 0.1, z: -0.4 }]) {
    const { position, quaternion } = plateTransform(spot, radius);
    const facing = turnToIsland(spot);
    for (const turn of [facing, dragTurn(facing, { x: 60, y: 0 }, 800), dragTurn(facing, { x: -40, y: 50 }, 800), dragTurn(facing, { x: 20, y: -45 }, 800), dragTurn(facing, { x: 160, y: 90 }, 800)]) {
      const rotation = focusRotation(turn, eye);
      const toView = eye.clone().invert().multiply(rotation);
      const plate = storyPlate(coast, screenOnPlate(rotation.clone().multiply(quaternion), eye));
      const view = (p: Point) => new Vector3(p.x, 0, p.z).applyQuaternion(quaternion).add(new Vector3(...position)).applyQuaternion(toView);
      const why = `island at ${JSON.stringify(spot)}, turned ${JSON.stringify(turn)}`;
      const land = coast[0]!.map(view), at = view(plate);
      assert.ok(at.y < Math.min(...land.map(p => p.y)), `${why}: the plate is below every point of the coast`);
      assert.ok(at.x > Math.min(...land.map(p => p.x)) && at.x < Math.max(...land.map(p => p.x)), `${why}: and under the island, not beside it`);
    }
  }
});

test("a story's nameplate hides once its island turns away, and never leaves the globe, even for an island edge-on at the rim", () => {
  const eye = new Quaternion();
  // Edge on at a slant, as at the rim off to one side: the screen barely runs down the plate, and skewed across it.
  const plate = new Quaternion().setFromEuler(new Euler(0.05, 0, Math.PI / 4));
  const at = storyPlate(coast, screenOnPlate(plate, eye), 100);
  assert.ok(Math.hypot(at.x, at.z) <= 100 + 1e-9, `the plate stays within reach of its island: ${JSON.stringify(at)}`);
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

test("no two story nameplates overlap on screen: where two would, one steps down just below the other, the least in all, and only one that would step too far is hidden", () => {
  const box = (left: number, top: number) => ({ left, top, right: left + 120, bottom: top + 20 });
  // As storytree's own globe shows them: The local database's plate over Process ledger's, both islands near the rim.
  const { drops, hidden } = settlePlates([
    { story: "local database", box: box(388, 785), facing: facing(new Quaternion().setFromEuler(new Euler(0.25, 0, 0)), new Quaternion()) },
    { story: "process ledger", box: box(410, 798), facing: facing(new Quaternion().setFromEuler(new Euler(0.9, 0, 0)), new Quaternion()) },
    { story: "library", box: box(545, 833), facing: 0.8 },
  ]);
  assert.deepEqual([...hidden], [], "nothing is hidden");
  assert.deepEqual([...drops], [["process ledger", 785 + 20 + PLATE_STEP_GAP - 798]], "the one that need step less steps just below the other; a plate clear of the others stays");
  // Five small islands in a row, plates a slot and a half wide: the more edge-on step, and they zigzag in two lines, not a staircase.
  const row = settlePlates([0, 1, 2, 3, 4].map(i => ({ story: `r${i}`, box: { left: i * 64 - 45, right: i * 64 + 45, top: 0, bottom: i === 4 ? 50 : 34 }, facing: 1 - Math.abs(i - 2) / 20 })));
  assert.deepEqual([...row.drops.keys()].sort(), ["r1", "r3"], "every other plate steps down once");
  const chosen = settlePlates([{ story: "a", box: box(0, 0), facing: 0.2 }, { story: "b", box: box(10, 5), facing: 0.9 }], "a");
  assert.deepEqual([...chosen.drops.keys()], ["b"], "the selected story's plate never steps");
  // A crowd stacked deeper than MAX_DROP: the plate that would have to step past it is hidden.
  const crowd = Array.from({ length: Math.ceil(MAX_DROP / 20) + 2 }, (_, i) => ({ story: `s${i}`, box: box(0, 0), facing: 1 - i / 100 }));
  const settled = settlePlates(crowd);
  assert.ok(settled.hidden.size > 0 && [...settled.drops.values()].every(drop => drop <= MAX_DROP), "past the furthest step, a plate hides");
});

test("3.4 / 7.17: near-side names clear the Sessions strip and each other as the strip changes", () => {
  const library = { story: "library", box: { left: 660, right: 760, top: 897, bottom: 916 }, facing: 0.7 };
  const neighbour = { story: "neighbour", box: { left: 650, right: 750, top: 860, bottom: 879 }, facing: 0.8 };
  for (const top of [886, 923, 620]) {
    const strip = { left: 0, right: 1440, top, bottom: 960 };
    const plates = [library, neighbour];
    const { drops, hidden } = settlePlates(plates, "library", strip);
    assert.equal(hidden.size, 0, "strip clearance keeps both names readable, including the selected name");
    const boxes = plates.map(({ story, box }) => ({ top: box.top + (drops.get(story) ?? 0), bottom: box.bottom + (drops.get(story) ?? 0) }));
    assert.ok(boxes.every(box => box.bottom <= top - PLATE_STEP_GAP), "the whole name clears the strip");
    assert.ok(boxes[0]!.bottom <= boxes[1]!.top || boxes[1]!.bottom <= boxes[0]!.top, "lifting names does not stack them on each other");
  }
  assert.equal(settlePlates([library], undefined, { left: 0, right: 600, top: 886, bottom: 960 }).drops.size, 0,
    "a strip narrowed beside a story panel does not lift a name outside its width");
  assert.equal(settlePlates([library]).drops.size, 0, "removing the strip restores the name's natural position");
});

test("3.31 on a phone's small globe each name on show sits by its own island, the names in focus first; a desktop's big globe settles as before", () => {
  // The shop's nine names where they hang at the cut to its three teaching islands (website step start-small), measured in the
  // browser at 390 x 844 (globe radius about 173 px) and 1440 x 900 (about 430 px): [title, left, top, right, bottom, facing, dimmed].
  const plates = (rows: [string, number, number, number, number, number, number][]): ShownPlate[] =>
    rows.map(([story, left, top, right, bottom, facing, dimmed]) => ({ story, box: { left, top, right, bottom }, facing, dimmed: dimmed === 1 }));
  const phone = plates([["Sign in and see the products", 139, 125.1, 251, 173.6, 0.637, 1],
    ["Browse products and pick them", 121.6, 208.2, 233.6, 256.7, 0.951, 0],
    ["Review the cart and use the menu", 139, 257.8, 251, 306.2, 1, 0],
    ["Check out", 138.9, 300.2, 221.9, 318.5, 0.953, 0],
    ["Sign up for an account", 156.4, 202.9, 268.4, 236.3, 0.951, 1],
    ["See my orders", 159.3, 341, 269, 359.3, 0.823, 1],
    ["Search products", 139, 159.6, 251, 193, 0.833, 1],
    ["Review products", 153.6, 296.7, 265.6, 330, 0.953, 1],
    ["Manage stock and prices", 119.8, 334, 231.8, 367.3, 0.823, 1]]);
  const reach = 173 / 3;
  const { drops, hidden } = settlePlates(phone, undefined, undefined, furthestDrop(173));
  const far = phone.filter(({ story }) => !hidden.has(story)).map(({ story }) => [story, Math.abs(drops.get(story) ?? 0)] as const);
  assert.deepEqual(far.filter(([, drop]) => drop > reach), [], "no name on show steps further from its island than a third of the globe's radius");
  for (const story of ["Browse products and pick them", "Review the cart and use the menu", "Check out"]) {
    assert.ok(!hidden.has(story) && Math.abs(drops.get(story) ?? 0) <= 12, `${story}, in focus, is shown by its own island`);
  }
  const desktop = plates([["Sign in and see the products", 952, 143.5, 1064, 192, 0.637, 1],
    ["Browse products and pick them", 905.1, 368, 1017.1, 416.4, 0.951, 0],
    ["Review the cart and use the menu", 952, 501.9, 1064, 550.3, 1, 0],
    ["Check out", 927.1, 610.8, 1010.1, 629.1, 0.953, 0],
    ["Sign up for an account", 999, 353.7, 1111, 387.1, 0.951, 1],
    ["See my orders", 1004.8, 721, 1114.6, 739.3, 0.823, 1],
    ["Search products", 952, 236.7, 1064, 270.1, 0.833, 1],
    ["Review products", 991.4, 607, 1103.4, 640.3, 0.953, 1],
    ["Manage stock and prices", 900.2, 707.8, 1012.2, 741.1, 0.823, 1]]);
  assert.equal(furthestDrop(430), MAX_DROP, "a big globe keeps the furthest step");
  assert.deepEqual(settlePlates(desktop, undefined, undefined, furthestDrop(430)), settlePlates(desktop.map(({ dimmed, ...plate }) => plate)),
    "on a desktop's globe the names settle as they did before focus counted");
});
