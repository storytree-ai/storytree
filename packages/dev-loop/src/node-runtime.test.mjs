// Which Node.js may run the tests (packages/dev-loop/src/node-runtime.mjs). On Windows, a Node.js whose libuv
// leaves the size of an OSVERSIONINFOW unset before RtlGetVersion (libuv#5107) can end a process on
// any TCP connect: in `pnpm test`, a test file dies at its first connection to the test Postgres
// with exit code 0xC0000409 and prints nothing. The harness refuses such a Node.js, saying which
// release to install instead. Which releases carry the fix is restated here from Node's own
// changelog (24.16.0, 26.1.0), not taken from the code.
import assert from "node:assert/strict";
import { test } from "node:test";

import { runtimeRefusal } from "./node-runtime.mjs";

test("on Windows, a Node.js without libuv's fix is refused, naming it, the crash it causes and the release that fixes it", () => {
  // 24.x before 24.16.0, every 25.x and 26.0.x ship libuv without the fix, as do the older lines.
  for (const version of ["v24.0.0", "v24.14.1", "v24.15.0", "v25.0.0", "v25.9.0", "v26.0.0", "v22.23.0", "v20.20.0"]) {
    const refusal = runtimeRefusal(version, "win32");
    assert.equal(typeof refusal, "string", `${version} is refused`);
    assert.ok(refusal.includes(`Node.js ${version}`), `the refusal names ${version}: ${refusal}`);
    assert.match(refusal, /0xC0000409/, "and the crash, as a test run shows it");
    assert.match(refusal, /\b24\.16\.0\b/, "and the release to install");
    assert.match(refusal, /\bwinget upgrade OpenJS\.NodeJS\.LTS\b/, "and the command that installs it");
  }
});

test("on Windows, Node.js 24.16.0 and later 24.x, 26.1.0 and later, and every line after 26 run the tests", () => {
  for (const version of ["v24.16.0", "v24.21.0", "v24.100.3", "v26.1.0", "v26.10.0", "v27.0.0", "v31.4.1"]) {
    assert.equal(runtimeRefusal(version, "win32"), undefined, version);
  }
});

test("the bug is in libuv's Windows TCP code, so off Windows no Node.js is refused for it", () => {
  for (const platform of ["linux", "darwin"]) {
    for (const version of ["v24.15.0", "v25.9.0", "v26.0.0"]) {
      assert.equal(runtimeRefusal(version, platform), undefined, `${version} on ${platform}`);
    }
  }
});

test("by default it judges the Node.js and the platform it runs on", () => {
  assert.equal(runtimeRefusal(), runtimeRefusal(process.version, process.platform));
});
