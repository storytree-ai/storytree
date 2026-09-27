/** Capability 1's globe drawing: shelf depths and the no-shelf pool (ADR-0658). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { globePoints, knowledge, underShelves } from "@storytree/knowledge-core";
import { History } from "../testing/changes.js";

const radius = 218;
const spots = new Map([["north", { x: 0, y: 1, z: 0 }], ["front", { x: 0, y: 0, z: 1 }]]);
const length = (at: { x: number; y: number; z: number }) => Math.hypot(at.x, at.y, at.z);

test("1.5 the globe draws each placed artifact once beneath its home island at its longest-chain depth", () => {
  const history = new History().story("north").story("front").capability("cap", "front")
    .decision("deep")
    .decision("middle", { links: ["deep"] })
    .decision("cover", { frontCoverOf: "cap", links: ["middle", "deep"] })
    .decision("other", { frontCoverOf: "north", links: ["deep"] })
    .decision("old", { frontCoverOf: "cap" })
    .decision("replacement", { frontCoverOf: "cap", supersedes: ["old"] })
    .decision("proposal", { status: "proposed", frontCoverOf: "north" })
    .decision("retired", { frontCoverOf: "north" }).retire("retired");
  const core = underShelves(history.changes, knowledge(history.changes));
  const points = globePoints(core, spots, radius);
  assert.deepEqual(points.map(point => point.id).sort(), ["cover", "deep", "middle", "other", "replacement"]);
  assert.equal(new Set(points.map(point => point.id)).size, points.length);
  for (const point of points) {
    const placement = core.placed.get(point.id)!;
    assert.equal(point.home, placement.home);
    assert.equal(point.depth, placement.depth);
    const story = core.shelves.find(shelf => shelf.node === point.home)!.story;
    const direction = spots.get(story)!;
    const aligned = (point.at.x * direction.x + point.at.y * direction.y + point.at.z * direction.z) / length(point.at);
    assert.ok(aligned > 0.98, `${point.id} stays under its own island`);
    assert.ok(Math.abs(length(point.at) - radius * (1 - 0.16 * placement.depth)) < 1e-8);
  }
  assert.equal(points.find(point => point.id === "deep")!.depth, 3, "the shared shortcut does not shorten depth");
});

test("1.6 no-shelf artifacts form a small, distinct, stable centre cluster inside the shell", () => {
  const history = new History().story("front").decision("cover", { frontCoverOf: "front" });
  for (let index = 0; index < 5; index++) history.decision(`loose-${index}`);
  const core = underShelves(history.changes, knowledge(history.changes));
  const points = globePoints(core, spots, radius);
  const pool = points.filter(point => point.depth === undefined);
  assert.deepEqual(pool.map(point => point.id).sort(), core.outside);
  assert.ok(pool.every(point => point.home === undefined && length(point.at) + radius * 0.006 < radius * 0.06));
  assert.equal(new Set(pool.map(point => JSON.stringify(point.at))).size, 5);
  assert.deepEqual(globePoints(core, spots, radius), points);
  assert.ok(Math.abs(length(points.find(point => point.id === "cover")!.at) - radius * 0.84) < 1e-8);
  assert.deepEqual(globePoints(underShelves([], knowledge([])), new Map(), radius), []);
});
