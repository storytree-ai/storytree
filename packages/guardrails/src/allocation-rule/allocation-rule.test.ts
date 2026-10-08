/**
 * Capability 2 · The allocation rule (the Guardrails story): a story package's source file no numbered
 * test reaches fails, on a small project laid out as the habits card says (ADR-0900 D1).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { allocationProblems, misdeclaredCode, unallocatedCode, undeclaredCode } from "./allocation-rule.js";

/** A checkout holding `files` (repo-relative path to text), removed after the test. */
function plant(t: TestContext, files: Record<string, string>): string {
  const at = mkdtempSync(path.join(tmpdir(), "allocation-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  return at;
}

const SHOP = {
  "packages/shop/package.json": JSON.stringify({ name: "@x/shop" }),
  "packages/shop/src/cart.ts": "export const add = (a: number, b: number) => a + b;\n",
  "packages/shop/src/cart.test.ts": 'import { test } from "node:test";\nimport { add } from "./cart.js";\ntest("1.1 · adds", () => add(1, 2));\n',
  "packages/shop/src/refund.ts": "export const refund = () => 0;\nexport const again = 1;\n",
};

test("2.1 · a story package's source file no numbered test reaches fails, named with the three ways out; reached, it passes", async (t: TestContext) => {
  const left = plant(t, SHOP);
  assert.deepEqual(await unallocatedCode(left, ["shop"]), [{ file: "packages/shop/src/refund.ts", lines: 2 }]);
  const [problem = "", ...rest] = await allocationProblems(left, ["shop"]);
  assert.deepEqual(rest, []);
  assert.match(problem, /packages\/shop\/src\/refund\.ts \(2 lines\)/);
  assert.match(problem, /number a test that reaches it/);
  assert.match(problem, /plan a contract/);
  assert.match(problem, /delete it/);

  const reached = plant(t, { ...SHOP, "packages/shop/src/refund.test.ts": 'import { test } from "node:test";\nimport { refund } from "./refund.js";\ntest("2.1 · refunds nothing", () => refund());\n' });
  assert.deepEqual(await allocationProblems(reached, ["shop"]), []);
  const measured = plant(t, { ...SHOP, "packages/shop/survey-coverage.json": JSON.stringify({ "src/refund.ts": { 2: 1 } }) });
  assert.deepEqual(await allocationProblems(measured, ["shop"]), [], "a file a numbered test executed is allocated by the coverage map");
  const unnumbered = plant(t, { ...SHOP, "packages/shop/src/refund.test.ts": 'import { test } from "node:test";\nimport { refund } from "./refund.js";\ntest("refunds nothing", () => refund());\n' });
  assert.deepEqual(await unallocatedCode(unnumbered, ["shop"]), [{ file: "packages/shop/src/refund.ts", lines: 2 }], "a test with no number allocates nothing");
});

test("2.1 · a project that names no stories has its every package under packages/ checked", async (t: TestContext) => {
  assert.deepEqual(await unallocatedCode(plant(t, SHOP)), [{ file: "packages/shop/src/refund.ts", lines: 2 }]);
});

test("2.2 · a source file declaring a capability whose numbered tests do not reach it fails, naming the file, its declaration and the capabilities that do; reached, it passes", async (t: TestContext) => {
  const declaring = (opening: string) => ({ ...SHOP, "packages/shop/src/cart.ts": `${opening}\n${SHOP["packages/shop/src/cart.ts"]}` });
  const wrong = plant(t, declaring("/** Capability 2 · Refunds: the cart. */"));
  assert.deepEqual(await misdeclaredCode(wrong, ["shop"]), [{ file: "packages/shop/src/cart.ts", declared: 2, reachedBy: [1] }]);
  const [problem = "", ...rest] = (await allocationProblems(wrong, ["shop"])).filter((said) => said.includes("cart.ts"));
  assert.deepEqual(rest, []);
  assert.match(problem, /packages\/shop\/src\/cart\.ts declares capability 2/);
  assert.match(problem, /reach it: 1\b/);

  assert.deepEqual(await misdeclaredCode(plant(t, declaring("/** Capability 1 · Cart */")), ["shop"]), []);
  const measured = plant(t, { ...declaring("/** Capability 2 · Refunds */"), "packages/shop/survey-coverage.json": JSON.stringify({ "src/cart.ts": { 2: 1 } }) });
  assert.deepEqual(await misdeclaredCode(measured, ["shop"]), [], "the coverage map reaches it for capability 2");
});

test("2.3 · asked to, a source file whose opening comment declares no capability fails, naming the file and suggesting the capability the survey infers; declared, it passes, and unasked nothing changes", async (t: TestContext) => {
  const reached = { ...SHOP, "packages/shop/src/refund.test.ts": 'import { test } from "node:test";\nimport { refund } from "./refund.js";\ntest("2.1 · refunds nothing", () => refund());\n' };
  const undeclared = plant(t, reached);
  assert.deepEqual(await undeclaredCode(undeclared, ["shop"]), [{ file: "packages/shop/src/cart.ts", suggested: 1 }, { file: "packages/shop/src/refund.ts", suggested: 2 }]);
  assert.deepEqual(await allocationProblems(undeclared, ["shop"]), [], "a project that has not asked keeps working without the convention");
  const said = await allocationProblems(undeclared, ["shop"], { undeclaredFails: true });
  assert.equal(said.length, 2);
  assert.match(said[0] ?? "", /packages\/shop\/src\/cart\.ts declares no capability/);
  assert.match(said[0] ?? "", /"Capability 1 · /);
  assert.match(said[1] ?? "", /"Capability 2 · /);

  const declared = plant(t, {
    ...reached,
    "packages/shop/src/cart.ts": `#!/usr/bin/env node\n// Capability 1 · Cart\n${SHOP["packages/shop/src/cart.ts"]}`,
    "packages/shop/src/refund.ts": `/** Capability 2 · Refunds */\n${SHOP["packages/shop/src/refund.ts"]}`,
  });
  assert.deepEqual(await allocationProblems(declared, ["shop"], { undeclaredFails: true }), []);
  const unreached = plant(t, { ...SHOP, "packages/shop/src/cart.ts": `/** Capability 1 · Cart */\n${SHOP["packages/shop/src/cart.ts"]}` });
  const [only = "", ...rest] = await allocationProblems(unreached, ["shop"], { undeclaredFails: true });
  assert.deepEqual(rest, [], "a file nothing reaches is named once, as unallocated");
  assert.match(only, /refund\.ts \(2 lines\) belongs to no capability/);
});
