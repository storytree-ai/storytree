/** Property checks 2.1-2.3: the quick tier's fixed seeds, its budgets, and the line each run keeps for the reviewer. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { DEFAULT_SEEDS, fc, propertyCheck } from "./index.js";

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "property-checks-"));
  t.after(() => removeTemp(dir));
  return dir;
}

const T0 = Date.UTC(2026, 10, 18, 9, 30, 0);

/** A clock that stands still until the property moves it, once, by `ms`. */
function slowOnce(ms: number) {
  let at = T0;
  let moved = false;
  return {
    now: () => at,
    property: () =>
      fc.property(fc.integer(), () => {
        if (!moved) {
          moved = true;
          at += ms;
        }
        return true;
      }),
  };
}

const why = { judged: "the quick tier is the build loop's guard" };

test("2.1 · with no tier set a check runs each default seed and each pinned seed for its runs, the same inputs every run", async (t) => {
  const generated = async () => {
    const seen: number[] = [];
    const property = fc.property(fc.integer(), (n) => {
      seen.push(n);
      return true;
    });
    await propertyCheck(t, { why, seeds: [424242], runs: 5 }, property, { env: {}, tallyPath: path.join(tempDir(t), "tally") });
    return seen;
  };

  const first = await generated();
  assert.ok(DEFAULT_SEEDS.length > 0, "a default list of seeds");
  const expected = [...DEFAULT_SEEDS, 424242].flatMap((seed) => fc.sample(fc.integer(), { seed, numRuns: 5 }));
  assert.deepEqual(first, expected, "five cases on each default seed, then on the pinned seed");
  assert.deepEqual(await generated(), first, "a second run generates the same inputs");
});

test("2.2 · a check over its quick-tier budget fails naming the budget, scaled by the platform's factor", async (t) => {
  const tallyPath = () => path.join(tempDir(t), "tally");
  const over = slowOnce(5_000);
  await assert.rejects(async () => propertyCheck(t, { why }, over.property(), { env: {}, now: over.now, platform: "linux", tallyPath: tallyPath() }), (error: Error) => {
    assert.match(error.message, /quick-tier budget/);
    assert.match(error.message, /\b2 s\b/, "Linux's budget is 2 s");
    return true;
  });

  const scaledUnder = slowOnce(5_000);
  await propertyCheck(t, { why }, scaledUnder.property(), { env: {}, now: scaledUnder.now, platform: "win32", tallyPath: tallyPath() });

  const scaledOver = slowOnce(9_000);
  await assert.rejects(async () => propertyCheck(t, { why }, scaledOver.property(), { env: {}, now: scaledOver.now, platform: "win32", tallyPath: tallyPath() }), (error: Error) => {
    assert.match(error.message, /quick-tier budget/);
    assert.match(error.message, /\b8 s\b/, "Windows' factor of 4 makes it 8 s");
    return true;
  });
});

test("2.2 · the check that takes its package's checks past 30 s fails naming the package budget", async (t) => {
  const tallyPath = path.join(tempDir(t), "tally");
  for (let i = 1; i <= 15; i++) {
    const check = slowOnce(1_900);
    await propertyCheck(t, { why }, check.property(), { env: {}, now: check.now, platform: "linux", tallyPath });
  }
  const sixteenth = slowOnce(1_900);
  await assert.rejects(async () => propertyCheck(t, { why }, sixteenth.property(), { env: {}, now: sixteenth.now, platform: "linux", tallyPath }), (error: Error) => {
    assert.match(error.message, /package budget/);
    assert.match(error.message, /\b30 s\b/);
    return true;
  });
});

test("2.3 · under pnpm test each run of a check adds one line to the property-runs record, and none outside it", async (t) => {
  const dir = tempDir(t);
  mkdirSync(path.join(dir, ".pgtest"));
  const recordPath = path.join(dir, ".pgtest", "property-runs.jsonl");
  const env = { STORYTREE_TEST_RUNNING: path.join(dir, "running") };
  const tallyPath = path.join(dir, "tally");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  const file = path.relative(process.cwd(), fileURLToPath(import.meta.url)).split(path.sep).join("/");
  const seeds = [...DEFAULT_SEEDS, 99];
  const base = { at: new Date(T0).toISOString(), head, file, test: t.name, contract: "2.3", why, tier: "quick", seeds, runs: 5 };

  const passing = slowOnce(250);
  await propertyCheck(t, { why, seeds: [99], runs: 5 }, passing.property(), { env, now: passing.now, platform: "linux", recordPath, tallyPath });

  let message = "";
  const failing = fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => n <= 1000);
  await assert.rejects(async () => propertyCheck(t, { why, seeds: [99], runs: 5 }, failing, { env, now: () => T0, platform: "linux", recordPath, tallyPath }), (error: Error) => {
    message = error.message;
    return true;
  });
  const replay = /STORYTREE_PROPERTY_SEED=(-?\d+) STORYTREE_PROPERTY_PATH=(\S+)/.exec(message);
  assert.ok(replay, `the replay line is in the failure:\n${message}`);

  const over = slowOnce(3_000);
  await assert.rejects(async () => propertyCheck(t, { why, seeds: [99], runs: 5 }, over.property(), { env, now: over.now, platform: "linux", recordPath, tallyPath }), /quick-tier budget/);

  const outside = slowOnce(10);
  await propertyCheck(t, { why, seeds: [99], runs: 5 }, outside.property(), { env: {}, now: outside.now, platform: "linux", recordPath, tallyPath });

  const rows = readFileSync(recordPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(rows, [
    { ...base, ms: 250, result: "pass" },
    { ...base, ms: 0, result: "fail", seed: Number(replay[1]), path: replay[2] },
    { ...base, ms: 3_000, result: "over-budget" },
  ]);
});
