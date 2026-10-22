// Whether land.yml retries a refused enqueue: the rule lives in packages/dev-loop/src/land-enqueue.mjs,
// which the land job runs on each refusal.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { enqueueDecision, RETRY_WINDOW_SECONDS } from "./land-enqueue.mjs";

const queued = 'gh: Required status check "verify" is queued';
const expected = 'gh: Required status check "verify" is expected.';

test("7.8 a refusal reading verify as queued or expected is retried for minutes, not seconds, and stops past the window", () => {
  for (const refusal of [queued, expected]) {
    assert.equal(enqueueDecision(refusal, 75).retry, true, "PR #1684 was refused for 75 s after verify passed");
    assert.equal(enqueueDecision(refusal, 240).retry, true);
    const late = enqueueDecision(refusal, RETRY_WINDOW_SECONDS);
    assert.equal(late.retry, false);
    assert.match(late.reason, /still reads/);
  }
  assert.ok(RETRY_WINDOW_SECONDS <= 360, "the window stays bounded inside the job's timeout");
});

test("7.8 any other refusal is not retried, however early", () => {
  const other = enqueueDecision("gh: Pull request is not mergeable: the base branch policy prohibits the merge", 0);
  assert.equal(other.retry, false);
  assert.match(other.reason, /not one this job retries/);
});

test("7.8 the land job's command line exits 0 to retry and 1 to stop, reading the refusal on stdin", () => {
  const script = fileURLToPath(new URL("./land-enqueue.mjs", import.meta.url));
  const run = (seconds, input) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [script, String(seconds)], { input, encoding: "utf8" }) };
    } catch (error) {
      return { code: error.status, out: error.stdout };
    }
  };
  assert.equal(run(90, queued).code, 0);
  assert.equal(run(90, "some other refusal").code, 1);
  assert.match(run(90, "some other refusal").out, /::error::/);
});
