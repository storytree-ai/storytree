// Which Node.js may run the tests (packages/base-dev-loop/src/node-runtime.mjs). On Windows, a Node.js whose libuv
// leaves the size of an OSVERSIONINFOW unset before RtlGetVersion (libuv#5107) can end a process on
// any TCP connect: in `pnpm test`, a test file dies at its first connection to the test Postgres
// with exit code 0xC0000409 and prints nothing. The harness refuses such a Node.js, saying which
// release to install instead. Which releases carry the fix is restated here from Node's own
// changelog (24.16.0, 26.1.0), not taken from the code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { floorRefusal, runtimeRefusal } from "./node-runtime.mjs";

test("4.3 on Windows, a Node.js without libuv's fix is refused, naming it, the crash it causes and the release that fixes it", () => {
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

test("4.3 the bug is in libuv's Windows TCP code, so off Windows no Node.js is refused for it", () => {
  for (const platform of ["linux", "darwin"]) {
    for (const version of ["v24.15.0", "v25.9.0", "v26.0.0"]) {
      assert.equal(runtimeRefusal(version, platform), undefined, `${version} on ${platform}`);
    }
  }
});

test("by default it judges the Node.js and the platform it runs on", () => {
  assert.equal(runtimeRefusal(), runtimeRefusal(process.version, process.platform));
});

// Below the floor the tested project's package.json names (engines.node), the tests can hang file by file until each
// unit's deadline: in a cloud container, Node.js 22 first on the path timed every file out at 180 s where Node.js 24
// passed the same file in 1.3 s (friction_dae7689d182a). The harness refuses such a Node.js before it runs anything.
test("4.28 a Node.js below the project's engines floor is refused, naming the floor and the Node.js it found; at or above it, or with no floor it can read, none is", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "node-floor-"));
  const bare = mkdtempSync(path.join(tmpdir(), "node-floor-bare-"));
  t.after(() => Promise.all([removeTemp(root), removeTemp(bare)]));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=24.20.0" } }));
  for (const version of ["v22.23.0", "v24.19.9", "v23.99.0"]) {
    const refusal = floorRefusal(version, root);
    assert.equal(typeof refusal, "string", `${version} is refused`);
    assert.ok(refusal.includes(`Node.js ${version}`), `the refusal names ${version}: ${refusal}`);
    assert.ok(refusal.includes(">=24.20.0"), `and the floor: ${refusal}`);
  }
  for (const version of ["v24.20.0", "v24.22.1", "v26.0.0"]) assert.equal(floorRefusal(version, root), undefined, version);

  for (const manifest of [{}, { engines: {} }, { engines: { node: "^24 || ^26" } }]) {
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    assert.equal(floorRefusal("v22.23.0", root), undefined, JSON.stringify(manifest));
  }
  assert.equal(floorRefusal("v22.23.0", bare), undefined, "no package.json");
});

test("4.28 the test run refuses at its start under a Node.js below the tested project's floor, before it starts a Postgres", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "node-floor-run-"));
  t.after(() => removeTemp(root));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=999.0.0" } }));
  const harness = pathToFileURL(fileURLToPath(new URL("./test.mjs", import.meta.url))).href;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `const { testCommand } = await import(${JSON.stringify(harness)}); testCommand({ argv: [], root: ${JSON.stringify(root)} });`],
  { encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1, `the run exits 1: ${run.stderr}`);
  assert.ok(run.stderr.includes(`Node.js ${process.version} is below this project's floor, node >=999.0.0`), run.stderr);
  assert.equal(existsSync(path.join(root, ".pgtest", "data")), false, "no test Postgres was started");
});
