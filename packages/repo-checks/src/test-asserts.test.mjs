// Capability 8 · Storytree's own test and gate entries. increment_ceee8864623d (research_5864a61a3dcb R6, ADR-1355 option A):
// `pnpm lint` refuses a numbered test that calls no assertion, and an assertion swallowed in a catch that does not rethrow.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { lint, RULES } from "./lint.mjs";
import { testAssertProblems } from "./test-asserts.mjs";

/** A checkout holding `files`, each path to its text, removed when `t` ends. */
function checkout(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "test-asserts-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** Each problem's file and line, and the title it names when it names one. */
const where = (problems) => problems.map((problem) => problem.match(/^(\S+:\d+)(?: the numbered test "([^"]*)")?/).slice(1).filter(Boolean).join(" "));

test("8.13 pnpm lint refuses a numbered test that calls no assertion, naming file, line and title; one that asserts directly, by t.assert or through a helper passes", (t) => {
  const root = checkout(t, {
    "packages/a/src/thing.mjs": "export function make() { if (Math.random() > 2) throw new Error('never'); return 1; }\n",
    "packages/a/testing/check.mjs": "export function mustBeOne(value) { if (value !== 1) throw new Error('not one'); }\n",
    "packages/a/src/helpers.mjs": "import assert from 'node:assert/strict';\nexport const same = (a, b) => assert.equal(a, b);\nexport { same as alike };\n",
    "packages/a/src/thing.test.ts": [
      `import assert, { equal } from "node:assert/strict";`,
      `import { test, it } from "node:test";`,
      `import { make } from "./thing.mjs";`,
      `import { alike } from "./helpers.mjs";`,
      `import { mustBeOne } from "../testing/check.mjs";`,
      `function local(x: number) { [x].forEach((y) => equal(y, 1)); }`,
      `test("1.1 builds only", async () => { make(); });`,
      `test("1.2 asserts", () => { assert.equal(make(), 1); });`,
      `test("1.3 named import", () => equal(make(), 1));`,
      `test("1.4 t.assert", (t) => { t.assert.equal(make(), 1); });`,
      `test("1.5 local helper", () => local(make()));`,
      `test("1.6 imported helper, re-exported", () => alike(make(), 1));`,
      `test("1.7 testing helper throws", () => mustBeOne(make()));`,
      `test("1.8 own throw", () => { if (make() !== 1) throw new Error("not one"); });`,
      `it("story 2.1 an it with a prefix", () => { make(); });`,
      `test("1.9 parent", async (t) => { await t.test("1.10 sub asserts nothing", () => { make(); }); });`,
      `test.skip("1.11 skipped", () => {});`,
      `test.todo("1.12 todo");`,
      `test("helper, not numbered", () => { make(); });`,
      `test("1.13 rejects", async () => { await assert.rejects(Promise.reject(new Error("x"))); });`,
      "",
    ].join("\n"),
  });

  assert.deepEqual(where(testAssertProblems(root)), [
    "packages/a/src/thing.test.ts:7 1.1 builds only",
    "packages/a/src/thing.test.ts:15 story 2.1 an it with a prefix",
    "packages/a/src/thing.test.ts:16 1.9 parent",
    "packages/a/src/thing.test.ts:16 1.10 sub asserts nothing",
  ]);
  assert.match(testAssertProblems(root)[0], /calls no assertion.*node:assert, t\.assert, or a helper that asserts/);
});

test("8.14 pnpm lint refuses an assertion in a catch block that does not rethrow, naming assert.rejects or assert.throws; a rethrowing catch passes", async (t) => {
  const root = checkout(t, {
    "packages/b/src/fail.test.mjs": [
      `import assert from "node:assert/strict";`,
      `import { test } from "node:test";`,
      `const run = async () => { throw new Error("boom"); };`,
      `test("3.1 swallowed", async () => {`,
      `  try { await run(); } catch (error) {`,
      `    assert.match(error.message, /boom/);`,
      `  }`,
      `});`,
      `test("3.2 rethrown", async () => {`,
      `  try { await run(); } catch (error) { assert.match(error.message, /boom/); throw error; }`,
      `});`,
      `test("3.3 deferred", async () => {`,
      `  try { await run(); } catch (error) { setTimeout(() => assert.ok(error)); }`,
      `  assert.ok(true);`,
      `});`,
      "",
    ].join("\n"),
  });

  const problems = testAssertProblems(root);
  assert.deepEqual(where(problems), ["packages/b/src/fail.test.mjs:6"]);
  assert.match(problems[0], /assert\.match sits in a catch block that does not rethrow.*use assert\.rejects or assert\.throws instead/);

  const lines = [];
  assert.equal(await lint({ root, rules: RULES.filter(({ name }) => name === "test-asserts"), log: (line) => lines.push(line) }), 1);
  assert.match(lines[0], /^test-asserts: packages\/b\/src\/fail\.test\.mjs:6 /);
});
