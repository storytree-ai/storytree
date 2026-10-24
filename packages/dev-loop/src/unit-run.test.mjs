// ADR-0731 / increment_4745a73cdd64: `pnpm test` and the gate always end, and name what hung. Each test runs a
// real `node --test` unit over a fixture file, with the limits cut to seconds.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";
import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";

import { clearUnitLimit, DEADLINE_GRACE_MS, recentPassTimes, recordTimings, runUnit, setUnitLimit, TEST_LIMIT_MS, testLimit, TIMING_ROWS_KEPT, UNIT_LIMIT_CEILING_MS, UNIT_LIMIT_FLOOR_MS, UNIT_LIMIT_MS, unitLimit, unitReason, unitTestLimit } from "./unit-run.mjs";

function fixture(t, files) {
  // Its real path: on macOS the temporary folder is a link, and node names test files by their real one.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "unit-run-")));
  t.after(() => removeTemp(root));
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

// increment_74ca830203db: a full run left thousands of files and folders in a laptop's temp folder.
test("6.14 · a unit's tests get a temp folder of their own, removed with what they left in it when the unit ends", async (t) => {
  const root = fixture(t, {
    "litters.test.mjs": `import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path"; import { test } from "node:test";
test("leaves files behind", () => {
  writeFileSync(path.join(tmpdir(), "stamp"), "");
  mkdtempSync(path.join(tmpdir(), "folder-"));
  writeFileSync("RECORD", JSON.stringify({ tmpdir: tmpdir(), TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }));
});`,
  });
  const run = await runUnit({ root, files: ["litters.test.mjs"], env: process.env, stdio: "ignore" });
  assert.equal(run.code, 0);
  const seen = JSON.parse(readFileSync(path.join(root, "RECORD"), "utf8"));
  assert.equal(path.dirname(seen.tmpdir), tmpdir(), "a folder inside the system temp folder");
  assert.deepEqual([seen.TMPDIR, seen.TMP, seen.TEMP], [seen.tmpdir, seen.tmpdir, seen.tmpdir], "every platform's temp variable names it");
  assert.equal(existsSync(seen.tmpdir), false, "removed with the stamp and the folder the test left in it");
});

// friction_fa050a39ba6f: tests an agent ran wrote their fixture words into the real project's door-answered lines, on its session.
test("6.15 · a unit's tests start with no agent session: no watched harness's session variable and no STORYTREE_SESSION_ID", async (t) => {
  const root = fixture(t, {
    "session.test.mjs": `import { writeFileSync } from "node:fs"; import { test } from "node:test";
test("records its environment", () => writeFileSync("RECORD", JSON.stringify(process.env)));`,
  });
  const named = Object.fromEntries([...WATCHED_HARNESSES.flatMap((harness) => (harness.shellSession === undefined ? [] : [harness.shellSession])), SESSION_ENV].map((name) => [name, "agent-1"]));
  const run = await runUnit({ root, files: ["session.test.mjs"], env: { ...process.env, ...named }, stdio: "ignore" });
  assert.equal(run.code, 0);
  assert.ok(Object.keys(named).length >= 5, "every watched harness's variable and storytree's own");
  const seen = JSON.parse(readFileSync(path.join(root, "RECORD"), "utf8"));
  assert.deepEqual(Object.keys(named).filter((name) => name in seen), []);
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

// friction_d5da3da1aac6: `pnpm run test <file> --test-name-pattern=<p>` ran every test in the file.
test("6.19 · node's --test-* options given after a named file still reach node --test, so a name-filtered run runs only the matching tests", async (t) => {
  const root = fixture(t, {
    "named.test.mjs": `import { appendFileSync } from "node:fs";
import { test } from "node:test";
test("wanted", () => appendFileSync("RAN", "wanted\\n"));
test("unwanted", () => appendFileSync("RAN", "unwanted\\n"));`,
  });
  // As `pnpm run test named.test.mjs --test-name-pattern=wanted` hands them on: the file first.
  const run = await runUnit({ root, files: [], env: process.env, args: ["named.test.mjs", "--test-name-pattern=^wanted$"], stdio: "ignore" });
  assert.equal(run.code, 0);
  assert.equal(readFileSync(path.join(root, "RAN"), "utf8"), "wanted\n");
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
  const gone = () => { try { process.kill(grandchild, 0); return false; } catch { return true; } };
  await waitUntil(gone, 5_000, "the test's own child process to be killed too");

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
  assert.match(unitReason({ ...result, unitLimitMs: 60_000 }, root), /killed; nested\/exit-hang\.test\.mjs: its last reported test ended, but its process did not exit/);
});

// friction_e50f26922ba5: where a child's stdout is an async pipe (Windows), a test blocking its process in
// a synchronous call never reports its start, so the exit watch sees the file idle and kills it.
test("6.1 a file killed by the exit watch is named with both causes: a hung exit, or a test blocking its process in a synchronous call", () => {
  const root = path.resolve("unit-root");
  const reason = unitReason({ ms: 25_000, timedOut: false, exitHung: [path.join(root, "a", "blocked.test.mjs")], unitLimitMs: 60_000 }, root);
  assert.match(reason, /killed; a\/blocked\.test\.mjs: its last reported test ended, but its process did not exit/);
  assert.match(reason, /a handle left open or an exit that hangs/);
  assert.match(reason, /a test blocking its process in a synchronous call/);
});

test("each unit's time is added to the machine's timing history, outside the checkout", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-home-"));
  t.after(() => removeTemp(home));
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
  t.after(() => removeTemp(home));
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
// unit there may take: Windows session-management passed main at 171.3 s, 9 s under the fixed 3 minutes.
test("a unit with too little history takes the run's own default deadline when it gives one", (t) => {
  const home = history(t, passes("cli", 40_000));
  const env = { STORYTREE_UNIT_LIMIT_MS: "360000" };
  assert.deepEqual(unitLimit("cli", { home, ...machine, env }), { ms: 360_000, source: "STORYTREE_UNIT_LIMIT_MS" });
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  const learned = history(t, passes("cli", 200_000, 200_000, 200_000, 200_000, 200_000));
  assert.deepEqual(unitLimit("cli", { home: learned, ...machine, env }), { ms: 400_000, source: "learned" }, "a longer learned deadline still wins");
});

// increment_d51b4f1d9fc8: CI carries each runner's history from main's runs, but a pull request's
// kills are never carried back, so on CI a learned deadline may only raise the run's own default.
test("6.16 · a run that gives its own default deadline never gives a unit a learned one under it", (t) => {
  const env = { STORYTREE_UNIT_LIMIT_MS: "360000" };
  const fast = history(t, passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000));
  assert.deepEqual(unitLimit("cli", { home: fast, ...machine, env }), { ms: 360_000, source: "STORYTREE_UNIT_LIMIT_MS, above its learned 100 s" });
  assert.deepEqual(unitLimit("cli", { home: fast, ...machine }), { ms: 100_000, source: "learned" }, "without one, the learned deadline stands");
  const drifting = history(t, passes("session-management", 235_000, 300_000, 357_000, 250_000, 240_000));
  assert.deepEqual(unitLimit("session-management", { home: drifting, ...machine, env }), { ms: 714_000, source: "learned" });
});

test("6.17 · the timing history keeps each unit's most recent rows on each machine, so a history carried from run to run stays small", (t) => {
  const home = history(t, [...Array.from({ length: TIMING_ROWS_KEPT + 5 }, (_, i) => ["cli", "pass", 1_000 + i]), ...passes("forest", 7_000)]);
  const rows = () => readFileSync(path.join(home, "test-timings.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const before = rows().length;
  recordTimings({ forest: { result: "pass", ms: 8_000 } }, { home, trimAt: before });
  const kept = rows();
  assert.deepEqual(kept.filter((row) => row.unit === "cli").map((row) => row.ms), Array.from({ length: TIMING_ROWS_KEPT }, (_, i) => 1_005 + i), "the oldest rows go first");
  assert.deepEqual(kept.filter((row) => row.unit === "forest").map((row) => row.ms), [7_000, 8_000]);
  recordTimings({ forest: { result: "pass", ms: 9_000 } }, { home });
  assert.equal(rows().length, kept.length + 1, "under its size the history is only added to");
});

test("with enough passes, a unit's deadline is twice its slowest recent pass, never under the floor", (t) => {
  const home = history(t, [...passes("session-management", 60_000, 165_000, 61_000, 70_000, 90_000), ...passes("arc-surface", 2_000, 18_000, 2_000, 2_500, 3_000)]);
  assert.deepEqual(unitLimit("session-management", { home, ...machine }), { ms: 330_000, source: "learned" });
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
  t.after(() => removeTemp(recorded));
  recordTimings({ cli: { result: "pass", ms: 1 } }, { home: recorded, jobs: 3 });
  assert.equal(JSON.parse(readFileSync(path.join(recorded, "test-timings.jsonl"), "utf8")).jobs, 3);
});

// increment_3f535ac2dc4e: on the Surface Pro session-management takes 150 to 250 s alone, so under the
// 180 s default it was killed, passed at the doubled deadline, and was killed again at the default.
test("6.13 · a unit with too few passes at this concurrency is never given less than twice its slowest recent pass at any", (t) => {
  const slow = history(t, [["session-management", "fail", 180_000, true], ...passes("session-management", 233_000)]);
  assert.deepEqual(unitLimit("session-management", { home: slow, ...machine }), { ms: 466_000, source: "twice its slowest pass, too few to learn from" });
  const alone = history(t, passes("cli", 160_000, 226_000, 150_000, 140_000, 133_000));
  assert.deepEqual(unitLimit("cli", { home: alone, ...machine, jobs: 2 }), { ms: 452_000, source: "twice its slowest pass, too few to learn from" }, "beside others it is no faster than alone");
  assert.deepEqual(unitLimit("cli", { home: alone, ...machine, jobs: 2, env: { STORYTREE_UNIT_LIMIT_MS: "600000" } }), { ms: 600_000, source: "STORYTREE_UNIT_LIMIT_MS" }, "the run's default when that is longer");
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

// increment_eb1972ba9017 (ADR-1152): each test's limit is learned from its own passing times on this machine,
// as a unit's deadline is; voice's real.test.ts passed in 36-55 s on Windows and timed out at the flat 60 s.
function testHistory(t, rows) {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-tests-"));
  t.after(() => removeTemp(home));
  const at = "2026-10-24T00:00:00.000Z";
  const lines = rows.map(([file, name, result, ms, timedOut = false]) => JSON.stringify({ at, platform: "win32", arch: "arm64", file, test: name, result, ms, timedOut }));
  writeFileSync(path.join(home, "test-timings.jsonl"), `${lines.join("\n")}\n`);
  return home;
}
const real = "packages/voice/src/real.test.ts";
const testPasses = (file, name, ...ms) => ms.map((each) => [file, name, "pass", each]);

test("6.24 · a test's limit is three times its slowest recent pass on this machine, never under 60 s; with fewer than five passes it keeps 60 s", (t) => {
  const home = testHistory(t, [...testPasses(real, "1.1 › answers", 36_000, 50_000, 41_000, 44_000, 39_000), ...testPasses(real, "1.2 · rings", 19_000, 20_000, 18_000, 19_000, 18_500), ...testPasses(real, "1.3 · new", 50_000, 50_000)]);
  assert.deepEqual(testLimit(real, "1.1 › answers", { home, ...machine }), { ms: 150_000, source: "learned" });
  assert.deepEqual(testLimit(real, "1.2 · rings", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "learned" }, "never under 60 s");
  assert.deepEqual(testLimit(real, "1.3 · new", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.deepEqual(testLimit(real, "never seen", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.equal(testLimit(real, "1.1 › answers", { home, platform: "linux", arch: "x64" }).ms, TEST_LIMIT_MS, "another machine's times are not this one's");
});

test("6.24 · each timeout at its limit since a test last passed doubles its next limit, up to the ceiling, and its next pass ends the growth", (t) => {
  const timedOut = (ms) => [real, "1.1 › answers", "fail", ms, true];
  const home = testHistory(t, [...testPasses(real, "1.1 › answers", 50_000, 50_000, 50_000, 50_000, 50_000), timedOut(150_000)]);
  assert.deepEqual(testLimit(real, "1.1 › answers", { home, ...machine }), { ms: 300_000, source: "learned, grown after 1 timeout" });
  const fresh = testHistory(t, [timedOut(60_000), timedOut(120_000)]);
  assert.deepEqual(testLimit(real, "1.1 › answers", { home: fresh, ...machine }), { ms: 240_000, source: "default, grown after 2 timeouts" }, "a test with no history grows too");
  const stuck = testHistory(t, Array.from({ length: 6 }, () => timedOut(60_000)));
  assert.equal(testLimit(real, "1.1 › answers", { home: stuck, ...machine }).ms, UNIT_LIMIT_CEILING_MS);
  const healed = testHistory(t, [...testPasses(real, "1.1 › answers", 50_000, 50_000, 50_000, 50_000, 50_000), timedOut(150_000), [real, "1.1 › answers", "pass", 160_000]]);
  assert.deepEqual(testLimit(real, "1.1 › answers", { home: healed, ...machine }), { ms: 480_000, source: "learned" }, "the pass joins the history and the growth ends");
});

test("6.24 · a unit's tests run under the largest of its tests' limits, naming the test it came from; a unit with none learned keeps 60 s", (t) => {
  const home = testHistory(t, [...testPasses(real, "1.1 › answers", 50_000, 50_000, 50_000, 50_000, 50_000), ...testPasses("packages/voice/src/door.test.ts", "1.9 · hangs up", 30_000, 30_000, 30_000, 30_000, 30_000), ...testPasses("packages/voice-extra/src/a.test.ts", "slower", 90_000, 90_000, 90_000, 90_000, 90_000)]);
  assert.deepEqual(unitTestLimit("packages/voice", { home, ...machine }), { ms: 150_000, source: `learned for ${real} › 1.1 › answers` });
  assert.deepEqual(unitTestLimit("packages/cli", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.deepEqual(unitTestLimit(real, { home, ...machine }), { ms: 150_000, source: `learned for ${real} › 1.1 › answers` }, "a file run alone is a unit of its own");
});

test("6.24 · a run records the tests that could need more than 60 s, and every run of a test it already holds, kept per test; units' own rows are unchanged", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-tests-"));
  t.after(() => removeTemp(home));
  const rows = () => readFileSync(path.join(home, "test-timings.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  recordTimings({ "packages/voice": { result: "pass", ms: 200_000 } }, { home, tests: [
    { file: real, name: "slow", result: "pass", ms: 36_000, timedOut: false },
    { file: real, name: "fast", result: "pass", ms: 400, timedOut: false },
    { file: real, name: "stuck", result: "fail", ms: 60_000, timedOut: true },
    { file: real, name: "broken", result: "fail", ms: 100, timedOut: false },
  ] });
  recordTimings({}, { home, tests: [{ file: real, name: "stuck", result: "pass", ms: 1_000, timedOut: false }, { file: real, name: "fast", result: "pass", ms: 500, timedOut: false }] });
  assert.deepEqual(rows().filter((row) => row.test !== undefined).map(({ file, test: name, result, ms, timedOut }) => [file, name, result, ms, timedOut]), [
    [real, "slow", "pass", 36_000, false],
    [real, "stuck", "fail", 60_000, true],
    [real, "stuck", "pass", 1_000, false],
  ], "a fast pass can never lift a limit above 60 s, so it is kept only for a test already held");
  assert.equal(rows().filter((row) => row.unit === "packages/voice").length, 1);
  assert.deepEqual([...recentPassTimes({ home })], [["packages/voice", 200_000]], "test rows are no unit's");

  writeFileSync(path.join(home, "test-timings.jsonl"), "");
  recordTimings({}, { home, tests: Array.from({ length: TIMING_ROWS_KEPT + 3 }, (_, i) => ({ file: real, name: "slow", result: "pass", ms: 30_000 + i, timedOut: false })) });
  recordTimings({ "packages/cli": { result: "pass", ms: 1_000 } }, { home, trimAt: 1 });
  assert.equal(rows().filter((row) => row.test === "slow").length, TIMING_ROWS_KEPT, "trimmed per test");
  assert.equal(rows().filter((row) => row.unit === "packages/cli").length, 1, "no unit's rows lost to the tests'");
});

test("6.24 · a unit gives back each test it ran, by its full name, with its time and whether it timed out at the limit; a test's own longer timeout still holds", { timeout: 60_000 }, async (t) => {
  const root = fixture(t, {
    "src/limits.test.mjs": `import { describe, it, test } from "node:test";
describe("outer", () => { it("inner", () => {}); });
test("parent", async (t) => { await t.test("child", () => {}); });
test("too slow", () => new Promise(() => { setInterval(() => {}, 1000); }));
test("its own limit", { timeout: 10_000 }, () => new Promise((resolve) => setTimeout(resolve, 600)));
test.skip("skipped", () => {});`,
  });
  const { closed, options } = captured();
  const result = await runUnit({ root, files: ["src/limits.test.mjs"], env: process.env, testLimitMs: 300, unitLimitMs: 30_000, ...options });
  await closed;
  const ran = Object.fromEntries(result.tests.map(({ file, name, result: outcome, timedOut }) => [name, { file, outcome, timedOut }]));
  const file = "src/limits.test.mjs";
  assert.deepEqual(ran, {
    "outer › inner": { file, outcome: "pass", timedOut: false },
    outer: { file, outcome: "pass", timedOut: false },
    "parent › child": { file, outcome: "pass", timedOut: false },
    parent: { file, outcome: "pass", timedOut: false },
    "too slow": { file, outcome: "fail", timedOut: true },
    "its own limit": { file, outcome: "pass", timedOut: false },
  }, "its own 10 s held over the run's 0.3 s, which a 0.6 s wait would cross");
});

test("6.24 · a unit whose test timed out at a learned limit names the test, the limit and where it came from", () => {
  const reason = unitReason({ ms: 160_000, timedOut: false, unitLimitMs: 360_000, limitSource: "learned", testLimitMs: 150_000, testLimitSource: `learned for ${real} › 1.1 › answers`, tests: [{ file: real, name: "1.1 › answers", result: "fail", ms: 150_010, timedOut: true }] }, "/");
  assert.equal(reason, `160.0 s (limit 360 s, learned); timed out at the per-test limit of 150 s (learned for ${real} › 1.1 › answers): ${real} › 1.1 › answers`);
  assert.equal(unitReason({ ms: 61_000, timedOut: false, unitLimitMs: 180_000, testLimitMs: 60_000, testLimitSource: "default", tests: [{ file: real, name: "x", result: "fail", ms: 60_001, timedOut: true }] }, "/"), `61.0 s; timed out at the per-test limit of 60 s (default): ${real} › x`);
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
function harnessRun(t, files, { deadline, home, timeout = 40_000 }) {
  const dir = fixture(t, files);
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const env = { ...process.env, STORYTREE_HOME: home ?? path.join(dir, "home"), STORYTREE_TEST_PG_URL: "postgres://unused", STORYTREE_TEST_DEADLINE: String(deadline) };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  delete env.NODE_TEST_CONTEXT;
  const files_ = Object.keys(files).map((name) => path.join(dir, name));
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", ...files_], { cwd: repo, env, encoding: "utf8", timeout });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("6.1 a run given a deadline cuts the unit it is running to the time left, naming the test still running", { timeout: 180_000 }, (t) => {
  // On a loaded runner the child's start can use up a short budget before the test begins (friction_b0dddfa7a7ad),
  // so the hanging test marks when it started, and the budget widens until it starts with time to spare.
  const marks = mkdtempSync(path.join(tmpdir(), "unit-run-mark-"));
  t.after(() => removeTemp(marks));
  const marker = path.join(marks, "started");
  let run;
  for (const budget of [4, 8, 16, 32]) {
    rmSync(marker, { force: true });
    const deadline = Math.ceil(Date.now() / 1000) + budget;
    run = harnessRun(t, {
      "hangs.test.mjs": `import { writeFileSync } from "node:fs";\nimport { test } from "node:test";\ntest("never ends", () => { writeFileSync(${JSON.stringify(marker)}, String(Date.now())); return new Promise(() => { setInterval(() => {}, 1000); }); });`,
    }, { deadline, timeout: budget * 1000 + 40_000 });
    if (existsSync(marker) && Number(readFileSync(marker, "utf8")) < deadline * 1000 - 2000) break;
  }
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: .*timed out after .*cut to the run's deadline\), killed; still running: .*hangs\.test\.mjs › never ends/);
});

test("6.1 a run stalled outside any unit past its deadline names where it stalled and ends", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-home-"));
  t.after(() => removeTemp(home));
  // A live holder (this process) that never lets go: the run waits on the lock until its deadline.
  writeFileSync(path.join(home, "heavy-run.lock"), JSON.stringify({ id: "held", pid: process.pid, branch: "another run", since: new Date().toISOString() }));
  const run = harnessRun(t, { "passes.test.mjs": `import { test } from "node:test";\ntest("passes", () => {});` }, { deadline: Math.floor((Date.now() - DEADLINE_GRACE_MS) / 1000) + 2, home });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: past the run's deadline .* while waiting for the heavy-run lock; ending the run/);
});
