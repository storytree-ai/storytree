// The test runner's reporter (packages/dev-loop/src/test-running-reporter.mjs), fed the events node's
// test runner emits: a file whose process failed is named with how it ended and its own stderr.
import assert from "node:assert/strict";
import { test } from "node:test";

import running from "./test-running-reporter.mjs";

test("6.6 a file whose process failed is named with its exit code or signal and its own stderr tail, apart from another file's", async () => {
  const failure = (file, error) => ({ type: "test:fail", data: { file, name: file, nesting: 0, details: { error } } });
  const events = [
    { type: "test:stderr", data: { file: "/w/exit.test.mjs", message: "loader stopped\n" } },
    { type: "test:stderr", data: { file: "/w/healthy.test.mjs", message: "a neighbour's stderr\n" } },
    failure("/w/exit.test.mjs", { failureType: "testCodeFailure", exitCode: 7, code: "ERR_TEST_FAILURE", message: "test failed" }),
    failure("/w/signal.test.mjs", { failureType: "testCodeFailure", signal: "SIGTERM", code: "ERR_TEST_FAILURE", message: "test failed" }),
    { type: "test:summary", data: {} },
  ];
  let out = "";
  for await (const chunk of running((async function* () { yield* events; })())) out += chunk;
  assert.match(out, /test harness: file failures/);
  assert.match(out, /\/w\/exit\.test\.mjs\n  exit code: 7; signal: none\n  stderr:\n  loader stopped\n  ERR_TEST_FAILURE: test failed/);
  assert.match(out, /\/w\/signal\.test\.mjs\n  exit code: none; signal: SIGTERM\n  stderr: \(empty\)/);
  assert.doesNotMatch(out, /neighbour/);
});
