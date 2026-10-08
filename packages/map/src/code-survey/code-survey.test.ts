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

test("8.1 self exports retain relative import, re-export, type and measured allocation ranking without reaching other packages", () => {
  const aliases = tree.map(file => ({ ...file, text: file.text
    .replaceAll('"./merges/merge.js"', '"@x/shop/merge"')
    .replaceAll('"./claims/claim.js"', '"@x/shop/claim"')
    .replaceAll('"../index.js"', '"@x/shop"')
    .replaceAll('"./tools/lazy.js"', '"@x/shop/lazy"')
    .replaceAll('"./shapes.js"', '"@x/shop/shapes"')
    .replaceAll('"./typed.js"', '"@x/shop/typed"'),
  }));
  aliases.push({ path: "src/external.test.ts", text: 'import "@x/foreign/claim"; import "@x/shop/src/claims/refuse.ts"; import "src/bins/run.ts"; test("5.9 external", () => {});' });
  const exports = { ".": "./src/index.ts", "./merge": "./src/merges/merge.ts", "./claim": "./src/claims/claim.ts", "./lazy": "./src/tools/lazy.ts", "./shapes": "./src/claims/shapes.ts", "./typed": "./src/claims/typed.ts" };
  const coverage = { "src/bins/run.ts": { "5": 2, "3": 1 }, "src/merges/merge.ts": { "3": 9 }, "src/tools/helper.ts": { "5": 1 } };
  const actual = surveyStory(aliases, capabilities, coverage, "shop", [{ root: "", name: "@x/shop", exports }]);
  const expected = surveyStory(tree, capabilities, coverage, "shop");
  assert.deepEqual(actual.files, expected.files);
  assert.deepEqual(actual.imports, expected.imports);
  assert.deepEqual(actual.tests?.slice(0, -1), expected.tests);
  assert.deepEqual(actual.tests?.at(-1)?.imports, []);
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

test("8.10 proof ranges validate the whole title before expanding at most 256 entries", () => {
  const cases: [string, string[]][] = [
    ["3.2–3.4 / 3.3 and 4.1", ["3.2", "3.3", "3.4", "4.1"]],
    ["3.1–3.256", Array.from({ length: 256 }, (_, n) => `3.${n + 1}`)],
    ["3.1–3.257", []],
    ["3.1–3.128, 3.129–3.257", []],
    ["3.1–3.128, 3.1–3.128 and 3.1", []],
    ["3.1–3.2, 3.4–3.3", []],
    ["3.1–4.2", []],
    ["3.9007199254740992–3.9007199254740992", []],
    // Large endpoints are exercised only after the pre-expansion guard exists.
    ["3.1–3.9007199254740991", []],
    ["3.1–3.2, 3.3–3.9007199254740991", []],
    ["3.9007199254740990–3.9007199254740991", ["3.9007199254740990", "3.9007199254740991"]],
  ];
  for (const [list, expected] of cases) {
    const title = `map ${list}: proof`;
    const surveyed = surveyStory([{ path: "src/proof.test.ts", text: `test(${JSON.stringify(title)}, () => {});` }], []);
    assert.deepEqual(surveyed.tests?.[0]?.titles, expected.map(number => ({ package: "map", number, title })), list);
  }
});

test("8.10 each file has a cumulative 4096-entry expansion budget, including inherited suites", () => {
  const title = "3.1–3.256 proof";
  const full = Array.from({ length: 16 }, () => `test(${JSON.stringify(title)}, () => {});`).join("\n");
  const surveyed = surveyStory([
    { path: "src/testing/suite.ts", text: `import { test } from "node:test";\n${full}\ntest("3.257 overflow", () => {});` },
    { path: "src/proof.test.ts", text: 'import "./testing/suite.js";' },
    { path: "src/other.test.ts", text: 'test("3.258 unrelated", () => {});' },
  ], []);
  const expected = Array.from({ length: 16 }, () => Array.from({ length: 256 }, (_, n) => ({ number: `3.${n + 1}`, title }))).flat();
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/testing/suite.ts")?.titles, expected);
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/proof.test.ts")?.titles, expected);
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/other.test.ts")?.titles, [{ number: "3.258", title: "3.258 unrelated" }]);
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

test("8.12 a CommonJS require of a relative file or the package's own exported subpath is an ordinary import, so a CommonJS package's files fall in the capabilities whose tests reach them", () => {
  const commonjs = [
    { path: "src/core/index.js", text: "const send = () => 1;\nmodule.exports = { send };\n" },
    { path: "src/auth/index.js", text: "const { send } = require('../core');\nconst { wire } = require(\"./sign-in.js\");\nmodule.exports = { send, wire };\n" },
    { path: "src/auth/sign-in.js", text: "exports.wire = () => 2;\n" },
    { path: "src/auth/auth.test.js", text: "const { test } = require('node:test');\nconst auth = require('./index.js');\ntest('2.1 sign-in page shows the form', () => auth);\n" },
    { path: "src/core/core.test.js", text: "const { test } = require('node:test');\nconst core = require('@x/shop/core');\n// require('../auth/sign-in.js') in a comment is no import\nconst text = \"require('../auth/index.js')\";\ntest('1.1 unknown addresses answer 404', () => core);\n" },
  ];
  const survey = surveyStory(commonjs, [{ id: "cap-core", title: "1 · Web basics" }, { id: "cap-auth", title: "2 · Signing in" }], {}, "shop",
    [{ root: "", name: "@x/shop", exports: { "./core": "./src/core/index.js" } }]);
  assert.deepEqual(survey.files.map(({ path, capability }) => [path, capability]), [
    ["src/core/index.js", "cap-core"], ["src/auth/index.js", "cap-auth"], ["src/auth/sign-in.js", "cap-auth"],
  ]);
  assert.deepEqual(survey.imports, [{ from: "src/auth/index.js", to: "src/core/index.js" }, { from: "src/auth/index.js", to: "src/auth/sign-in.js" }]);
});

test("8.14 a test file that runs an imported behaviour suite carries the suite's numbered titles, for its proofs and its reach; comments and a file that registers no tests credit nothing", () => {
  const suite = [
    'import { test } from "node:test";',
    'import { store } from "./store.js";',
    "export function storeSuite(label: string): void {",
    "  function contract(number: string, title: string, body: () => void): void {",
    "    test(`${number} [${label}] ${title}`, body);",
    "  }",
    '  contract("2.1", "save replaces", () => store);',
    '  // contract("2.9", "commented", () => store);',
    '  contract("map 2.2", "foreign proof", () => store);',
    "}",
  ].join("\n");
  const surveyed = surveyStory([
    { path: "src/store.ts", text: "export const store = true;" },
    { path: "src/suite.ts", text: suite },
    { path: "src/inert.ts", text: 'export const register = (number: string) => number;\nregister("2.8");' },
    { path: "src/memory.test.ts", text: 'import { storeSuite } from "./suite.js";\nimport { register } from "./inert.js";\nstoreSuite("memory");\n' },
  ], [{ id: "transactions", title: "2 · Library transactions" }], {}, "library");
  assert.deepEqual(surveyed.tests?.find(file => file.path === "src/memory.test.ts")?.titles, [
    { number: "2.1", title: "2.1" },
    { package: "map", number: "2.2", title: "map 2.2" },
  ]);
  assert.equal(surveyed.files.find(file => file.path === "src/store.ts")?.capability, "transactions");
});

test("8.15 a source file's opening \"Capability N · …\" declaration, after a shebang, puts it in capability N when N's tests reach it; a declaration they do not reach, or none, leaves inference", () => {
  const caps = [{ id: "cap-claims", title: "3 · Claims" }, { id: "cap-hooks", title: "4 · Hooks" }, { id: "cap-merges", title: "5 · Merges" }];
  const shared = (opening: string) => `${opening}\nexport const shared = 1;\n`;
  const files = (opening: string, extra: { path: string; text: string }[] = []) => [
    { path: "src/hooks.ts", text: shared(opening) },
    { path: "src/claims.test.ts", text: 'import { shared } from "./hooks.js";\ntest("3.1 claims", () => shared);\ntest("3.2 again", () => shared);\n' },
    { path: "src/hooks.test.ts", text: 'import { shared } from "./hooks.js";\ntest("4.1 hooks", () => shared);\n' },
    ...extra,
  ];
  const surveyed = (opening: string, extra?: { path: string; text: string }[]) => surveyStory(files(opening, extra), caps).files.find((file) => file.path === "src/hooks.ts");

  assert.deepEqual(surveyed("/** A shared hook. */"), { path: "src/hooks.ts", lines: 2, capability: "cap-claims" }, "undeclared, the most tests win");
  assert.deepEqual(surveyed("/**\n * Capability 4 · Hooks: the edit hook.\n */"),
    { path: "src/hooks.ts", lines: 4, capability: "cap-hooks", declared: 4, reachedBy: [3, 4] }, "declared and reached, the declaration wins");
  assert.deepEqual(surveyed("#!/usr/bin/env node\n// Capability 4 · Hooks"),
    { path: "src/hooks.ts", lines: 3, capability: "cap-hooks", declared: 4, reachedBy: [3, 4] }, "a line comment after a shebang declares");
  assert.deepEqual(surveyed("/** Capability 5 · Merges */"),
    { path: "src/hooks.ts", lines: 2, capability: "cap-claims", declared: 5, reachedBy: [3, 4] }, "a declaration no test of it reaches is inferred instead");
  assert.equal(surveyed("/** Capability 5 · Merges */", [{ path: "src/merges.test.ts", text: 'import "./hooks.js";\ntest("5.1 merges", () => {});\n' }])?.capability, "cap-merges", "reached, it holds");
  assert.equal(surveyed("const x = 1;\n/** Capability 4 · Hooks */")?.declared, undefined, "only the opening comment declares");
  assert.equal(surveyed("/** See Capability 4 · Hooks */")?.declared, undefined, "the comment must begin with it");
});
