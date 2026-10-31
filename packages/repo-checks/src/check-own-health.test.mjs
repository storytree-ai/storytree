// Storytree's own health is CI health's recording of a test run, configured for storytree (ADR-1066 D2 G): this checks
// the configuration's own part, that a story's tests run through this repo's harness and come back as their junit
// report's results, which CI health's rules then judge.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { runStoryTests } from "./check-own-health.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("7.12 · `pnpm check:own-health` runs a story's tests through this repo's harness and reads back each one's result from their junit report", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "own-health-run-"));
  t.after(() => removeTemp(folder));
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

test("7.12 · `pnpm check:own-health` runs the stories' tests without the library's sign-in: no PG* or HEALTH_PG_* variable reaches them", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "own-health-env-"));
  const given = { PGPASSWORD: "not-for-tests", PGUSER: "storytree-ci-health", HEALTH_PG_ADDRESS: "postgres://library.example:5432/postgres" };
  const before = Object.fromEntries(Object.keys(given).map((name) => [name, process.env[name]]));
  Object.assign(process.env, given);
  t.after(async () => {
    for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await removeTemp(folder);
  });
  const file = path.join(folder, "sealed.test.mjs");
  writeFileSync(file, [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'test("1.1 sees no sign-in", () => assert.deepEqual(Object.keys(process.env).filter((name) => /^(PG|HEALTH_PG_)/.test(name)), []));',
  ].join("\n"));
  const run = await runStoryTests([file], root);
  assert.deepEqual(run.results?.map(({ name, status, message }) => [name, status, message]), [["1.1 sees no sign-in", "passed", undefined]]);
});
