/** Story nodes on the globe in rows by dependency depth (ADR-0646 and ADR-0804 D7 as superseded by the rows decision). */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { growPlanet, SEA_GAP } from "./island-growth.js";
import { PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";
import { storyNodes } from "../story-nodes/story-nodes.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const REACH = 20;

/** A project whose stories each have one capability, depending on the capabilities of the stories named. */
function project(dependsOn: Record<string, readonly string[]>): AnnotatedTree {
  return { arcs: [], stories: Object.entries(dependsOn).map(([id, on]) => ({ id, title: id, health, capabilities: [
    { id: `${id}-cap`, title: "A part", dependsOn: on.map(other => `${other}-cap`), proposed: true, status: "proposed" as const, contracts: [], health },
  ] })) };
}

/** Each story's spot on the globe, as the page lays it out from the story nodes' places. */
function globe(tree: AnnotatedTree): Map<string, PlanetPoint> {
  return new Map(growPlanet(storyNodes(tree, []).map(({ id, place }) => ({ story: id, place, reach: REACH }))).spots);
}

const latitude = (p: PlanetPoint) => Math.asin(p.y) * 180 / Math.PI;
const longitude = (p: PlanetPoint) => Math.atan2(p.x, p.z) * 180 / Math.PI;
const near = (a: number, b: number, within = 1e-6) => Math.abs(a - b) <= within;

test("1.4 a story's island sits north of every story it depends on, and stories that depend on nothing share the bottom row", () => {
  const spots = globe(project({ a: [], b: [], c: [], d: ["a"], e: ["d", "b"], f: ["c"] }));
  const at = (id: string) => latitude(spots.get(id)!);
  assert.ok(at("d") > at("a"), "d depends on a");
  assert.ok(at("e") > at("d") && at("e") > at("b"), "e depends on d and b");
  assert.ok(at("f") > at("c"), "f depends on c");
  for (const id of ["b", "c"]) assert.ok(near(at(id), at("a")), "a, b and c depend on nothing: one row");
  assert.ok([...spots.values()].every(p => latitude(p) >= at("a") - 1e-6), "and it is the bottom row");
  assert.ok(near(at("f"), at("d")), "d and f are each one above what they depend on: one row");
  assert.ok(near(at("a"), -42, 1) && near(at("e"), 42, 1), "rows run from about 42° south to 42° north");
  assert.ok(near(at("d") - at("a"), at("e") - at("d")), "evenly spaced");
});

test("1.5 adding a dependency moves an island up a row", () => {
  const before = globe(project({ a: [], b: [], c: ["a"] }));
  const after = globe(project({ a: [], b: ["a"], c: ["a"] }));
  assert.ok(near(latitude(before.get("b")!), latitude(before.get("a")!)), "b depended on nothing");
  assert.ok(latitude(after.get("b")!) > latitude(after.get("a")!), "now it is north of a");
  assert.ok(near(latitude(after.get("b")!), latitude(after.get("c")!)), "in the row above, with c");
});

test("1.9 where the code survey names stories' package dependencies, rows are by those, not by the plan's; without them the plan's roll-up stands", () => {
  // The plan says c depends on a; the code says b depends on c and a on nothing, and c on nothing.
  const tree = project({ a: [], b: [], c: ["a"] });
  const files = { files: [], imports: [] };
  const spots = new Map(growPlanet(storyNodes(tree, [], { a: { ...files, dependsOn: [] }, b: { ...files, dependsOn: ["c"] }, c: { ...files, dependsOn: [] } })
    .map(({ id, place }) => ({ story: id, place, reach: REACH }))).spots);
  const at = (id: string) => latitude(spots.get(id)!);
  assert.ok(at("b") > at("c"), "b's package depends on c's: b is north of c");
  assert.ok(near(at("c"), at("a")), "c's package depends on nothing: the plan's c → a no longer lifts it");
  const rolled = globe(tree);
  assert.ok(latitude(rolled.get("c")!) > latitude(rolled.get("a")!), "with no survey, the plan's c → a places c");
});

test("1.3 the bottom row puts the most depended-on story at the front and the rest outward, packed round the front with the sea between neighbours", () => {
  // a holds up four stories, b three, c two, d one and e none.
  const spots = globe(project({ a: [], b: [], c: [], d: [], e: [], p: ["a", "b", "c", "d"], q: ["a", "b", "c"], r: ["a", "b"], s: ["a"] }));
  const lon = (id: string) => Math.abs(longitude(spots.get(id)!));
  assert.ok(lon("a") < 1e-6, "a, the most depended on, is at the front");
  assert.ok(Math.sign(longitude(spots.get("b")!)) !== Math.sign(longitude(spots.get("c")!)), "the next two sit either side of it");
  assert.ok(Math.min(lon("d"), lon("e")) > Math.max(lon("b"), lon("c")), "the least depended on are furthest out");
  const row = (ids: string[]) => ids.map(id => longitude(spots.get(id)!));
  assert.ok(near(Math.min(...row(["p", "q", "r", "s"])) + Math.max(...row(["p", "q", "r", "s"])), 0), "a higher row is centred on the front too");
  const bottom = ["a", "b", "c", "d", "e"].map(id => spots.get(id)!).sort((m, n) => longitude(m) - longitude(n));
  for (let i = 1; i < bottom.length; i++) {
    const apart = PLANET_RADIUS * Math.acos(Math.min(1, bottom[i]!.x * bottom[i - 1]!.x + bottom[i]!.y * bottom[i - 1]!.y + bottom[i]!.z * bottom[i - 1]!.z));
    assert.ok(near(apart, 2 * REACH + SEA_GAP, 1e-6), "packed: two reaches and the sea gap apart");
  }
});

test("1.3 a higher row is ordered by where the stories it depends on sit", () => {
  const spots = globe(project({ a: [], b: [], c: [], x: ["a"], z: ["c"] }));
  const lon = (id: string) => longitude(spots.get(id)!);
  assert.notEqual(Math.sign(lon("a") - lon("c")), 0);
  assert.equal(Math.sign(lon("x") - lon("z")), Math.sign(lon("a") - lon("c")), "x sits on a's side of z, as a does of c");
});

test("1.3 a loop in the dependencies still gives every story a row", () => {
  const spots = globe(project({ a: ["b"], b: ["a"], c: [] }));
  assert.equal(spots.size, 3);
  for (const spot of spots.values()) assert.ok(Number.isFinite(latitude(spot)));
});
