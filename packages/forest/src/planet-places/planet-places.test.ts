/** Story nodes in rows by dependency depth (ADR-0646 and ADR-0804 D7 as superseded by the rows decision): each place a row and a slot in it. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";
import { readCodeSurvey } from "../code-survey/read-survey.js";

import { rowOf } from "./planet-places.js";
import { storyNodes } from "../story-nodes/story-nodes.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };

/** A project whose stories each have one capability, depending on the capabilities of the stories named. */
function project(dependsOn: Record<string, readonly string[]>): AnnotatedTree {
  return { arcs: [], stories: Object.entries(dependsOn).map(([id, on]) => ({ id, title: id, health, capabilities: [
    { id: `${id}-cap`, title: "A part", dependsOn: on.map(other => `${other}-cap`), proposed: true, status: "proposed" as const, contracts: [], health },
  ] })) };
}

/** Each story's row (0 the bottom) and how far across its row it sits from the row's middle, as its place names them. */
function places(nodes: ReturnType<typeof storyNodes>): Map<string, { row: number; across: number }> {
  return new Map(nodes.map(({ id, place, at }) => [id, { row: rowOf(place).row, across: at.x }]));
}
const laid = (tree: AnnotatedTree) => places(storyNodes(tree, []));
test("1.4 a story's place is in a row above every story it depends on, and stories that depend on nothing share the bottom row", () => {
  const rows = laid(project({ a: [], b: [], c: [], d: ["a"], e: ["d", "b"], f: ["c"] }));
  const at = (id: string) => rows.get(id)!.row;
  assert.ok(at("d") > at("a"), "d depends on a");
  assert.ok(at("e") > at("d") && at("e") > at("b"), "e depends on d and b");
  assert.ok(at("f") > at("c"), "f depends on c");
  for (const id of ["a", "b", "c"]) assert.equal(at(id), 0, "a, b and c depend on nothing: the bottom row");
  assert.equal(at("f"), at("d"), "d and f are each one above what they depend on: one row");
});

test("1.5 adding a dependency moves an island up a row", () => {
  const before = laid(project({ a: [], b: [], c: ["a"] }));
  const after = laid(project({ a: [], b: ["a"], c: ["a"] }));
  assert.equal(before.get("b")!.row, before.get("a")!.row, "b depended on nothing");
  assert.ok(after.get("b")!.row > after.get("a")!.row, "now it is above a");
  assert.equal(after.get("b")!.row, after.get("c")!.row, "in the row above, with c");
});

test("1.9 a story's row is ranked by its capabilities' edges, derived from its code's imports with the recorded dependsOn, and its code's story edges; package.json fields rank nothing; without a survey the plan's roll-up stands", async (t) => {
  // The plan records c on a. b's code imports c's; d's package.json names c, but no code of d's imports it.
  const tree = project({ a: [], b: [], c: ["a"], d: [] });
  const folder = await mkdtemp(path.join(tmpdir(), "forest-rows-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const id of ["a", "b", "c", "d"]) {
    const root = path.join(folder, "packages", id);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), id === "b" ? 'import { value as c } from "@example/c";\nexport const value = c;\n' : "export const value = 1;\n");
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: `@example/${id}`, exports: { ".": "./src/index.ts" }, dependencies: id === "b" || id === "d" ? { "@example/c": "*" } : {},
    }));
  }
  const survey = await readCodeSurvey(folder, tree);
  const rows = places(storyNodes(tree, [], survey));
  const at = (id: string) => rows.get(id)!.row;
  assert.ok(at("b") > at("c"), "b's code imports c's: b is above c, though no capability owns either file");
  assert.ok(at("c") > at("a"), "the recorded c → a, which no import shows, still lifts c");
  assert.equal(at("d"), at("a"), "d's package.json dependency alone ranks nothing: d stays in the bottom row");
  const rolled = laid(tree);
  assert.ok(rolled.get("c")!.row > rolled.get("a")!.row, "with no survey, the plan's c → a places c");
  assert.equal(rolled.get("b")!.row, rolled.get("a")!.row, "and b sits in the bottom row");
});

test("1.3 the bottom row puts the most depended-on story in the middle and the rest outward", () => {
  // a holds up four stories, b three, c two, d one and e none.
  const rows = laid(project({ a: [], b: [], c: [], d: [], e: [], p: ["a", "b", "c", "d"], q: ["a", "b", "c"], r: ["a", "b"], s: ["a"] }));
  const across = (id: string) => rows.get(id)!.across, out = (id: string) => Math.abs(across(id));
  assert.equal(out("a"), 0, "a, the most depended on, is in the middle");
  assert.ok(Math.sign(across("b")) !== Math.sign(across("c")), "the next two sit either side of it");
  assert.ok(Math.min(out("d"), out("e")) > Math.max(out("b"), out("c")), "the least depended on are furthest out");
});

test("1.3 a higher row is ordered by where the stories it depends on sit", () => {
  const rows = laid(project({ a: [], b: [], c: [], x: ["a"], z: ["c"] }));
  const lon = (id: string) => rows.get(id)!.across;
  assert.notEqual(Math.sign(lon("a") - lon("c")), 0);
  assert.equal(Math.sign(lon("x") - lon("z")), Math.sign(lon("a") - lon("c")), "x sits on a's side of z, as a does of c");
});

test("1.3 a loop in the dependencies still gives every story a row", () => {
  const rows = laid(project({ a: ["b"], b: ["a"], c: [] }));
  assert.equal(rows.size, 3);
  for (const { row } of rows.values()) assert.ok(Number.isInteger(row) && row >= 0);
});
