// ADR-0731 / increment_4745a73cdd64: `pnpm test` and the gate always end, and name what hung. Each test runs a
// real `node --test` unit over a fixture file, with the limits cut to seconds.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { recordTimings, runUnit, unitReason } from "./unit-run.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "unit-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return root;
}

/** Run quietly, keeping what the unit printed. */
function captured() {
  const out = { text: "" };
  return { out, options: { stdio: ["ignore", "pipe", "pipe"], onSpawn: (child) => {
    child.stdout.on("data", (chunk) => (out.text += chunk));
    child.stderr.on("data", (chunk) => (out.text += chunk));
  } } };
}

test("a test that fails leaving a handle open ends its unit with that failure, not a hang", async (t) => {
  const root = fixture(t, {
    "leak.test.mjs": `import { test } from "node:test"; import assert from "node:assert"; import net from "node:net";
test("fails holding a server", () => { net.createServer().listen(0); assert.equal(1, 2); });`,
  });
  const { out, options } = captured();
  const result = await runUnit({ root, files: ["leak.test.mjs"], env: process.env, unitLimitMs: 30_000, ...options });
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false, "it ended by itself, well before the unit's deadline");
  assert.match(out.text, /✖ fails holding a server/, "with the test's own failure");
});

test("a test that never ends fails at the per-test limit, and the unit goes on to end", async (t) => {
  const root = fixture(t, {
    "stuck.test.mjs": `import { test } from "node:test";
test("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));`,
  });
  const { out, options } = captured();
  const result = await runUnit({ root, files: ["stuck.test.mjs"], env: process.env, testLimitMs: 1_000, unitLimitMs: 30_000, ...options });
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.match(out.text, /✖ never ends[\s\S]*timed out after 1000ms/, "node names the test and its limit");
});

test("a unit past its deadline is killed with its whole process tree, naming the test still running", async (t) => {
  // Detached, the wedged child leaves Windows' kill-on-close job and the Unix process group, as a
  // tool's own children may: only a kill that walks the process tree reaches it.
  const pidFile = path.join(tmpdir(), `unit-run-grandchild-${process.pid}.txt`);
  t.after(() => {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8")));
    } catch {} // killed by the harness, as it should be
    rmSync(pidFile, { force: true });
  });
  const root = fixture(t, {
    "wedged.test.mjs": `import { test } from "node:test"; import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
test("finishes", () => {});
test("waits on a wedged child", () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  return new Promise(() => {});
});`,
  });
  const started = Date.now();
  const result = await runUnit({ root, files: ["wedged.test.mjs"], env: process.env, testLimitMs: 60_000, unitLimitMs: 3_000, ...captured().options });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 20_000, "it ended soon after its deadline");
  assert.deepEqual(result.running.map((entry) => entry.name), ["waits on a wedged child"]);
  assert.match(result.running[0].file, /wedged\.test\.mjs$/);

  const grandchild = Number(readFileSync(pidFile, "utf8"));
  let alive = true;
  for (let tries = 0; alive && tries < 50; tries++) {
    try {
      process.kill(grandchild, 0);
      await delay(100);
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, "the test's own child process was killed too");

  const reason = unitReason({ ...result, unitLimitMs: 3_000 }, root);
  assert.match(reason, /timed out/);
  assert.match(reason, /limit 3(\.0)? s/);
  assert.match(reason, /wedged\.test\.mjs › waits on a wedged child/);
});

test("each unit's time is added to the machine's timing history, outside the checkout", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  recordTimings({ scripts: { result: "pass", ms: 1234 }, cli: { result: "fail", ms: 180_000, timedOut: true } }, { home });
  recordTimings({ scripts: { result: "pass", ms: 1500 } }, { home });
  const lines = readFileSync(path.join(home, "test-timings.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map(({ unit, result, ms, timedOut }) => ({ unit, result, ms, timedOut })), [
    { unit: "scripts", result: "pass", ms: 1234, timedOut: false },
    { unit: "cli", result: "fail", ms: 180_000, timedOut: true },
    { unit: "scripts", result: "pass", ms: 1500, timedOut: false },
  ]);
  assert.equal(lines[0].platform, process.platform);
  assert.equal(lines[0].arch, process.arch);
});
