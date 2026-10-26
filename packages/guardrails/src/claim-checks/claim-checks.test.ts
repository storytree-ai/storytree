/** Capability 2 · The allocation rule, as the claim check Guardrails contributes to the claim front doors (ADR-1170 D2). */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { claimChecks } from "./claim-checks.js";

const FILES = {
  "packages/shop/package.json": JSON.stringify({ name: "@x/shop" }),
  "packages/shop/src/cart.ts": "export const add = (a: number, b: number) => a + b;\n",
  "packages/shop/src/cart.test.ts": 'import { test } from "node:test";\nimport { add } from "./cart.js";\ntest("1.1 · adds", () => add(1, 2));\n',
  "packages/shop/src/refund.ts": "export const refund = () => 0;\n",
};

const library = { projectTree: async () => ({ stories: [{ id: "story_shop", title: "Shop", capabilities: [{ id: "capability_cart" }] }] }) };

test("2.5 · Guardrails contributes its allocation rule as a claim check: for a capability, the source files of its story's package no numbered test reaches; none for a capability the plan lacks (ADR-1170 D2)", async (t: TestContext) => {
  const folder = mkdtempSync(path.join(tmpdir(), "claim-check-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  assert.deepEqual(claimChecks.map((check) => check.name), ["allocation"]);
  const [check] = claimChecks;
  const [problem = "", ...rest] = await check!.landing("capability_cart", { library, folder });
  assert.deepEqual(rest, []);
  assert.match(problem, /packages\/shop\/src\/refund\.ts/);
  assert.match(problem, /number a test that reaches it/);
  assert.deepEqual(await check!.landing("capability_elsewhere", { library, folder }), [], "a capability the plan lacks is held by nothing");
});
