/**
 * Capability 8 · Code survey (the map story): each story's code files, their lines, the capability
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

test("8.4 quoted fixtures and comments create no import edges or ownership, even when their paths resolve", () => {
  for (const inert of [
    `const fixture = 'import { answer } from "./main.js";';`,
    `const fixture = "import('./main.js')";`,
    'const fixture = `export { answer } from "./main.js";`;',
    '// import "./main.js";',
    '/* export * from "./main.js"; */',
    'export const label = 1 /* from "./main.js" */;',
    'const pattern = /"/; const apostrophe = /\'/;',
    '@sealed class Example { method(@inject value: unknown) {} }',
  ]) {
    const surveyed = surveyStory([
      { path: "src/main.ts", text: "export const answer = 42;" },
      { path: "src/real.ts", text: "export const real = 1;" },
      { path: "src/side.ts", text: "export {};" },
      { path: "src/lazy.ts", text: "export {};" },
      { path: "src/index.ts", text: 'export { /* from "./main.js" */ real } from "./real.js";' },
      { path: "src/fixture.test.ts", text: ['test("3.1 real imports", () => real);', inert,
        'import { /* from "./main.js" */ real } from "./index.js";',
        'import "./side.js";',
        'const later = () => `${import("./lazy.js")}`;',
        'type Lazy = typeof import("./lazy.js");',
      ].join("\n") },
    ], capabilities);
    assert.equal(surveyed.files.find(file => file.path === "src/main.ts")?.capability, undefined, inert);
    assert.deepEqual(surveyed.tests?.[0]?.imports.map(edge => edge.to), ["src/index.ts", "src/side.ts", "src/lazy.ts", "src/lazy.ts"], inert);
    assert.deepEqual(surveyed.imports, [{ from: "src/index.ts", to: "src/real.ts" }], inert);
    assert.ok(surveyed.files.filter(file => file.path !== "src/main.ts").every(file => file.capability === "cap-claims"), inert);
  }
});

test("8.4 an unfinished edit after a real import does not hide that import or abort the survey", () => {
  const surveyed = surveyStory([
    { path: "src/main.ts", text: "export const answer = 42;" },
    { path: "src/main.test.ts", text: 'import { answer } from "./main.js"; test("3.1 answer", () => answer); function pending() {' },
  ], capabilities);
  assert.deepEqual(surveyed.tests?.[0]?.imports, [{ from: "src/main.test.ts", to: "src/main.ts" }]);
  assert.equal(surveyed.files[0]?.capability, "cap-claims");
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

test("8.10 prefixed proof retains its package and contract list without assigning a foreign capability locally", () => {
  const surveyed = surveyStory([
    { path: "src/foreign.ts", text: "export const foreign = true;" },
    { path: "src/local.ts", text: "export const local = true;" },
    { path: "src/self.ts", text: "export const self = true;" },
    { path: "src/foreign.test.ts", text: 'import { foreign } from "./foreign.js";\ntest("map 3.5/3.6 and 4.1: the dependent front door proves map", () => foreign);' },
    { path: "src/local.test.ts", text: 'import { local } from "./local.js";\ntest("3.5, 3.6 local proof", () => local);' },
    { path: "src/self.test.ts", text: 'import { self } from "./self.js";\ntest("agent-link 3.5–3.6: own prefix is also accepted", () => self);' },
  ], [{ id: "local-capability", title: "3 · Local capability" }], {}, "agent-link");
  const foreign = surveyed.tests?.find(file => file.path === "src/foreign.test.ts");
  assert.deepEqual(foreign?.titles, ["3.5", "3.6", "4.1"].map(number => ({ package: "map", number, title: "map 3.5/3.6 and 4.1: the dependent front door proves map" })));
  assert.deepEqual(foreign?.imports, [{ from: "src/foreign.test.ts", to: "src/foreign.ts" }]);
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/local.test.ts")?.titles, ["3.5", "3.6"].map(number => ({ number, title: "3.5, 3.6 local proof" })));
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/self.test.ts")?.titles, ["3.5", "3.6"].map(number => ({ package: "agent-link", number, title: "agent-link 3.5–3.6: own prefix is also accepted" })));
  assert.equal(surveyed.files.find(file => file.path === "src/foreign.ts")?.capability, undefined);
  assert.equal(surveyed.files.find(file => file.path === "src/local.ts")?.capability, "local-capability");
  assert.equal(surveyed.files.find(file => file.path === "src/self.ts")?.capability, "local-capability");
});

test("8.10 regex literals neither hide later numbered proofs nor supply fake titles", () => {
  for (const pattern of ['/"/', '/["\']/g', '/test("5.2 fake",)/']) {
    for (const unfinished of ["", "function pending() {"]) {
      const surveyed = surveyStory([
        { path: "src/main.ts", text: "export const answer = 42;" },
        { path: "src/main.test.ts", text: [
          `const pattern = ${pattern};`,
          'import { answer } from "./main.js";',
          'test("3.1 answer", () => answer);',
          unfinished,
        ].join("\n") },
      ], capabilities);
      assert.deepEqual(surveyed.tests?.[0]?.titles, [{ number: "3.1", title: "3.1 answer" }], pattern);
      assert.deepEqual(surveyed.tests?.[0]?.imports, [{ from: "src/main.test.ts", to: "src/main.ts" }]);
      assert.deepEqual(surveyed.files, [{ path: "src/main.ts", lines: 1, capability: "cap-claims" }]);
    }
  }
});

test("8.10 helper calls, constant titles and template prefixes retain proof while comments and unused strings do not", () => {
  const surveyed = surveyStory([
    { path: "src/foreign.ts", text: "export const foreign = true;" },
    { path: "src/local.ts", text: "export const local = true;" },
    { path: "src/foreign.test.ts", text: [
      'import { foreign } from "./foreign.js";',
      'const TITLE = "map 3.5: counted front door";',
      'contract("map 3.6", () => foreign);',
      'test(TITLE, () => foreign);',
      'test(`${TITLE} (local)`, () => foreign);',
      '// test("3.7 commented proof", () => foreign);',
      '/* contract("3.8 commented proof", () => foreign); */',
      'const UNUSED = "3.9 unused title";',
      'const FIXTURE = "test(\'3.10 quoted call\', () => foreign)";',
    ].join("\n") },
    { path: "src/local.test.ts", text: [
      'import { local } from "./local.js";',
      'const TITLE = "3.5 local proof";',
      'contract("3.6", () => local);',
      'test(TITLE, () => local);',
      'test(`${TITLE} (local)`, () => local);',
    ].join("\n") },
  ], [{ id: "local-capability", title: "3 · Local capability" }], {}, "agent-link");
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/foreign.test.ts")?.titles, [
    { package: "map", number: "3.6", title: "map 3.6" },
    { package: "map", number: "3.5", title: "map 3.5: counted front door" },
    { package: "map", number: "3.5", title: "map 3.5: counted front door (local)" },
  ]);
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/local.test.ts")?.titles, [
    { number: "3.6", title: "3.6" },
    { number: "3.5", title: "3.5 local proof" },
    { number: "3.5", title: "3.5 local proof (local)" },
  ]);
  assert.equal(surveyed.files.find(file => file.path === "src/foreign.ts")?.capability, undefined);
  assert.equal(surveyed.files.find(file => file.path === "src/local.ts")?.capability, "local-capability");
});
