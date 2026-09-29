// ADR-0731 / increment_4745a73cdd64: `pnpm test` and the gate always end, and name what hung. Each test runs a
// real `node --test` unit over a fixture file, with the limits cut to seconds.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { clearUnitLimit, recordTimings, runUnit, setUnitLimit, UNIT_LIMIT_CEILING_MS, UNIT_LIMIT_FLOOR_MS, UNIT_LIMIT_MS, unitLimit, unitReason } from "./unit-run.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "unit-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return root;
}

/** Run quietly, keeping what the unit printed. */
function captured() {
  const out = { text: "", stderr: "" };
  let finish;
  const closed = new Promise((resolve) => { finish = resolve; });
  return { out, closed, options: { stdio: ["ignore", "pipe", "pipe"], onSpawn: (child) => {
    child.stdout.on("data", (chunk) => (out.text += chunk));
    child.stderr.on("data", (chunk) => { out.text += chunk; out.stderr += chunk; });
    child.once("close", finish);
  } } };
}

// increment_655d99c13fc3: a file dying before it reports any test must explain its failure.
test("file failures name the file, exit status and its own stderr under concurrent execution", async (t) => {
  const files = {
    "exit.test.mjs": `import { writeSync } from "node:fs";
writeSync(2, "loader stopped before tests\\n"); process.exit(7);`,
    "load.test.mjs": `throw new Error("cannot load relief fixture");`,
    "rejection.test.mjs": `Promise.reject(new Error("unhandled fixture rejection"));`,
    "healthy.test.mjs": `import { test } from "node:test";
console.error("a different file's stderr"); test("healthy neighbor", () => {});`,
  };
  // Windows does not preserve a Unix termination signal in a self-killed process's status.
  if (process.platform !== "win32") files["signal.test.mjs"] = `process.kill(process.pid, "SIGTERM");`;
  const root = fixture(t, files);
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: Object.keys(files), env: process.env, args: ["--test-concurrency=4"], ...options });
  await closed; // runUnit's bounded exit is earlier than the last bytes on its output pipes
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false);
  const diagnostics = out.stderr;
  assert.match(diagnostics, /test harness: file failures/);
  assert.match(diagnostics, /exit\.test\.mjs\n  exit code: 7; signal: none\n  stderr:\n  loader stopped before tests/);
  assert.match(diagnostics, /load\.test\.mjs\n  exit code: 1; signal: none\n  stderr:[\s\S]*cannot load relief fixture/);
  assert.match(diagnostics, /rejection\.test\.mjs\n  exit code: 1; signal: none\n  stderr:[\s\S]*unhandled fixture rejection/);
  if (process.platform !== "win32") assert.match(diagnostics, /signal\.test\.mjs\n  exit code: none; signal: SIGTERM\n  stderr: \(empty\)/);
  assert.doesNotMatch(diagnostics, /healthy\.test\.mjs|a different file's stderr/);
});

test("a test that fails leaving a handle open ends its unit with that failure, not a hang", async (t) => {
  const root = fixture(t, {
    "leak.test.mjs": `import { test } from "node:test"; import assert from "node:assert"; import net from "node:net";
test("fails holding a server", () => { net.createServer().listen(0); assert.equal(1, 2); });`,
  });
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: ["leak.test.mjs"], env: process.env, unitLimitMs: 30_000, ...options });
  await closed;
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false, "it ended by itself, well before the unit's deadline");
  assert.match(out.text, /✖ fails holding a server/, "with the test's own failure");
});

test("a test that never ends fails at the per-test limit, and the unit goes on to end", async (t) => {
  const root = fixture(t, {
    "stuck.test.mjs": `import { test } from "node:test";
test("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));`,
  });
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: ["stuck.test.mjs"], env: process.env, testLimitMs: 1_000, unitLimitMs: 30_000, ...options });
  await closed;
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

// increment_1fafaa291b37: each unit's deadline is learned from this machine's history, grows again
// after a kill, and any agent can set it with a reason.
function history(t, rows = []) {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-limits-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const at = "2026-09-29T00:00:00.000Z";
  const lines = rows.map(([unit, result, ms, timedOut = false]) => JSON.stringify({ at, platform: "win32", arch: "arm64", unit, result, ms, timedOut }));
  if (lines.length > 0) writeFileSync(path.join(home, "test-timings.jsonl"), `${lines.join("\n")}\n`);
  return home;
}
const machine = { platform: "win32", arch: "arm64" };
const passes = (unit, ...ms) => ms.map((each) => [unit, "pass", each]);

test("a unit with too little history on this machine keeps the fixed deadline", (t) => {
  const home = history(t, [...passes("cli", 40_000, 50_000), ...passes("forest", 1_000, 1_000, 1_000, 1_000, 1_000)]);
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  assert.equal(unitLimit("forest", { home, platform: "linux", arch: "x64" }).source, "default", "another machine's times are not this one's");
});

test("with enough passes, a unit's deadline is twice its slowest recent pass, never under the floor", (t) => {
  const home = history(t, [...passes("agent-link", 60_000, 165_000, 61_000, 70_000, 90_000), ...passes("arc-surface", 2_000, 18_000, 2_000, 2_500, 3_000)]);
  assert.deepEqual(unitLimit("agent-link", { home, ...machine }), { ms: 330_000, source: "learned" });
  assert.deepEqual(unitLimit("arc-surface", { home, ...machine }), { ms: UNIT_LIMIT_FLOOR_MS, source: "learned" });
});

test("only recent passes count, so a unit that got faster gets a tighter deadline", (t) => {
  const home = history(t, [...passes("cli", 115_000), ...Array.from({ length: 20 }, () => ["cli", "pass", 40_000])]);
  assert.equal(unitLimit("cli", { home, ...machine }).ms, 80_000);
});

test("each kill since the unit last passed doubles its next deadline, up to the ceiling", (t) => {
  const home = history(t, [...passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000), ["cli", "fail", 100_000, true]]);
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: 200_000, source: "learned, grown after 1 kill" });
  const stuck = history(t, Array.from({ length: 6 }, () => ["cli", "fail", 180_000, true]));
  assert.deepEqual(unitLimit("cli", { home: stuck, ...machine }), { ms: UNIT_LIMIT_CEILING_MS, source: "default, grown after 6 kills" });
  const healed = history(t, [...passes("cli", 50_000, 50_000, 50_000, 50_000), ["cli", "fail", 100_000, true], ["cli", "pass", 150_000]]);
  assert.deepEqual(unitLimit("cli", { home: healed, ...machine }), { ms: 300_000, source: "learned" }, "a pass after the kill joins the history and the growth ends");
});

test("any agent can set a unit's deadline on this machine with a reason, and clear it", (t) => {
  const home = history(t, passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000));
  assert.throws(() => setUnitLimit("cli", 300_000, { home, reason: " " }), /reason/);
  setUnitLimit("cli", 300_000, { home, reason: "two gates at once on this laptop" });
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: 300_000, source: "set: two gates at once on this laptop" });
  clearUnitLimit("cli", { home });
  assert.equal(unitLimit("cli", { home, ...machine }).source, "learned");
});

test("a unit's row gives its time, its deadline and where the deadline came from", () => {
  assert.equal(unitReason({ ms: 12_345, timedOut: false, unitLimitMs: 80_000, limitSource: "learned" }, "/"), "12.3 s (limit 80 s, learned)");
  assert.match(unitReason({ ms: 80_100, timedOut: true, running: [], unitLimitMs: 80_000, limitSource: "learned" }, "/"), /timed out after 80\.1 s \(limit 80 s, learned\), killed/);
});
