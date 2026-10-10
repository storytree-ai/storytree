// ADR-0731 / increment_4745a73cdd64: `pnpm test` and the gate always end, and name what hung. Each test runs a
// real `node --test` unit over a fixture file, with the limits cut to seconds.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { clearUnitLimit, DEADLINE_GRACE_MS, recordTimings, runUnit, setUnitLimit, UNIT_LIMIT_CEILING_MS, UNIT_LIMIT_FLOOR_MS, UNIT_LIMIT_MS, unitLimit, unitReason } from "./unit-run.mjs";

function fixture(t, files) {
  // Its real path: on macOS the temporary folder is a link, and node names test files by their real one.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "unit-run-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
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

test("6.8 CI evidence keeps each unit and repeated run separately, without leaking its destination to nested runs", async (t) => {
  const root = fixture(t, {
    "first.test.mjs": `import assert from "node:assert/strict"; import { test } from "node:test";
test("1.9 words", () => assert.equal(process.env.STORYTREE_TEST_EVIDENCE, undefined));`,
    "second.test.mjs": `import { test } from "node:test";
test("1.12 words", { skip: "platform:win32: needs Windows" }, () => {});`,
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  const commit = git("rev-parse", "HEAD");
  const directory = path.join(root, "evidence");
  const env = { ...process.env, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "storytree-ai/storytree", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: "not-the-checkout", STORYTREE_TEST_EVIDENCE: directory };
  for (const [unit, file] of [["app-setup", "first.test.mjs"], ["cli", "second.test.mjs"], ["app-setup", "first.test.mjs"]]) {
    const run = await runUnit({ root, files: [file], env, stdio: "ignore", evidence: { directory, unit } });
    assert.equal(run.code, 0);
  }
  const reports = readdirSync(directory).map((dir) => JSON.parse(readFileSync(path.join(directory, dir, "result.json"), "utf8")));
  assert.equal(reports.length, 3, "a later unit or rerun must not overwrite a prior unit");
  assert.deepEqual(reports.map(({ unit }) => unit).sort(), ["app-setup", "app-setup", "cli"]);
  for (const report of reports) {
    assert.equal(report.commit, commit, "actual checkout, not GITHUB_SHA");
    assert.equal(report.platform, process.platform);
    assert.equal(report.run, "https://github.com/storytree-ai/storytree/actions/runs/123/attempts/2");
    assert.equal(report.code, 0);
    assert.equal(report.results.length, 1);
    assert.deepEqual(report.results[0].suites, []);
    assert.equal(report.results[0].file, report.unit === "cli" ? "second.test.mjs" : "first.test.mjs");
    assert.equal(report.results[0].status, report.unit === "cli" ? "skipped" : "passed");
  }
});

// increment_655d99c13fc3: a file dying before it reports any test must explain its failure.
test("6.6 file failures name the file, exit status and its own stderr under concurrent execution", async (t) => {
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

test("6.1 a test that fails leaving a handle open ends its unit with that failure, not a hang", async (t) => {
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

test("6.1 a unit past its deadline keeps completed failure details and names the running test while killing its whole process tree", async (t) => {
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
    "z-failed.test.mjs": `import { test } from "node:test"; import assert from "node:assert/strict";
test("completed failure", () => assert.equal("actual merge", "expected merge", "merged result differed"));`,
  });
  const started = Date.now();
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: ["wedged.test.mjs", "z-failed.test.mjs"], env: process.env, args: ["--test-concurrency=2"], testLimitMs: 60_000, unitLimitMs: 3_000, ...options });
  await closed;
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 20_000, "it ended soon after its deadline");
  assert.deepEqual(result.running.map((entry) => entry.name), ["waits on a wedged child"]);
  assert.match(result.running[0].file, /wedged\.test\.mjs$/);
  assert.match(out.stderr, /completed failure/);
  assert.match(out.stderr, /merged result differed/);
  assert.match(out.stderr, /actual merge/);
  assert.match(out.stderr, /expected merge/);
  assert.match(out.stderr, /z-failed\.test\.mjs:2:/, "a later file's assertion survives even while ordered results wait on the hung file");

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

// increment_67a3090c077c: a file whose tests have all ended but whose process never exits (a Node
// exit deadlock seen on CI) fails within seconds, named, instead of waiting out the unit deadline.
test("6.1 a file whose tests ended but whose process does not exit fails fast, naming the file", async (t) => {
  const root = fixture(t, {
    "nested/exit-hang.test.mjs": `import { test } from "node:test";
process.on("exit", () => { for (;;) {} });
test("passes", () => {});
test("passes too", () => {});`,
    "neighbour.test.mjs": `import { test } from "node:test";\ntest("quick", () => {});`,
  });
  const started = Date.now();
  const result = await runUnit({ root, files: ["nested/exit-hang.test.mjs", "neighbour.test.mjs"], env: process.env, unitLimitMs: 60_000, exitGraceMs: 2_000, ...captured().options });
  assert.ok(Date.now() - started < 20_000, "it ended within seconds of its tests, not at the unit's deadline");
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false, "an exit hang is not a slow unit: its deadline does not grow");
  assert.deepEqual(result.exitHung.map((file) => path.relative(root, file).replaceAll("\\", "/")), ["nested/exit-hang.test.mjs"]);
  assert.match(unitReason({ ...result, unitLimitMs: 60_000 }, root), /killed; nested\/exit-hang\.test\.mjs: its tests ended, but its process did not exit/);
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
const machine = { platform: "win32", arch: "arm64", env: {} }; // not this run's own STORYTREE_UNIT_LIMIT_MS (CI sets one)
const passes = (unit, ...ms) => ms.map((each) => [unit, "pass", each]);

test("a unit with too little history on this machine keeps the fixed deadline", (t) => {
  const home = history(t, [...passes("cli", 40_000, 50_000), ...passes("forest", 1_000, 1_000, 1_000, 1_000, 1_000)]);
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  assert.equal(unitLimit("forest", { home, platform: "linux", arch: "x64", env: {} }).source, "default", "another machine's times are not this one's");
});

// increment_3bd2b051ab67: CI's fresh runners never have history, so the run itself says how long a
// unit there may take: Windows agent-link passed main at 171.3 s, 9 s under the fixed 3 minutes.
test("a unit with too little history takes the run's own default deadline when it gives one", (t) => {
  const home = history(t, passes("cli", 40_000));
  const env = { STORYTREE_UNIT_LIMIT_MS: "360000" };
  assert.deepEqual(unitLimit("cli", { home, ...machine, env }), { ms: 360_000, source: "STORYTREE_UNIT_LIMIT_MS" });
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  const learned = history(t, passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000));
  assert.deepEqual(unitLimit("cli", { home: learned, ...machine, env }), { ms: 100_000, source: "learned" }, "a learned deadline still wins");
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

test("6.10 · a unit's deadline is learned only from runs that tested as many units at once, and each run records how many", (t) => {
  const home = history(t, passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000));
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: 100_000, source: "learned" }, "rows from before jobs were recorded ran one at a time");
  assert.deepEqual(unitLimit("cli", { home, ...machine, jobs: 3 }), { ms: UNIT_LIMIT_MS, source: "default" }, "a unit alone is no measure of it beside others");
  const at = new Date().toISOString();
  const shared = Array.from({ length: 5 }, () => JSON.stringify({ at, platform: "win32", arch: "arm64", unit: "cli", result: "pass", ms: 80_000, timedOut: false, jobs: 3 }));
  writeFileSync(path.join(home, "test-timings.jsonl"), `${shared.join("\n")}\n`, { flag: "a" });
  assert.deepEqual(unitLimit("cli", { home, ...machine, jobs: 3 }), { ms: 160_000, source: "learned" });
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: 100_000, source: "learned" });
  const recorded = mkdtempSync(path.join(tmpdir(), "unit-run-home-"));
  t.after(() => rmSync(recorded, { recursive: true, force: true }));
  recordTimings({ cli: { result: "pass", ms: 1 } }, { home: recorded, jobs: 3 });
  assert.equal(JSON.parse(readFileSync(path.join(recorded, "test-timings.jsonl"), "utf8")).jobs, 3);
});

test("6.10 · a unit run beside others prints nothing and gives back its whole output, its last line included", async (t) => {
  const root = fixture(t, {
    "talks.test.mjs": `import { test } from "node:test";
test("speaks", () => { console.log("said on stdout"); console.error("said on stderr"); });
process.on("exit", () => process.stdout.write("last words\\n"));`,
  });
  let spawned;
  const result = await runUnit({ root, files: ["talks.test.mjs"], env: process.env, hold: true, onSpawn: (child) => (spawned = child) });
  assert.equal(result.code, 0);
  assert.equal(spawned.stdio[1] !== null && spawned.stdio[2] !== null, true, "its output went to pipes, not this terminal");
  for (const words of ["said on stdout", "said on stderr", "speaks", "last words"]) assert.match(result.output, new RegExp(words));
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

// increment_88b282227250: a run of named files killed at its deadline says why it exited 1.
test("6.1 a run of named files past its deadline says it was killed, naming the test still running", async (t) => {
  const dir = fixture(t, {
    "hangs.test.mjs": `import { test } from "node:test";\ntest("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));`,
  });
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const env = { ...process.env, STORYTREE_HOME: path.join(dir, "home"), STORYTREE_TEST_PG_URL: "postgres://unused", STORYTREE_UNIT_LIMIT_MS: "3000" };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", path.join(dir, "hangs.test.mjs")], { cwd: repo, env, encoding: "utf8", timeout: 40_000 });
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 1, output);
  assert.match(output, /test harness: .*timed out after .*limit 3(\.0)? s.*killed; still running: .*hangs\.test\.mjs › never ends/);
});

// increment_7f43f74526ab: CI's job limit cancelled a macOS run and its whole log was lost, so nobody
// could name what stalled. Given STORYTREE_TEST_DEADLINE, a run ends itself first and says where.
function harnessRun(t, files, { deadline, home }) {
  const dir = fixture(t, files);
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const env = { ...process.env, STORYTREE_HOME: home ?? path.join(dir, "home"), STORYTREE_TEST_PG_URL: "postgres://unused", STORYTREE_TEST_DEADLINE: String(deadline) };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  delete env.NODE_TEST_CONTEXT;
  const files_ = Object.keys(files).map((name) => path.join(dir, name));
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", ...files_], { cwd: repo, env, encoding: "utf8", timeout: 40_000 });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("6.1 a run given a deadline cuts the unit it is running to the time left, naming the test still running", (t) => {
  const run = harnessRun(t, {
    "hangs.test.mjs": `import { test } from "node:test";\ntest("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));`,
  }, { deadline: Math.ceil(Date.now() / 1000) + 4 });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: .*timed out after .*cut to the run's deadline\), killed; still running: .*hangs\.test\.mjs › never ends/);
});

test("6.1 a run stalled outside any unit past its deadline names where it stalled and ends", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // A live holder (this process) that never lets go: the run waits on the lock until its deadline.
  writeFileSync(path.join(home, "heavy-run.lock"), JSON.stringify({ id: "held", pid: process.pid, branch: "another run", since: new Date().toISOString() }));
  const run = harnessRun(t, { "passes.test.mjs": `import { test } from "node:test";\ntest("passes", () => {});` }, { deadline: Math.floor((Date.now() - DEADLINE_GRACE_MS) / 1000) + 2, home });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: past the run's deadline .* while waiting for the heavy-run lock; ending the run/);
});
