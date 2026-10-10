import assert from "node:assert/strict";
import test from "node:test";
import { Euler, Quaternion, Vector3 } from "three";
import type { FacingIsland } from "@storytree/forest";
import { asksForHome, miniGlobe } from "./mini-globe.js";
import { dragTurn, focusRotation } from "./planet-navigation.js";

const islands: FacingIsland[] = [
  { story: "front", spot: { x: 0, y: 0, z: 5 }, trees: [] },
  { story: "east", spot: { x: 5, y: 0, z: 0 }, trees: [] },
  { story: "north", spot: { x: 0, y: 3, z: 4 }, trees: [] },
];
const near = (actual: number, expected: number, why: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${why}: ${actual} != ${expected}`);

test("3.36 the mini globe shows the land where it lies, both poles, and a mark on the face on show that follows every spin and tilt", () => {
  const home = { yaw: 0, pitch: 0 };
  const opened = miniGlobe(islands, home, home);
  near(opened.facing.x, 0, "at home the mark sits at the centre"); near(opened.facing.y, 0, "at home the mark sits at the centre");
  assert.equal(opened.facing.front, true);
  assert.deepEqual(opened.north, { x: 0, y: 1, front: true }, "north at the top");
  near(opened.south.y, -1, "south at the bottom"); near(opened.south.x, 0, "south straight below north");
  const land = new Map(opened.islands.map(i => [i.story, i]));
  near(land.get("front")!.x, 0, "the island facing home sits at the centre");
  near(land.get("east")!.x, 1, "an island a quarter round sits on the rim");
  near(land.get("north")!.y, 0.6, "a northern island sits up the globe");

  // The mark is the point of the main globe facing the eye, wherever the eye looks from.
  const eye = new Quaternion().setFromEuler(new Euler(-0.87, 0, 0));
  let turn = home;
  for (const drag of [{ x: 200, y: 0 }, { x: 0, y: 150 }, { x: -700, y: -90 }, { x: 400, y: 0 }]) {
    turn = dragTurn(turn, drag, 800);
    const mini = miniGlobe(islands, home, turn);
    const local = new Vector3(0, 0, 1).applyQuaternion(eye).applyQuaternion(focusRotation(turn, eye).invert());
    near(mini.facing.x, local.x, `after a drag of ${drag.x}, ${drag.y}, across`);
    near(mini.facing.y, local.y, `after a drag of ${drag.x}, ${drag.y}, up`);
    assert.equal(mini.facing.front, local.z >= -1e-9);
    assert.deepEqual(mini.islands, opened.islands, "the land stays where it lies on the mini globe");
  }
  const halfRound = miniGlobe(islands, home, { yaw: Math.PI, pitch: 0 });
  assert.equal(halfRound.facing.front, false, "spun half round, the mark is on the far side");
  const tilted = miniGlobe(islands, home, { yaw: 0, pitch: 0.5 });
  assert.ok(tilted.facing.y > 0, "tilted toward the north pole, the mark climbs toward it");
});

test("3.37 only the Home key asks for home: never a double-click, and never Home typed into a field", () => {
  assert.equal(asksForHome({ type: "keydown", key: "Home", target: { tagName: "CANVAS" } }), true);
  assert.equal(asksForHome({ type: "dblclick" }), false);
  assert.equal(asksForHome({ type: "keydown", key: "End" }), false);
  assert.equal(asksForHome({ type: "keydown", key: "Home", target: { tagName: "INPUT" } }), false);
  assert.equal(asksForHome({ type: "keydown", key: "Home", target: { tagName: "DIV", isContentEditable: true } }), false);
});
