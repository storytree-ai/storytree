/**
 * Capability 2 · The allocation rule (the Guardrails story): a story package's source file no numbered
 * test reaches fails, on a small project laid out as the habits card says (ADR-0900 D1).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { allocationProblems, unallocatedCode } from "./allocation-rule.js";

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
