/** Capability 3's planet book: a failing island is faced at opening, or reachable from its rim marker. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { edgeMarkers, openingTurn, turnToIsland, type FacingIsland, type GlobeDirection, type GlobeTurn } from "./never-hidden.js";

const FRONT = { x: 0, y: 0, z: 1 };
const BACK = { x: 0, y: 0, z: -1 };
const island = (story: string, spot: GlobeDirection, ...words: NonNullable<FacingIsland["trees"][number]["status"]>[]): FacingIsland => ({
  story, spot, trees: words.map((status) => ({ status })),
});

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be ${expected}`);
}

/** Apply the public turn convention to the island's normal, independently of marker placement. */
function facesFront(spot: GlobeDirection, { yaw, pitch }: GlobeTurn): void {
  const { x, y, z } = spot;
  const turnedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  close(x * Math.cos(yaw) + z * Math.sin(yaw), 0);
  close(y * Math.cos(pitch) - turnedZ * Math.sin(pitch), 0);
  close(y * Math.sin(pitch) + turnedZ * Math.cos(pitch), Math.hypot(x, y, z));
}

/** The opening is level: spun so `spot` sits on the screen's middle line, in front, with no tilt. */
function spunLevelTo(spot: GlobeDirection, { yaw, pitch }: GlobeTurn): void {
  const { x, z } = spot;
  assert.equal(pitch, 0, "no tilt");
  close(x * Math.cos(yaw) + z * Math.sin(yaw), 0);
  close(-x * Math.sin(yaw) + z * Math.cos(yaw), Math.hypot(x, z));
}

test("3.11 the globe opens level, spun to a failing island, even when its other trees are healthy or being built", () => {
  const healthy = island("healthy", FRONT, "healthy");
  const failing = island("failing", { x: 2, y: -1, z: -3 }, "healthy", "unhealthy", "proposed");
  spunLevelTo(failing.spot, openingTurn([healthy, failing]));
  // Opposite failures cannot both face the eye: keep the first, rather than averaging to no direction.
  const opposite = island("also-failing", { x: -2, y: 1, z: 3 }, "unhealthy");
  spunLevelTo(failing.spot, openingTurn([healthy, failing, opposite]));
  // A failing island 40 degrees north gets its spin and no tilt: every row stays a level line.
  const north40 = island("north", { x: Math.cos(0.7) * Math.cos(40 * Math.PI / 180), y: Math.sin(40 * Math.PI / 180), z: Math.sin(0.7) * Math.cos(40 * Math.PI / 180) }, "unhealthy");
  spunLevelTo(north40.spot, openingTurn([healthy, north40]));
});

test("3.11 each failing island behind the globe gets a rim marker whose turn brings it to the front", () => {
  const failing = island("failing", { x: 3, y: 4, z: -12 }, "unhealthy", "unhealthy");
  const healthy = island("healthy", BACK, "healthy", "untested", "proposed");
  const markers = edgeMarkers([failing, healthy], FRONT);
  assert.equal(markers.length, 1, "one marker per failing story, not per unhealthy capability");
  const marker = markers[0]!;
  assert.equal(marker.story, failing.story);
  close(marker.at.x, 0.6);
  close(marker.at.y, 0.8);
  facesFront(failing.spot, marker.turn);
  assert.deepEqual(edgeMarkers([failing], failing.spot), [], "the chosen marker goes when its island is in front");

  const centredBack = edgeMarkers([island("opposite", BACK, "unhealthy")], FRONT)[0]!;
  assert.deepEqual(centredBack.at, { x: 0, y: 1 }, "straight behind has a stable marker at the top, not an undefined bearing");
  facesFront(BACK, centredBack.turn);
});

test("3.11 turning the view removes front-side markers and places hidden ones on the correct rim, including at a pole", () => {
  const failing = island("failing", { x: 3, y: 4, z: -12 }, "unhealthy");
  assert.deepEqual(edgeMarkers([failing], { x: 1, y: 0, z: 0 }), [], "failing but in front needs no marker");
  const marker = edgeMarkers([failing], { x: -1, y: 0, z: 0 })[0]!;
  close(marker.at.x, -12 / Math.hypot(12, 4));
  close(marker.at.y, 4 / Math.hypot(12, 4));

  const north = { x: 0, y: 1, z: 0 };
  const south = island("south", { x: 0, y: -1, z: 0 }, "unhealthy");
  const polar = edgeMarkers([south], north)[0]!;
  assert.deepEqual(polar.at, { x: 0, y: 1 });
  facesFront(south.spot, polar.turn);
  assert.deepEqual(edgeMarkers([south], south.spot), []);
  assert.equal(edgeMarkers([island("on-rim", FRONT, "unhealthy")], north).length, 1, "an edge-on island still has a marker");
});

test("without failures the globe opens level, spun to the islands' middle, or the first story where they ring the globe; an empty globe keeps its neutral turn", () => {
  const low = island("low", { x: 0, y: -2, z: 3 }, "proposed"), high = island("high", { x: 0, y: 2, z: 3 }, "healthy");
  facesFront(FRONT, openingTurn([low, high]));
  // A middle south of the equator is spun to, never tilted to.
  const south = [island("a", { x: 1, y: -2, z: 2 }, "healthy"), island("b", { x: 2, y: -1, z: 2 }, "proposed")];
  spunLevelTo({ x: 3, y: -3, z: 4 }, openingTurn(south));
  const first = island("first", { x: -5, y: 2, z: 1 }, "proposed", "untested", "healthy");
  spunLevelTo(first.spot, openingTurn([first, island("opposite", { x: 5, y: -2, z: -1 }, "healthy")]));
  facesFront(first.spot, turnToIsland(first.spot));
  assert.deepEqual(openingTurn([]), { yaw: 0, pitch: 0 });
  assert.deepEqual(edgeMarkers([], FRONT), []);
});
