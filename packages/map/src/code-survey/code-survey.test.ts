/**
 * Capability 8 · Code survey (the forest story): each story's code files, their lines, the capability
 * each belongs to by the contract numbers its tests name, and the imports between them (ADR-0804 D3,
 * D4). Written against a small package tree held in memory.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { surveyStory } from "./code-survey.js";

const capabilities = [
  { id: "cap-claims", title: "3 · Claims" },
  { id: "cap-merges", title: "5 · Merge ceremony" },
];
const tree = [
  { path: "src/index.ts", text: 'export { merge } from "./merges/merge.js";\nexport { claim } from "./claims/claim.js";\n' },
  { path: "src/merges/merge.ts", text: 'import { claim } from "../claims/claim.js";\n\nexport const merge = () => claim();\n' },
  { path: "src/merges/merge.test.ts", text: 'import { merge } from "./merge.js";\ntest("5.2 a merge ends its claims", () => merge());\ntest("5.3 twice", () => merge());\n' },
  { path: "src/claims/claim.ts", text: "export const claim = () => 1;\n" },
  { path: "src/claims/claim.test.ts", text: 'import { claim, merge } from "../index.js";\ntest("3.1 a claim holds", () => claim());\ntest("3.2 again", () => claim());\ntest("5.1 via the index", () => merge());\n' },
  { path: "src/claims/refuse.ts", text: "export const refuse = 0;\n" },
  { path: "src/bins/run.ts", text: "export {};\n" },
  { path: "src/server.ts", text: 'import { tool } from "./tools/tool.js";\n\nexport const serve = () => tool();\nexport const later = () => import("./tools/lazy.js");\n' },
  { path: "src/tools/lazy.ts", text: "export const lazy = () => 4;\n" },
  { path: "src/testing/fixture.ts", text: 'import { claim } from "../claims/claim.js";\n\nexport const fixture = () => claim();\n' },
  { path: "src/claims/shapes.ts", text: "export type Shape = { readonly id: string };\n" },
  { path: "src/claims/typed.ts", text: 'import type { Shape } from "./shapes.js";\n\nexport const typed = (shape: Shape) => shape.id;\n' },
  { path: "src/claims/typed.test.ts", text: 'import type { typed } from "./typed.js";\nimport type { merge } from "../merges/merge.js";\nimport { refuse } from "./refuse.js";\ntest("3.4 typed", () => refuse);\n' },
  { path: "src/tools/tool.ts", text: 'import { helper } from "./helper.js";\n\nexport const tool = () => helper();\n' },
  { path: "src/tools/helper.ts", text: "export const helper = () => 3;\n" },
  { path: "src/server.test.ts", text: 'import { serve } from "./server.js";\ntest("3.3 a served tool claims", () => serve());\n' },
];
const survey = surveyStory(tree, capabilities);
const owner = (path: string) => survey.files.find((file) => file.path === path)?.capability;

test("8.1 a file a test titled N.M reaches through any number of imports and re-exports belongs to capability N; when several reach it, the one whose tests reach it nearest, then most, owns it", () => {
  assert.equal(owner("src/merges/merge.ts"), "cap-merges");
  assert.equal(owner("src/claims/claim.ts"), "cap-claims");
  assert.equal(owner("src/tools/tool.ts"), "cap-claims");
  assert.equal(owner("src/tools/helper.ts"), "cap-claims");
  assert.equal(owner("src/tools/lazy.ts"), "cap-claims", "a literal dynamic import is an import");
});

test("8.3 lines of code count source files only, never tests nor the test helpers under a testing/ folder", () => {
  assert.ok(!survey.files.some((file) => file.path === "src/testing/fixture.ts"));
  assert.deepEqual(survey.files.map(({ path }) => path).sort(), ["src/bins/run.ts", "src/claims/claim.ts", "src/claims/refuse.ts", "src/claims/shapes.ts", "src/claims/typed.ts", "src/index.ts", "src/merges/merge.ts", "src/server.ts", "src/tools/helper.ts", "src/tools/lazy.ts", "src/tools/tool.ts"]);
  assert.equal(survey.files.find((file) => file.path === "src/merges/merge.ts")?.lines, 2);
});

test("8.4 a relative import between two source files is reported, from the importer to the imported", () => {
  assert.deepEqual(survey.imports, [
    { from: "src/index.ts", to: "src/merges/merge.ts" },
    { from: "src/index.ts", to: "src/claims/claim.ts" },
    { from: "src/merges/merge.ts", to: "src/claims/claim.ts" },
    { from: "src/server.ts", to: "src/tools/tool.ts" },
    { from: "src/server.ts", to: "src/tools/lazy.ts" },
    { from: "src/claims/typed.ts", to: "src/claims/shapes.ts" },
    { from: "src/tools/tool.ts", to: "src/tools/helper.ts" },
  ]);
});

test("8.6 a file a numbered test's runs executed belongs to the capability whose tests executed it most; a direct import outranks it, and it outranks a file reached only through further imports", () => {
  const covered = surveyStory(tree, capabilities, {
    "src/bins/run.ts": { "5": 2, "3": 1 },
    "src/merges/merge.ts": { "3": 9 },
    "src/tools/helper.ts": { "5": 1 },
  });
  const ownerOf = (path: string) => covered.files.find((file) => file.path === path)?.capability;
  assert.equal(ownerOf("src/bins/run.ts"), "cap-merges");
  assert.equal(ownerOf("src/merges/merge.ts"), "cap-merges");
  assert.equal(ownerOf("src/tools/helper.ts"), "cap-merges");
});

test("8.7 a file numbered tests reach only through type imports belongs to the capability whose tests reach it so; a value reach outranks a type reach", () => {
  assert.equal(owner("src/claims/typed.ts"), "cap-claims");
  assert.equal(owner("src/claims/shapes.ts"), "cap-claims");
  assert.equal(owner("src/merges/merge.ts"), "cap-merges");
});


test("8.10 test files keep their numbered titles and imports, tagged as tests without entering source counts", () => {
  const surveyed = surveyStory([
    { path: "src/view.ts", text: "export const view = true;" },
    { path: "src/view.test.ts", text: `import { view } from "./view.js";
test("2.5 Projects view opens", () => view);
it('2.6 Projects view closes', () => view);
test("an unnumbered case", () => view);` },
    { path: "src/testing/helper.ts", text: 'import { view } from "../view.js";\nexport const helper = view;' },
    { path: "src/other.spec.ts", text: 'import "./testing/helper.js";\ntest("plain case", () => {});' },
  ], [{ id: "projects", title: "2 · Projects" }]);
  assert.deepEqual(surveyed.tests, [
    { kind: "test", path: "src/view.test.ts", titles: [{ number: "2.5", title: "2.5 Projects view opens" }, { number: "2.6", title: "2.6 Projects view closes" }], imports: [{ from: "src/view.test.ts", to: "src/view.ts" }] },
    { kind: "test", path: "src/testing/helper.ts", titles: [], imports: [{ from: "src/testing/helper.ts", to: "src/view.ts" }] },
    { kind: "test", path: "src/other.spec.ts", titles: [], imports: [{ from: "src/other.spec.ts", to: "src/testing/helper.ts" }] },
  ]);
  assert.deepEqual(surveyed.files, [{ path: "src/view.ts", lines: 1, capability: "projects" }]);
  assert.deepEqual(surveyed.imports, []);
});
