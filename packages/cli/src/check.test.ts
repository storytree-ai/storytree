/**
 * Capability 12 · Check: `storytree check` in a folder that is no storytree project, with nothing but its
 * checkout to read, answers with the Guardrails story's report and exits by it.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { run } from "./door.js";

/** A checkout holding `files` (repo-relative path to text), removed after the test. */
function plant(t: TestContext, files: Record<string, string>): string {
  const at = mkdtempSync(path.join(tmpdir(), "storytree-check-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  return at;
}

/** `storytree check` run in `cwd`: its exit code and what it printed. */
async function checkIn(cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(["check"], { cwd, out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

const CART = {
  "packages/cart/package.json": JSON.stringify({ name: "cart" }),
  "packages/cart/src/cart.js": "export const add = (a, b) => a + b;\n",
  "packages/cart/test/cart.test.js": 'import { test } from "node:test";\nimport { add } from "../src/cart.js";\ntest("1.1 adds", () => add(1, 2));\n',
};

test("12.1 · `storytree check` exits 0 saying it passed on a checkout that keeps both rules, and 1 naming each problem on one that does not", async (t: TestContext) => {
  const kept = await checkIn(plant(t, CART));
  assert.equal(kept.code, 0, kept.err);
  assert.match(kept.out, /storytree check passed/);

  const left = await checkIn(plant(t, { ...CART, "packages/cart/src/refund.js": "export const refund = () => 0;\n" }));
  assert.equal(left.code, 1);
  assert.match(left.err, /packages\/cart\/src\/refund\.js .*belongs to no capability/);
  assert.match(left.err, /storytree check failed/);
});
