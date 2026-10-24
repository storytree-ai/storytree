// increment_f465972caeaf: `pnpm test` tests several units at once, slowest first, so a full run is
// paced by its slowest unit rather than the sum of them all.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { removeTemp } from "@storytree/test-waits";

import { DEFAULT_JOBS, runPool, shardPlan, shardUnits, slowestFirst, takeShard, testJobs } from "./unit-pool.mjs";

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
  t.after(() => removeTemp(root));
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
  const native = { platform: "linux", arch: "x64" }; // not the machine this test runs on
  assert.deepEqual(testJobs({ env: {}, cpus: 12, ...native }), { jobs: DEFAULT_JOBS, source: "default" });
  assert.deepEqual(testJobs({ env: {}, cpus: 2, ...native }), { jobs: 1, source: "default" }, "a core is left for the Postgres and the browsers");
  assert.deepEqual(testJobs({ env: {}, cpus: 1, ...native }), { jobs: 1, source: "default" });
  assert.deepEqual(testJobs({ env: { STORYTREE_TEST_JOBS: "4" }, cpus: 2, ...native }), { jobs: 4, source: "STORYTREE_TEST_JOBS" });
  assert.deepEqual(testJobs({ flag: "1", env: { STORYTREE_TEST_JOBS: "4" } }), { jobs: 1, source: "--jobs" });
  for (const bad of ["0", "two", "1.5", ""]) assert.throws(() => testJobs({ flag: bad, env: {} }), /--jobs is a whole number/);
});

// increment_3f535ac2dc4e: the Surface Pro (Windows arm64, 12 cores) failed every full run at two
// units at once, and passed one at a time in the same 16 minutes.
test("6.13 · where the test Postgres runs under emulation the default is one unit at a time, with the reason; --jobs and STORYTREE_TEST_JOBS still decide", () => {
  const emulated = { platform: "win32", arch: "arm64", cpus: 12 };
  const { jobs, source } = testJobs({ env: {}, ...emulated });
  assert.equal(jobs, 1);
  assert.match(source, /^default: .*emulation/);
  assert.equal(testJobs({ env: {}, platform: "win32", arch: "x64", cpus: 4 }).jobs, DEFAULT_JOBS, "Windows on x64 runs it natively");
  assert.equal(testJobs({ env: {}, platform: "darwin", arch: "arm64", cpus: 3 }).jobs, DEFAULT_JOBS, "arm64 elsewhere has a build of its own");
  assert.deepEqual(testJobs({ flag: "2", env: {}, ...emulated }), { jobs: 2, source: "--jobs" });
  assert.deepEqual(testJobs({ env: { STORYTREE_TEST_JOBS: "2" }, ...emulated }), { jobs: 2, source: "STORYTREE_TEST_JOBS" });
});

test("6.12 · a unit run alone starts only once every other unit has ended, and nothing starts beside it", async () => {
  let now = 0;
  const log = [];
  await runPool(["proof", "a", "b", "c"], 2, async (unit) => {
    log.push([unit, ++now]);
    await delay(unit === "a" ? 40 : 10);
    now--;
  }, { alone: (unit) => unit === "proof" });
  assert.deepEqual(log.map(([unit]) => unit), ["a", "b", "c", "proof"]);
  assert.equal(log.find(([unit]) => unit === "proof")[1], 1, "nothing else was running when it started");
});

test("6.23 · shards split the units longest-first onto the lightest shard, so their times are near equal; a unit with no pass weighs the known median", () => {
  const times = { "packages/cli": 330_000, "packages/a": 200_000, "packages/b": 150_000, "packages/c": 120_000, "packages/d": 60_000 };
  const units = ["packages/a", "packages/b", "packages/c", "packages/cli", "packages/d", "packages/new"];
  const shards = shardUnits(units, 2, { history: (unit) => times[unit] });
  assert.deepEqual(shards, [
    ["packages/cli", "packages/new"],
    ["packages/a", "packages/b", "packages/c", "packages/d"],
  ]);
  assert.deepEqual(shardUnits(units, 2, { history: (unit) => times[unit] }), shards, "every shard decides the same split");
  assert.deepEqual(shards.flat().toSorted(), units.toSorted(), "every unit is in exactly one shard");
  assert.deepEqual(shardUnits(["x", "y", "z"], 2), [["x", "z"], ["y"]], "with no history every unit weighs the same, in the order given");
  assert.deepEqual(shardUnits(["x"], 2), [["x"], []]);
});

test("6.23 · a shard's plan names every shard's units, one line each, and a shard with none says so", () => {
  assert.equal(shardPlan([["packages/cli", "packages/new"], []]), "shard 1/2: packages/cli, packages/new\nshard 2/2: none\n");
});

test("6.23 · --shard=<i>/<n> is taken from the arguments as shard i of n; one malformed or out of range is refused", () => {
  assert.deepEqual(takeShard(["--full", "--shard=2/2", "a.test.mjs"]), { shard: { index: 2, count: 2 }, argv: ["--full", "a.test.mjs"], refusal: undefined });
  assert.deepEqual(takeShard(["--full"]), { shard: undefined, argv: ["--full"], refusal: undefined });
  for (const bad of ["--shard=3/2", "--shard=0/2", "--shard=1/1", "--shard=a/2", "--shard=1"]) {
    assert.match(takeShard([bad]).refusal ?? "", /--shard=<i>\/<n>/, bad);
  }
});
