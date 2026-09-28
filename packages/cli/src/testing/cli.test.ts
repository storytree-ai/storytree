import assert from "node:assert/strict";
import { test } from "node:test";

import { assertExitCode } from "./cli.js";

// App setup 2.1 / 2.2: a usage refusal must be distinguishable from a failed command load.
test("a wrong built-command exit code reports both child streams and the command context", () => {
  const ran = { code: 1, stderr: "Cannot load installed command\n", stdout: "starting setup\n" };
  assert.throws(() => assertExitCode(ran, 2, "setup disconnect both"), (error: unknown) => {
    assert.ok(error instanceof assert.AssertionError);
    assert.equal(error.actual, 1);
    assert.equal(error.expected, 2);
    assert.match(error.message, /setup disconnect both/);
    assert.match(error.message, /stderr:\nCannot load installed command/);
    assert.match(error.message, /stdout:\nstarting setup/);
    return true;
  });
  assertExitCode({ ...ran, code: 2 }, 2);
});
