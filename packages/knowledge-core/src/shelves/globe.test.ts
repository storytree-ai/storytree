/** Capability 1's globe drawing: shelf depths and separate loose artifacts (ADR-0661 D3). */
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

test("1.6 loose artifacts fill a stable ball within 0.55 radii, separated by 0.035 radii from each other and shelves", () => {
  const history = new History().story("front").decision("cover", { frontCoverOf: "front", links: ["deep-0"] });
  for (let index = 0; index < 8; index++) history.decision(`deep-${index}`, { links: index < 7 ? [`deep-${index + 1}`] : [] });
  for (let index = 0; index < 99; index++) history.decision(`loose-${index}`);
  const core = underShelves(history.changes, knowledge(history.changes));
  const points = globePoints(core, spots, radius);
  const pool = points.filter(point => point.depth === undefined);
  assert.deepEqual(pool.map(point => point.id).sort(), core.outside);
  assert.equal(pool.length, 99);
  const shelf = points.filter(point => point.depth !== undefined);
  const radialDistances = pool.map(point => length(point.at));
  assert.ok(Math.max(...radialDistances) - Math.min(...radialDistances) > radius * 0.2, "loose notes fill a volume rather than a thin shell");
  assertLooseSpacing(pool, shelf);
  assert.deepEqual(globePoints(core, spots, radius), points);
  assert.deepEqual(globePoints({ ...core, outside: [...core.outside].reverse() }, spots, radius), points, "the same IDs keep the same layout despite input ordering");
  assert.deepEqual(globePoints(underShelves([], knowledge([])), new Map(), radius), []);
});

test("1.6 a larger library keeps 2,000 loose dots separately clickable inside the shell", () => {
  const history = new History();
  for (let index = 0; index < 2_000; index++) history.decision(`loose-${index}`);
  const points = globePoints(underShelves(history.changes, knowledge(history.changes)), spots, radius);
  assert.equal(points.length, 2_000);
  assertLooseSpacing(points, []);
});

test("1.8 the drawn points exclude loose and shelved story-text definitions, retaining other knowledge", () => {
  const history = new History().story("front")
    .create("shelved-story-text", "definition", { term: "Story text: stories/forest.md", frontCoverOf: "front" })
    .create("loose-story-text", "definition", { title: "Story text: stories/knowledge-core.md" })
    .create("ordinary-definition", "definition", { term: "A shelf", definition: "An entrance into knowledge." })
    .create("principle", "principle", { title: "Story text: stories/still-a-principle.md" })
    .decision("decision", { title: "Story text: stories/still-a-decision.md", frontCoverOf: "front" });
  const known = knowledge(history.changes);
  const points = globePoints(underShelves(history.changes, known), spots, radius, known.notes);
  assert.equal(known.active.size, 5, "the read-only drawing does not remove library records");
  assert.equal(points.length, 3);
  assert.deepEqual(points.map(point => point.id).sort(), ["decision", "ordinary-definition", "principle"]);
});

function assertLooseSpacing(pool: ReturnType<typeof globePoints>, shelf: ReturnType<typeof globePoints>): void {
  const margin = radius * 0.035;
  assert.ok(margin > radius * 0.012, "the separation exceeds one drawn dot diameter");
  for (let index = 0; index < pool.length; index++) {
    const point = pool[index]!;
    assert.equal(point.home, undefined);
    assert.ok(length(point.at) <= radius * 0.55 + 1e-8, `${point.id} stays within the filled ball`);
    assert.ok(length(point.at) + radius * 0.006 < radius, `${point.id}'s entire dot stays inside the shell`);
    for (const other of [...pool.slice(index + 1), ...shelf]) {
      const distance = Math.hypot(point.at.x - other.at.x, point.at.y - other.at.y, point.at.z - other.at.z);
      assert.ok(distance >= margin - 1e-8, `${point.id} and ${other.id}: ${distance / radius} radii, minimum 0.035`);
    }
  }
}
