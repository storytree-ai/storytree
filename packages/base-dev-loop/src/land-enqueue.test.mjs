// Whether land.yml retries a refused enqueue: the rule lives in packages/base-dev-loop/src/land-enqueue.mjs,
// which the land job runs on each refusal.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { enqueueDecision, RETRY_WINDOW_SECONDS } from "./land-enqueue.mjs";

const queued = 'gh: Required status check "verify" is queued';
const expected = 'gh: Required status check "verify" is expected.';

test("5.1 a refusal reading verify as queued or expected is retried for minutes, not seconds, and stops past the window", () => {
  for (const refusal of [queued, expected]) {
    assert.equal(enqueueDecision(refusal, 75).retry, true, "PR #1684 was refused for 75 s after verify passed");
    assert.equal(enqueueDecision(refusal, 240).retry, true);
    const late = enqueueDecision(refusal, RETRY_WINDOW_SECONDS);
    assert.equal(late.retry, false);
    assert.match(late.reason, /still reads/);
  }
  assert.ok(RETRY_WINDOW_SECONDS <= 360, "the window stays bounded inside the job's timeout");
});

test("5.1 any other refusal is not retried, however early", () => {
  const other = enqueueDecision("gh: Pull request is not mergeable: the base branch policy prohibits the merge", 0);
  assert.equal(other.retry, false);
  assert.match(other.reason, /not one this job retries/);
});

test("5.1 the land job's command line exits 0 to retry and 1 to stop, reading the refusal on stdin", () => {
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

// PR #403, run 41814666825: gh got an HTML page, not JSON, back from the enqueue, although GitHub
// had enqueued the pull request in that run.
const unparseable = "invalid character '<' looking for beginning of value";

test("5.3 a failed enqueue that left the pull request in the merge queue is taken as enqueued, whatever the reply", () => {
  for (const reply of [unparseable, "some other refusal", queued]) {
    const decision = enqueueDecision(reply, 0, "AWAITING_CHECKS");
    assert.equal(decision.enqueued, true);
    assert.equal(decision.retry, false);
    assert.match(decision.reason, /AWAITING_CHECKS/);
  }
  assert.equal(enqueueDecision("some other refusal", 0, "").enqueued, false);
});

test("5.3 a reply that will not parse, with the pull request not in the queue, is tried again inside the window", () => {
  assert.equal(enqueueDecision(unparseable, 30, "").retry, true);
  assert.equal(enqueueDecision(unparseable, RETRY_WINDOW_SECONDS, "").retry, false);
});

test("5.3 with no queue entry, no decision reads the pull request as enqueued", () => {
  for (const reply of [unparseable, queued, expected, "some other refusal"]) {
    for (const seconds of [0, 90, RETRY_WINDOW_SECONDS]) {
      assert.equal(enqueueDecision(reply, seconds).enqueued, false, `${reply} at ${seconds} s`);
    }
  }
});

test("5.3 the land job's command line exits 2 when the pull request is already in the queue", () => {
  const script = fileURLToPath(new URL("./land-enqueue.mjs", import.meta.url));
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [script, ...args], { input: unparseable, encoding: "utf8" }) };
    } catch (error) {
      return { code: error.status, out: error.stdout };
    }
  };
  assert.equal(run(["10", "AWAITING_CHECKS"]).code, 2);
  assert.doesNotMatch(run(["10", "AWAITING_CHECKS"]).out, /::error::/);
  assert.equal(run(["10", ""]).code, 0);
  assert.equal(run(["10"]).code, 0);
  assert.equal(run([String(RETRY_WINDOW_SECONDS)]).code, 1, "past the window the command line stops");
});
