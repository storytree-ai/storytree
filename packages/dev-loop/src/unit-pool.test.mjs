// increment_f465972caeaf: `pnpm test` tests several units at once, slowest first, so a full run is
// paced by its slowest unit rather than the sum of them all.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_JOBS, runPool, slowestFirst, testJobs } from "./unit-pool.mjs";

test("6.10 · a pool runs at most its jobs at once, starts the next as one ends, and starts none once stopped", async () => {
  let now = 0;
  let most = 0;
  const started = [];
  await runPool(["a", "b", "c", "d", "e"], 2, async (unit) => {
    started.push(unit);
    most = Math.max(most, ++now);
    await delay(unit === "a" ? 60 : 10);
    now--;
  });
  assert.equal(most, 2);
  assert.deepEqual(started, ["a", "b", "c", "d", "e"]);

  let stop = false;
  const ran = [];
  await runPool(["a", "b", "c", "d"], 2, async (unit) => {
    ran.push(unit);
    await delay(5);
    stop = true;
  }, { stopped: () => stop });
  assert.deepEqual(ran, ["a", "b"], "the two running finish; nothing more starts");
});

test("6.10 · units start slowest first: by this machine's recent passes, then a unit with none by the size of its tests", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "unit-pool-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tests = { "packages/small": 10, "packages/big": 5_000, "packages/mid": 500, "packages/timed": 1 };
  for (const [unit, bytes] of Object.entries(tests)) {
    mkdirSync(path.join(root, unit, "src", "deep"), { recursive: true });
    writeFileSync(path.join(root, unit, "src", "deep", "a.test.ts"), "x".repeat(bytes));
    writeFileSync(path.join(root, unit, "src", "not-a-test.ts"), "x".repeat(100_000));
  }
  writeFileSync(path.join(root, "packages", "one.test.mjs"), "x".repeat(800));
  const units = ["packages/small", "packages/big", "packages/one.test.mjs", "packages/mid", "packages/timed"];
  assert.deepEqual(slowestFirst(units, { root }), ["packages/big", "packages/one.test.mjs", "packages/mid", "packages/small", "packages/timed"]);
  const history = (unit) => ({ "packages/timed": 90_000, "packages/small": 120_000 })[unit];
  assert.deepEqual(slowestFirst(units, { root, history }), ["packages/small", "packages/timed", "packages/big", "packages/one.test.mjs", "packages/mid"]);
});

test("6.10 · how many units run at once: --jobs, else STORYTREE_TEST_JOBS, else the default, leaving a core free; anything but a whole number from 1 is refused", () => {
  assert.deepEqual(testJobs({ env: {}, cpus: 12 }), { jobs: DEFAULT_JOBS, source: "default" });
  assert.deepEqual(testJobs({ env: {}, cpus: 3 }), { jobs: 2, source: "default" }, "a core is left for the Postgres and the browsers");
  assert.deepEqual(testJobs({ env: {}, cpus: 1 }), { jobs: 1, source: "default" });
  assert.deepEqual(testJobs({ env: { STORYTREE_TEST_JOBS: "4" }, cpus: 2 }), { jobs: 4, source: "STORYTREE_TEST_JOBS" });
  assert.deepEqual(testJobs({ flag: "1", env: { STORYTREE_TEST_JOBS: "4" } }), { jobs: 1, source: "--jobs" });
  for (const bad of ["0", "two", "1.5", ""]) assert.throws(() => testJobs({ flag: bad, env: {} }), /--jobs is a whole number/);
});
