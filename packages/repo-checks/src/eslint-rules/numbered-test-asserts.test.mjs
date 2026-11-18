// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { removeTemp } from "@storytree/test-waits";

import plugin from "./index.mjs";

const rule = plugin.rules["numbered-test-asserts"];

function checkout(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "numbered-test-asserts-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const HELPERS = {
  "packages/a/src/thing.mjs": "export function make() { if (Math.random() > 2) throw new Error('never'); return 1; }\n",
  "packages/a/testing/check.mjs": "export function mustBeOne(value) { if (value !== 1) throw new Error('not one'); }\n",
  "packages/a/src/inner.mjs": "import { ok } from 'node:assert';\nexport function holds(value) { ok(value); }\n",
  "packages/a/src/index.mjs": "export * from './missing.mjs';\nexport * from './inner.mjs';\n",
  "packages/a/src/helpers.mjs": "import assert from 'node:assert/strict';\nexport const same = (a, b) => assert.equal(a, b);\nexport { same as alike };\n",
  "packages/a/src/default-fn.mjs": "import assert from 'node:assert/strict';\nexport default function check(value) { assert.equal(value, 1); }\nexport function build(value) { return value; }\n",
  "packages/a/src/default-name.mjs": "import { ok } from 'node:assert';\nconst holds = (value) => ok(value);\nexport default holds;\n",
  "packages/a/src/default-none.mjs": "export default function quiet(value) { return value; }\n",
};

const THING = [
  `import assert, { equal } from "node:assert/strict";`,
  `import { test, it } from "node:test";`,
  `import { make } from "./thing.mjs";`,
  `import { alike } from "./helpers.mjs";`,
  `import { mustBeOne } from "../testing/check.mjs";`,
  `import { holds } from "./index.mjs";`,
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
  `test("1.14 helper re-exported by export *", () => holds(make()));`,
  `test("1.13 rejects", async () => { await assert.rejects(Promise.reject(new Error("x"))); });`,
  "",
].join("\n");

const DEFAULTS = [
  `import checkOne, { build } from "./default-fn.mjs";`,
  `import holdsToo from "./default-name.mjs";`,
  `import quiet from "./default-none.mjs";`,
  `import { test } from "node:test";`,
  `test("1.15 default-exported function", () => checkOne(1));`,
  `test("1.16 default-exported name", () => holdsToo(1));`,
  `test("1.17 named export beside an asserting default", () => { build(1); });`,
  `test("1.18 default export that asserts nothing", () => { quiet(1); });`,
  "",
].join("\n");

const BUILDS_ONLY = `import { test } from "node:test";\nconst make = () => 1;\ntest("1.1 builds only", () => { make(); });\n`;

test("8.13 · storytree/numbered-test-asserts refuses, in a test file, a numbered test that calls no assertion (a test, an it with a story prefix, a t.test sub and the parent holding it; a throw in the code under test is none) at its line, its message naming the title and the fix (node:assert, t.assert, or a helper that asserts); one asserting directly, by a named import, t.assert or assert.rejects, through a local helper, an imported helper re-exported by name or by export *, a default-exported function or name that asserts, a testing/ helper that throws, or its own throw passes, as do skip, todo and unnumbered tests and the same code in a file that is not a test file", (t) => {
  assert.match(rule?.meta?.messages?.assertsNothing ?? "", /node:assert, t\.assert, or a helper that asserts/);

  const root = checkout(t, HELPERS);
  const at = (file) => path.join(root, file);
  const refused = (line, title) => ({ messageId: "assertsNothing", line, data: { title } });

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("numbered-test-asserts", rule, {
    valid: [
      { code: THING, filename: at("packages/a/src/thing.ts") },
      { code: BUILDS_ONLY, filename: at("packages/a/src/builds.mjs") },
    ],
    invalid: [
      {
        code: THING,
        filename: at("packages/a/src/thing.test.ts"),
        errors: [
          refused(8, "1.1 builds only"),
          refused(16, "story 2.1 an it with a prefix"),
          refused(17, "1.9 parent"),
          refused(17, "1.10 sub asserts nothing"),
        ],
      },
      { code: BUILDS_ONLY, filename: at("packages/a/src/builds.test.mjs"), errors: [refused(3, "1.1 builds only")] },
      {
        code: DEFAULTS,
        filename: at("packages/a/src/defaults.test.mjs"),
        errors: [refused(7, "1.17 named export beside an asserting default"), refused(8, "1.18 default export that asserts nothing")],
      },
    ],
  });

  const messages = new Linter().verify(BUILDS_ONLY, [{ plugins: { storytree: plugin }, rules: { "storytree/numbered-test-asserts": "error" } }], { filename: "packages/a/src/builds.test.mjs" });
  assert.deepEqual(messages.map(({ line, ruleId }) => [line, ruleId]), [[3, "storytree/numbered-test-asserts"]]);
  assert.match(messages[0].message, /"1\.1 builds only" calls no assertion.*node:assert, t\.assert, or a helper that asserts/);
});
