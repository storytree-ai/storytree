/**
 * Capability 3 · The check command (the Guardrails story): both rules over a small project laid out as
 * the habits card says (ADR-0900 D1), with nothing but the checkout to read.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { check, checkoutOf } from "../index.js";

import { main } from "./run.js";

const RUN = fileURLToPath(new URL("./run.ts", import.meta.url));

/** A checkout holding `files` (repo-relative path to text), removed after the test. */
function plant(t: TestContext, files: Record<string, string>): string {
  const at = mkdtempSync(path.join(tmpdir(), "check-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  return at;
}

const KEPT = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["packages/cart", "packages/checkout"] }),
  "packages/cart/package.json": JSON.stringify({ name: "cart" }),
  "packages/cart/src/cart.js": "export const add = (a, b) => a + b;\n",
  "packages/cart/test/cart.test.js": 'import { test } from "node:test";\nimport { add } from "../src/cart.js";\ntest("1.1 adds", () => add(1, 2));\n',
  "packages/checkout/package.json": JSON.stringify({ name: "checkout", dependencies: { cart: "*" } }),
  "packages/checkout/src/pay.js": "export const pay = () => 0;\n",
  "packages/checkout/test/pay.test.js": 'import { test } from "node:test";\nimport { pay } from "../src/pay.js";\ntest("1.1 pays", () => pay());\n',
};

test("3.1 · a checkout that keeps both rules passes, saying so", async (t: TestContext) => {
  const report = await check(plant(t, KEPT));
  assert.equal(report.passed, true, report.text);
  assert.match(report.text, /package rule: kept/);
  assert.match(report.text, /allocation rule: kept/);
  assert.match(report.text, /passed/);
});

test("3.1 · a checkout that breaks either rule fails, naming every problem", async (t: TestContext) => {
  const report = await check(plant(t, {
    ...KEPT,
    "packages/cart/package.json": JSON.stringify({ name: "cart", devDependencies: { checkout: "*" } }),
    "packages/checkout/src/refund.js": "export const refund = () => 0;\n",
  }));
  assert.equal(report.passed, false);
  assert.equal(report.packageRule.length, 1, report.text);
  assert.match(report.text, /cart → checkout → cart/);
  assert.deepEqual(report.allocationRule.length, 1, report.text);
  assert.match(report.text, /packages\/checkout\/src\/refund\.js \(1 lines\)/);
  assert.match(report.text, /failed/);
});

test("3.2 · it reads the checkout a folder is in, and a folder outside any repository as itself", (t: TestContext) => {
  const loose = plant(t, KEPT);
  assert.equal(checkoutOf(loose), loose);
  execFileSync("git", ["init", "-q"], { cwd: loose });
  assert.equal(realpathSync.native(checkoutOf(path.join(loose, "packages", "cart"))), realpathSync.native(loose));
});

test("3.3 · run from storytree's source on a folder, as a user's CI runs it, it prints the report and exits by it", async (t: TestContext) => {
  const run = (folder: string) => spawnSync(process.execPath, ["--import", "tsx", RUN, folder], { encoding: "utf8", cwd: path.dirname(RUN) });
  let said = "";
  assert.equal(await main(plant(t, KEPT), (text) => (said += text)), 0, said);
  assert.match(said, /storytree check passed/);
  const left = run(plant(t, { ...KEPT, "packages/checkout/src/refund.js": "export const refund = () => 0;\n" }));
  assert.equal(left.status, 1, left.stderr);
  assert.match(left.stdout, /packages\/checkout\/src\/refund\.js/);
});
