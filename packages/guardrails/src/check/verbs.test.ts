/**
 * Capability 3 · The check command: the `check` verb Guardrails declares for the command line to mount, run with no
 * caller in a folder that is no project, as the command line hands a callerless verb.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { VerbRefusal, type DoorWords } from "@storytree/project-and-caller/verbs";

import { CHECK_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

/** A checkout holding `files` (repo-relative path to text), removed after the test. */
function plant(t: TestContext, files: Record<string, string>): string {
  const at = mkdtempSync(path.join(tmpdir(), "check-verb-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  return at;
}

const CART = {
  "packages/cart/package.json": JSON.stringify({ name: "cart" }),
  "packages/cart/src/cart.js": "export const add = (a, b) => a + b;\n",
  "packages/cart/test/cart.test.js": 'import { test } from "node:test";\nimport { add } from "../src/cart.js";\ntest("1.1 adds", () => add(1, 2));\n',
};

test("3.7 · Guardrails declares the `check` verb the command line mounts: run with no caller, in a folder that is no project, it answers with the check's report and refuses with it when a rule is broken", async (t: TestContext) => {
  const [family] = CHECK_FAMILIES;
  assert.equal(family!.name, "check");
  const check = family!.bare!;
  assert.equal(check.callerless, true);

  const kept = await check.act({}, { folder: plant(t, CART) }, WORDS);
  assert.match(kept.text, /storytree check passed/);

  await assert.rejects(
    check.act({}, { folder: plant(t, { ...CART, "packages/cart/src/refund.js": "export const refund = () => 0;\n" }) }, WORDS),
    (error: unknown) => error instanceof VerbRefusal && !error.misuse && /packages\/cart\/src\/refund\.js .*belongs to no capability/.test(error.message) && /storytree check failed/.test(error.message),
  );
});
