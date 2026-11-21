// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./index.mjs";

const rule = plugin.rules["no-swallowed-assert"];

const FAIL = [
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
].join("\n");

const OTHER_CALLEES = [
  `import { equal } from "node:assert/strict";`,
  `import { test } from "node:test";`,
  `const run = (): void => { throw new Error("boom"); };`,
  `test("3.4 t.assert", (t) => {`,
  `  try { run(); } catch (error) { t.assert.ok(error); }`,
  `});`,
  `test("3.5 named import", () => {`,
  `  try { run(); } catch (error: unknown) { equal((error as Error).message, "boom"); }`,
  `});`,
  "",
].join("\n");

const swallowed = (line, callee) => ({ messageId: "swallowed", line, data: { callee } });

test("8.14 · storytree/no-swallowed-assert refuses, in a test file, an assertion call (assert.match, t.assert.ok, a named node:assert import) in a catch block that does not rethrow, at the assertion's line, its message naming the call and assert.rejects or assert.throws; a catch that rethrows, an assertion in a function written inside the catch and the same code in a file that is not a test file pass", () => {
  assert.match(rule?.meta?.messages?.swallowed ?? "", /assert\.rejects or assert\.throws/);

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("no-swallowed-assert", rule, {
    valid: [
      { code: FAIL, filename: "packages/b/src/fail.mjs" },
      { code: OTHER_CALLEES, filename: "packages/b/src/other.ts" },
    ],
    invalid: [
      { code: FAIL, filename: "packages/b/src/fail.test.mjs", errors: [swallowed(6, "assert.match")] },
      { code: OTHER_CALLEES, filename: "packages/b/src/other.test.ts", errors: [swallowed(5, "t.assert.ok"), swallowed(8, "equal")] },
    ],
  });

  new RuleTester().run("no-swallowed-assert", rule, {
    valid: [],
    invalid: [{ code: FAIL, filename: "packages/b/src/fail.test.mjs", errors: [{ line: 6, message: /^assert\.match sits in a catch block that does not rethrow.*use assert\.rejects or assert\.throws instead/ }] }],
  });
});
