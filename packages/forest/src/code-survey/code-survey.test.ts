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
];
const survey = surveyStory(tree, capabilities);
const owner = (path: string) => survey.files.find((file) => file.path === path)?.capability;

test("8.1 a file imported by a test titled N.M belongs to capability N, directly or through the index's re-exports; when several reach it, the one whose tests reach it most owns it", () => {
  assert.equal(owner("src/merges/merge.ts"), "cap-merges");
  assert.equal(owner("src/claims/claim.ts"), "cap-claims");
});

test("8.2 a file no numbered test reaches belongs to the capability its top source folder names, else it is Unclaimed", () => {
  assert.equal(owner("src/claims/refuse.ts"), "cap-claims");
  assert.equal(owner("src/bins/run.ts"), undefined);
  assert.ok(survey.files.some((file) => file.path === "src/bins/run.ts"));
});

test("8.3 lines of code count source files only, never tests", () => {
  assert.deepEqual(survey.files.map(({ path }) => path).sort(), ["src/bins/run.ts", "src/claims/claim.ts", "src/claims/refuse.ts", "src/index.ts", "src/merges/merge.ts"]);
  assert.equal(survey.files.find((file) => file.path === "src/merges/merge.ts")?.lines, 2);
});

test("8.4 a relative import between two source files is reported, from the importer to the imported", () => {
  assert.deepEqual(survey.imports, [
    { from: "src/index.ts", to: "src/merges/merge.ts" },
    { from: "src/index.ts", to: "src/claims/claim.ts" },
    { from: "src/merges/merge.ts", to: "src/claims/claim.ts" },
  ]);
});
