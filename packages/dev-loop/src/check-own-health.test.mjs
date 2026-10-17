// Storytree's own health is CI health's recording of a test run, configured for storytree (ADR-1066 D2 G): this checks
// the configuration's own part, that a story's tests run through this repo's harness and come back as their junit
// report's results, which CI health's rules then judge.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runStoryTests } from "./check-own-health.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("5.13 · `pnpm check:own-health` runs a story's tests through this repo's harness and reads back each one's result from their junit report", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "own-health-run-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "kettle.test.mjs");
  writeFileSync(file, [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'test("1.1 boils", () => {});',
    'test("1.2 pours", () => assert.fail("spilt"));',
    'test("1.3 whistles", { skip: "owner: needs a kettle" }, () => {});',
  ].join("\n"));
  const run = await runStoryTests([file], root);
  assert.notEqual(run.code, 0, "a failing test fails the run");
  assert.deepEqual(run.results?.map(({ name, status }) => [name, status]), [["1.1 boils", "passed"], ["1.2 pours", "failed"], ["1.3 whistles", "skipped"]]);
  assert.equal(run.results?.find(({ name }) => name === "1.3 whistles")?.message, "owner: needs a kettle");
});
