/** Property checks 1.1 and 1.2: a check runs only inside a numbered test, names why it exists, and names the seed that replays its failure. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { DEFAULT_SEEDS, fc, propertyCheck } from "./index.js";

/** A fresh package-budget tally per test, so no test's time counts against another's. */
function tally(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "property-checks-"));
  t.after(() => removeTemp(dir));
  return path.join(dir, "tally");
}

const always = () => fc.property(fc.integer(), () => true);
const REPLAY = /STORYTREE_PROPERTY_SEED=(-?\d+) STORYTREE_PROPERTY_PATH=(\S+)/;

test("1.1 · a check refuses to run with no test context, an unnumbered test or no reason it exists, naming what is missing", async (t) => {
  const io = { env: {}, tallyPath: tally(t) };
  await assert.rejects(async () => propertyCheck(undefined as unknown as TestContext, { why: { judged: "parsing is easy to get wrong" } }, always(), io), /test context/);

  for (const name of ["a check in a test named without its contract", "1.1 without its separator"]) {
    await t.test(name, async (unnumbered) => {
      await assert.rejects(async () => propertyCheck(unnumbered, { why: { judged: "parsing is easy to get wrong" } }, always(), io), /contract number/);
    });
  }

  for (const why of [{}, { judged: "" }] as never[]) {
    await assert.rejects(async () => propertyCheck(t, { why }, always(), io), (error: Error) => {
      assert.match(error.message, /why/);
      assert.match(error.message, /pattern/);
      assert.match(error.message, /judged/);
      return true;
    });
  }

  await propertyCheck(t, { why: { judged: "parsing is easy to get wrong" } }, always(), io);
  await propertyCheck(t, { why: { pattern: "pattern_off-by-one" } }, always(), io);
});

test("1.2 · a failing check names its counterexample, seed, path and replay line, and that seed and path replay the same input alone", async (t) => {
  const failing = (seen: number[]) =>
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
      seen.push(n);
      return n <= 1000;
    });

  let message = "";
  await assert.rejects(async () => propertyCheck(t, { why: { judged: "a bound is easy to get wrong" } }, failing([]), { env: {}, tallyPath: tally(t) }), (error: Error) => {
    message = error.message;
    return true;
  });
  assert.match(message, /Counterexample: \[1001\]/, "fast-check's shrunk counterexample");
  const replay = REPLAY.exec(message);
  assert.ok(replay, `the replay line is in the failure:\n${message}`);
  const [, seed = "", replayPath = ""] = replay;
  assert.ok(DEFAULT_SEEDS.includes(Number(seed)), `the seed named (${seed}) is one the quick tier ran`);
  assert.match(message, new RegExp(`seed: ${seed}, path: "${replayPath}"`), "fast-check's own seed and path");

  const seen: number[] = [];
  await assert.rejects(
    async () => propertyCheck(t, { why: { judged: "a bound is easy to get wrong" } }, failing(seen), { env: { STORYTREE_PROPERTY_SEED: seed, STORYTREE_PROPERTY_PATH: replayPath }, tallyPath: tally(t) }),
    /Counterexample: \[1001\]/,
  );
  assert.equal(seen[0], 1001, "the replay's first input is the counterexample");
  assert.ok(
    seen.every((n) => n <= 1001),
    `only that path ran, no other seed's inputs: ${seen.join(", ")}`,
  );
});
