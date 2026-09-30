/** Capability 3's planet book: a failing island is faced at opening, or reachable from its rim marker. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { edgeMarkers, openingTurn, turnToIsland, type FacingIsland, type GlobeDirection, type GlobeTurn } from "./never-hidden.js";

const FRONT = { x: 0, y: 0, z: 1 };
const BACK = { x: 0, y: 0, z: -1 };
const island = (story: string, spot: GlobeDirection, ...forms: FacingIsland["trees"][number]["form"][]): FacingIsland => ({
  story, spot, trees: forms.map((form) => ({ form })),
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

test("3.11 the globe opens facing a failing island, even when its other trees are healthy or being built", () => {
  const healthy = island("healthy", FRONT, "green");
  const failing = island("failing", { x: 2, y: -1, z: -3 }, "green", "dead", "seedling");
  facesFront(failing.spot, openingTurn([healthy, failing]));
  // Opposite failures cannot both face the eye: keep the first, rather than averaging to no direction.
  const opposite = island("also-failing", { x: -2, y: 1, z: 3 }, "dead");
  facesFront(failing.spot, openingTurn([healthy, failing, opposite]));
});

test("3.11 each failing island behind the globe gets a rim marker whose turn brings it to the front", () => {
  const failing = island("failing", { x: 3, y: 4, z: -12 }, "dead", "dead");
  const healthy = island("healthy", BACK, "green", "pale", "seedling");
  const markers = edgeMarkers([failing, healthy], FRONT);
  assert.equal(markers.length, 1, "one marker per failing story, not per dead tree");
  const marker = markers[0]!;
  assert.equal(marker.story, failing.story);
  close(marker.at.x, 0.6);
  close(marker.at.y, 0.8);
  facesFront(failing.spot, marker.turn);
  assert.deepEqual(edgeMarkers([failing], failing.spot), [], "the chosen marker goes when its island is in front");

  const centredBack = edgeMarkers([island("opposite", BACK, "dead")], FRONT)[0]!;
  assert.deepEqual(centredBack.at, { x: 0, y: 1 }, "straight behind has a stable marker at the top, not an undefined bearing");
  facesFront(BACK, centredBack.turn);
});

test("3.11 turning the view removes front-side markers and places hidden ones on the correct rim, including at a pole", () => {
  const failing = island("failing", { x: 3, y: 4, z: -12 }, "dead");
  assert.deepEqual(edgeMarkers([failing], { x: 1, y: 0, z: 0 }), [], "failing but in front needs no marker");
  const marker = edgeMarkers([failing], { x: -1, y: 0, z: 0 })[0]!;
  close(marker.at.x, -12 / Math.hypot(12, 4));
  close(marker.at.y, 4 / Math.hypot(12, 4));

  const north = { x: 0, y: 1, z: 0 };
  const south = island("south", { x: 0, y: -1, z: 0 }, "dead");
  const polar = edgeMarkers([south], north)[0]!;
  assert.deepEqual(polar.at, { x: 0, y: 1 });
  facesFront(south.spot, polar.turn);
  assert.deepEqual(edgeMarkers([south], south.spot), []);
  assert.equal(edgeMarkers([island("on-rim", FRONT, "dead")], north).length, 1, "an edge-on island still has a marker");
});

test("without failures the first story is faced, and an empty globe keeps its neutral turn", () => {
  const first = island("first", { x: -5, y: 2, z: 1 }, "seedling", "pale", "green");
  facesFront(first.spot, openingTurn([first, island("second", FRONT, "green")]));
  facesFront(first.spot, turnToIsland(first.spot));
  assert.deepEqual(openingTurn([]), { yaw: 0, pitch: 0 });
  assert.deepEqual(edgeMarkers([], FRONT), []);
});
