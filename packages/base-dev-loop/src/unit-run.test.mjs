import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";
import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";

import { CAPTURE_LIMIT_MS, clearUnitLimit, DEADLINE_GRACE_MS, recentPassTimes, recordTimings, runUnit, setUnitLimit, TEST_LIMIT_MS, testLimit, TIMING_ROWS_KEPT, UNIT_LIMIT_CEILING_MS, UNIT_LIMIT_FLOOR_MS, UNIT_LIMIT_MS, unitLimit, unitReason, unitTestLimit, withMacRetry } from "./unit-run.mjs";

function fixture(t, files) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "unit-run-")));
  t.after(() => removeTemp(root));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

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

test("4.8 CI evidence keeps each unit and repeated run separately, without leaking its destination to nested runs", async (t) => {
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

test("4.14 · a unit's tests get a temp folder of their own, removed with what they left in it when the unit ends", async (t) => {
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

test("4.15 · a unit's tests start with no agent session: no watched harness's session variable and no STORYTREE_SESSION_ID", async (t) => {
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

test("4.33 · a unit's tests start with no inherited STORYTREE_FACTORY, so a run with it set names no factory folder to them", async (t) => {
  const root = fixture(t, {
    "factory.test.mjs": `import assert from "node:assert/strict"; import { test } from "node:test";
test("sees no factory", () => assert.equal(process.env.STORYTREE_FACTORY, undefined));`,
  });
  const run = await runUnit({ root, files: ["factory.test.mjs"], env: { ...process.env, STORYTREE_FACTORY: path.join(root, "factory") }, stdio: "ignore" });
  assert.equal(run.code, 0, "the unit's test saw STORYTREE_FACTORY set");
});

test("4.6 file failures name the file, exit status and its own stderr under concurrent execution", async (t) => {
  const files = {
    "exit.test.mjs": `import { writeSync } from "node:fs";
writeSync(2, "loader stopped before tests\\n"); process.exit(7);`,
    "load.test.mjs": `throw new Error("cannot load relief fixture");`,
    "rejection.test.mjs": `Promise.reject(new Error("unhandled fixture rejection"));`,
    "healthy.test.mjs": `import { test } from "node:test";
console.error("a different file's stderr"); test("healthy neighbor", () => {});`,
  };
  if (process.platform !== "win32") files["signal.test.mjs"] = `process.kill(process.pid, "SIGTERM");`;
  const root = fixture(t, files);
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: Object.keys(files), env: process.env, args: ["--test-concurrency=4"], ...options });
  await closed;
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

test("4.19 · node's --test-* options given after a named file still reach node --test, so a name-filtered run runs only the matching tests", async (t) => {
  const root = fixture(t, {
    "named.test.mjs": `import { appendFileSync } from "node:fs";
import { test } from "node:test";
test("wanted", () => appendFileSync("RAN", "wanted\\n"));
test("unwanted", () => appendFileSync("RAN", "unwanted\\n"));`,
  });
  const run = await runUnit({ root, files: [], env: process.env, args: ["named.test.mjs", "--test-name-pattern=^wanted$"], stdio: "ignore" });
  assert.equal(run.code, 0);
  assert.equal(readFileSync(path.join(root, "RAN"), "utf8"), "wanted\n");
});

test("4.1 a test that fails leaving a handle open ends its unit with that failure, not a hang", async (t) => {
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

test("4.1 a unit past its deadline keeps completed failure details and names the running test while killing its whole process tree", { timeout: 180_000 }, async (t) => {
  const pidFile = path.join(tmpdir(), `unit-run-grandchild-${process.pid}.txt`);
  let reaped = false;
  t.after(() => {
    try {
      if (!reaped) process.kill(Number(readFileSync(pidFile, "utf8")));
    } catch {}
    rmSync(pidFile, { force: true });
  });
  let started, result, out, root, unitLimitMs;
  for (unitLimitMs of [3_000, 6_000, 12_000, 24_000]) {
    rmSync(pidFile, { force: true });
    started = Date.now();
    ({ result, out, root } = await wedgedUnit(t, pidFile, unitLimitMs));
    if (existsSync(pidFile) && statSync(pidFile).mtimeMs < started + unitLimitMs - 1_000) break;
  }
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < unitLimitMs + 17_000, "it ended soon after its deadline");
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
  reaped = true;

  const reason = unitReason({ ...result, unitLimitMs }, root);
  assert.match(reason, /timed out/);
  assert.match(reason, new RegExp(`limit ${unitLimitMs / 1000}(\\.0)? s`));
  assert.match(reason, /wedged\.test\.mjs › waits on a wedged child/);
});

async function wedgedUnit(t, pidFile, unitLimitMs) {
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
  const { out, closed, options } = captured();
  const result = await runUnit({ root, files: ["wedged.test.mjs", "z-failed.test.mjs"], env: process.env, args: ["--test-concurrency=2"], testLimitMs: 60_000, unitLimitMs, ...options });
  await closed;
  return { result, out, root };
}

test("4.1 a file whose tests ended but whose process does not exit fails fast, naming the file", async (t) => {
  const root = fixture(t, {
    "nested/exit-hang.test.mjs": `import { test } from "node:test";
process.on("exit", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)); // blocked for good, idle, as a deadlock is
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
  assert.match(unitReason({ ...result, unitLimitMs: 60_000 }, root), /killed; nested\/exit-hang\.test\.mjs: its last reported test ended, and its process sat idle without exiting/);
});

test("4.1 a file still computing synchronously after its last reported test ended runs to its end, not killed as a hung exit", { skip: process.platform === "win32" && "platform:posix: on Windows the exit watch reads CPU through a PowerShell process listing, started only after min(3 s, grace/4) without an exit and taken at most once per that interval, and this test's 1 s grace is too short for that listing to land twice in time" }, async (t) => {
  const root = fixture(t, {
    "computes.test.mjs": `import { after, test } from "node:test";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100)); // the ended test reaches the reporter
  const end = Date.now() + 4_000;
  for (let i = 0; i < availableParallelism(); i++) new Worker('const { workerData: end } = require("node:worker_threads"); while (Date.now() < end) {}', { eval: true, workerData: end });
  while (Date.now() < end) {}
});
test("reported", () => {});`,
  });
  const result = await runUnit({ root, files: ["computes.test.mjs"], env: process.env, unitLimitMs: 60_000, exitGraceMs: 1_000, ...captured().options });
  assert.deepEqual(result.exitHung, []);
  assert.equal(result.code, 0);
});

const exitHang = (...names) => `import { writeFileSync } from "node:fs"; import { test } from "node:test";
process.on("exit", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));
${names.map((name) => `test(${JSON.stringify(name)}, () => writeFileSync("LAST", ${JSON.stringify(name)}));`).join("\n")}`;

const relative = (root, files) => files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort();

function evidenceFixture(t, files) {
  const root = fixture(t, files);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  const directory = path.join(root, "evidence");
  const env = { ...process.env, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "storytree-ai/storytree", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
  const folder = () => {
    const units = readdirSync(directory);
    assert.equal(units.length, 1, "one unit, one evidence folder");
    return path.join(directory, units[0]);
  };
  return { root, env, evidence: { directory, unit: "base-dev-loop" }, folder };
}

test("4.34 · on Windows a busy unit holds off the exit kill: the stuck file is killed only after its runner's process tree, read from the listing, has sat quiet for the grace, and a busy process outside the tree holds nothing off", async (t) => {
  const root = fixture(t, { "nested/exit-hang.test.mjs": exitHang("passes", "passes too") });
  let runner;
  const busyListings = 6;
  const calls = [];
  const windowsProcesses = async () => {
    calls.push({ at: Date.now(), ended: existsSync(path.join(root, "LAST")) });
    return [
      { pid: runner.pid, ppid: process.pid, cpuMs: 300, commandLine: "node --test" },
      { pid: runner.pid + 1, ppid: runner.pid, cpuMs: 80, commandLine: `node ${path.join(root, "nested", "exit-hang.test.mjs")}` },
      { pid: runner.pid + 2, ppid: runner.pid + 1, cpuMs: 1_000 + 10_000 * Math.min(calls.length, busyListings), commandLine: "node worker.mjs" },
      { pid: runner.pid + 3, ppid: 4, cpuMs: 10_000 * calls.length, commandLine: "MsMpEng.exe" },
    ];
  };
  const result = await runUnit({ root, files: ["nested/exit-hang.test.mjs"], env: process.env, unitLimitMs: 60_000, exitGraceMs: 2_000, platform: "win32", windowsProcesses, stdio: "ignore", onSpawn: (child) => (runner = child) });
  assert.equal(calls[0]?.ended, true, "the listing is read only once a file has ended but not exited");
  const quiet = calls.length - busyListings;
  assert.ok(quiet >= 1, `killed after listing ${calls.length}, while a grandchild of the runner was still busy through listing ${busyListings}`);
  assert.ok(quiet <= 4, `killed ${quiet} listings after the tree went quiet, at most one a second for a 2 s grace`);
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false, "a process outside the runner's tree, busy throughout, held the kill off to the unit's deadline");
  assert.deepEqual(relative(root, result.exitHung), ["nested/exit-hang.test.mjs"]);
  const gaps = calls.slice(1).map(({ at }, i) => at - calls[i].at);
  assert.ok(Math.min(...gaps) >= 400, `listings ${gaps.join(", ")} ms apart, more often than once every 500 ms for a 2 s grace`);
});

test("4.34 · on Windows a file whose exit was waited on past the grace because its unit was busy is reported spared with its seconds, in the result, the unit's row and the CI evidence", async (t) => {
  const { root, env, evidence, folder } = evidenceFixture(t, {
    "nested/exit-slow.test.mjs": `import { readFileSync } from "node:fs";
import { test } from "node:test";
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const ended = () => readFileSync(process.env.STORYTREE_TEST_RUNNING, "utf8").split("\\n").some((line) => line.includes('"event":"end"') && line.includes('"name":"passes"'));
process.on("exit", () => {
  for (let waited = 0; waited < 20_000 && !ended(); waited += 20) pause(20);
  pause(4_000);
});
test("passes", () => {});`,
    "quick.test.mjs": `import { test } from "node:test";\ntest("quick", () => {});`,
  });
  let runner;
  let readings = 0;
  const windowsProcesses = async () => [{ pid: runner.pid, ppid: process.pid, cpuMs: 10_000 * ++readings, commandLine: "node --test" }];
  const result = await runUnit({ root, files: ["nested/exit-slow.test.mjs", "quick.test.mjs"], env, evidence, unitLimitMs: 60_000, exitGraceMs: 1_000, platform: "win32", windowsProcesses, stdio: "ignore", onSpawn: (child) => (runner = child) });
  assert.equal(result.code, 0);
  assert.deepEqual(result.exitHung, []);
  assert.deepEqual(result.spared?.map(({ file }) => file), [path.join(root, "nested", "exit-slow.test.mjs")]);
  const { seconds } = result.spared[0];
  assert.ok(seconds >= 3.5 && seconds * 1_000 <= result.ms, `${seconds} s from its last test's end to its exit, which blocked 4 s, within the unit's ${result.ms} ms`);
  assert.equal(seconds, Number(seconds.toFixed(1)), "seconds to one decimal");
  const reason = unitReason(result, root);
  const clause = reason.split(";").find((part) => part.includes("nested/exit-slow.test.mjs"));
  assert.equal(clause?.includes(`${seconds.toFixed(1)} s`), true, `the row names the spared file with its seconds: ${reason}`);
  assert.doesNotMatch(reason, /quick\.test\.mjs/);
  assert.equal(reason.includes(root), false, "the file is named from the root");
  const report = JSON.parse(readFileSync(path.join(folder(), "result.json"), "utf8"));
  assert.deepEqual(report.spared, [{ file: "nested/exit-slow.test.mjs", seconds }]);
});

test("4.34 · on Windows a process listing that fails or never settles restarts nothing, so the stuck file is killed at the grace, with one listing in flight at a time", async (t) => {
  const listings = {
    fails: { calls: 0, read() { this.calls++; return Promise.reject(new Error("Get-CimInstance: access denied")); } },
    "never settles": { calls: 0, read() { this.calls++; return new Promise(() => {}); } },
  };
  for (const [kind, listing] of Object.entries(listings)) {
    const root = fixture(t, { "nested/exit-hang.test.mjs": exitHang("passes") });
    const result = await runUnit({ root, files: ["nested/exit-hang.test.mjs"], env: process.env, unitLimitMs: 15_000, exitGraceMs: 2_000, platform: "win32", windowsProcesses: () => listing.read(), stdio: "ignore" });
    assert.notEqual(result.code, 0, kind);
    assert.equal(result.timedOut, false, `${kind}: killed by the exit watch at the 2 s grace, before the unit's 15 s deadline`);
    assert.deepEqual(relative(root, result.exitHung), ["nested/exit-hang.test.mjs"], kind);
  }
  assert.ok(listings.fails.calls >= 1, "the failing listing was read");
  assert.equal(listings["never settles"].calls, 1, "a listing still in flight is never read again");
});

test("4.34 · on Windows the default process listing reads this process with its parent, its command line and its CPU time in milliseconds", { skip: process.platform !== "win32" && "platform:win32: needs Windows" }, async () => {
  const { windowsProcesses } = await import("./unit-run.mjs");
  const own = async () => (await windowsProcesses()).find((row) => row.pid === process.pid);
  const used = () => {
    const { user, system } = process.cpuUsage();
    return (user + system) / 1_000;
  };
  const outer = used();
  const before = await own();
  const spinFrom = used();
  while (used() - spinFrom < 500) {}
  const spun = used() - spinFrom;
  const after = await own();
  const between = used() - outer;
  assert.equal(before.ppid, process.ppid);
  assert.match(after.commandLine, /unit-run\.test\.mjs/);
  const grew = after.cpuMs - before.cpuMs;
  assert.ok(grew >= spun - 50 && grew <= between + 50, `${grew} ms of CPU in the listing, against ${spun.toFixed(0)} ms spun and ${between.toFixed(0)} ms used between the listings' calls by node's own reading`);
});

test("4.35 · on Windows, before the exit watch kills, it saves a capture beside the unit's result: each stuck file's last ended test and whether its process is alive, the runner's process tree, and two thread listings about 2 s apart", async (t) => {
  const { root, env, evidence, folder } = evidenceFixture(t, {
    "nested/exit-hang.test.mjs": exitHang("passes", "passes too"),
    "other-hang.test.mjs": exitHang("only"),
  });
  let runner;
  const rows = () => [
    { pid: runner.pid, ppid: process.pid, cpuMs: 300, commandLine: "node --test" },
    { pid: runner.pid + 1, ppid: runner.pid, cpuMs: 80, commandLine: "node --import tsx nested\\exit-hang.test.mjs" },
    { pid: runner.pid + 2, ppid: 4, cpuMs: 9_000, commandLine: "explorer.exe" },
  ];
  const listings = [];
  const windowsThreads = async (pids) => {
    listings.push({ pids, at: Date.now(), runnerUp: runner.exitCode === null && runner.signalCode === null });
    return [{ pid: runner.pid + 1, tid: listings.length, cpuMs: 5, waitReason: "UserRequest", state: 5 }];
  };
  const result = await runUnit({ root, files: ["nested/exit-hang.test.mjs", "other-hang.test.mjs"], env, evidence, unitLimitMs: 60_000, exitGraceMs: 2_000, platform: "win32", windowsProcesses: async () => rows(), windowsThreads, stdio: "ignore", onSpawn: (child) => (runner = child) });
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.deepEqual(relative(root, result.exitHung), ["nested/exit-hang.test.mjs", "other-hang.test.mjs"]);
  assert.equal(existsSync(path.join(folder(), "result.json")), true);
  const capture = JSON.parse(readFileSync(path.join(folder(), "exit-capture.json"), "utf8"));
  assert.deepEqual(capture.files.toSorted((a, b) => a.file.localeCompare(b.file)), [
    { file: "nested/exit-hang.test.mjs", lastEnded: "passes too", alive: true },
    { file: "other-hang.test.mjs", lastEnded: "only", alive: false },
  ]);
  assert.deepEqual(capture.processes.toSorted((a, b) => a.pid - b.pid), rows().slice(0, 2));
  assert.equal(listings.length, 2, "two thread listings");
  assert.ok(listings.every(({ runnerUp }) => runnerUp), "both taken before the kill");
  assert.ok(listings[0].pids.includes(runner.pid + 1), "the stuck file's process is among the threads' processes");
  assert.deepEqual(capture.threads.map(({ rows: listed }) => listed.map(({ tid }) => tid)), [[1], [2]]);
  const at = capture.threads.map(({ at: when }) => new Date(when).getTime());
  assert.ok(at[1] - at[0] >= 1_500, `thread listings ${at[1] - at[0]} ms apart`);
});

test("4.35 · on Windows a capture that overruns its bound is cut off: the stuck file is killed by the grace plus the bound, failing as it would without one", async (t) => {
  const { root, env, evidence } = evidenceFixture(t, { "nested/exit-hang.test.mjs": exitHang("passes") });
  let runner;
  let threadCalls = 0;
  const windowsThreads = () => {
    threadCalls++;
    return new Promise(() => {});
  };
  const result = await runUnit({ root, files: ["nested/exit-hang.test.mjs"], env, evidence, unitLimitMs: 12_000, exitGraceMs: 2_000, captureLimitMs: 1_000, platform: "win32", windowsProcesses: async () => [{ pid: runner.pid, ppid: process.pid, cpuMs: 300, commandLine: "node --test" }], windowsThreads, stdio: "ignore", onSpawn: (child) => (runner = child) });
  assert.ok(threadCalls >= 1, "the capture was attempted");
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false, `killed at the 2 s grace and the 1 s bound, before the unit's 12 s deadline, which the default ${CAPTURE_LIMIT_MS / 1000} s bound would pass`);
  assert.deepEqual(relative(root, result.exitHung), ["nested/exit-hang.test.mjs"]);
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

function history(t, rows = []) {
  const home = mkdtempSync(path.join(tmpdir(), "unit-run-limits-"));
  t.after(() => removeTemp(home));
  const at = "2026-09-29T00:00:00.000Z";
  const lines = rows.map(([unit, result, ms, timedOut = false]) => JSON.stringify({ at, platform: "win32", arch: "arm64", unit, result, ms, timedOut }));
  if (lines.length > 0) writeFileSync(path.join(home, "test-timings.jsonl"), `${lines.join("\n")}\n`);
  return home;
}
const machine = { platform: "win32", arch: "arm64", env: {} };
const passes = (unit, ...ms) => ms.map((each) => [unit, "pass", each]);

test("a unit with too little history on this machine keeps the fixed deadline", (t) => {
  const home = history(t, [...passes("cli", 40_000, 50_000), ...passes("forest", 1_000, 1_000, 1_000, 1_000, 1_000)]);
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  assert.equal(unitLimit("forest", { home, platform: "linux", arch: "x64", env: {} }).source, "default", "another machine's times are not this one's");
});

test("a unit with too little history takes the run's own default deadline when it gives one", (t) => {
  const home = history(t, passes("cli", 40_000));
  const env = { STORYTREE_UNIT_LIMIT_MS: "360000" };
  assert.deepEqual(unitLimit("cli", { home, ...machine, env }), { ms: 360_000, source: "STORYTREE_UNIT_LIMIT_MS" });
  assert.deepEqual(unitLimit("cli", { home, ...machine }), { ms: UNIT_LIMIT_MS, source: "default" });
  const learned = history(t, passes("cli", 200_000, 200_000, 200_000, 200_000, 200_000));
  assert.deepEqual(unitLimit("cli", { home: learned, ...machine, env }), { ms: 400_000, source: "learned" }, "a longer learned deadline still wins");
});

test("4.16 · a run that gives its own default deadline never gives a unit a learned one under it", (t) => {
  const env = { STORYTREE_UNIT_LIMIT_MS: "360000" };
  const fast = history(t, passes("cli", 50_000, 50_000, 50_000, 50_000, 50_000));
  assert.deepEqual(unitLimit("cli", { home: fast, ...machine, env }), { ms: 360_000, source: "STORYTREE_UNIT_LIMIT_MS, above its learned 100 s" });
  assert.deepEqual(unitLimit("cli", { home: fast, ...machine }), { ms: 100_000, source: "learned" }, "without one, the learned deadline stands");
  const drifting = history(t, passes("session-management", 235_000, 300_000, 357_000, 250_000, 240_000));
  assert.deepEqual(unitLimit("session-management", { home: drifting, ...machine, env }), { ms: 714_000, source: "learned" });
});

test("4.17 · the timing history keeps each unit's most recent rows on each machine, so a history carried from run to run stays small", (t) => {
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

test("4.10 · a unit's deadline is learned only from runs that tested as many units at once, and each run records how many", (t) => {
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

test("4.13 · a unit with too few passes at this concurrency is never given less than twice its slowest recent pass at any", (t) => {
  const slow = history(t, [["session-management", "fail", 180_000, true], ...passes("session-management", 233_000)]);
  assert.deepEqual(unitLimit("session-management", { home: slow, ...machine }), { ms: 466_000, source: "twice its slowest pass, too few to learn from" });
  const alone = history(t, passes("cli", 160_000, 226_000, 150_000, 140_000, 133_000));
  assert.deepEqual(unitLimit("cli", { home: alone, ...machine, jobs: 2 }), { ms: 452_000, source: "twice its slowest pass, too few to learn from" }, "beside others it is no faster than alone");
  assert.deepEqual(unitLimit("cli", { home: alone, ...machine, jobs: 2, env: { STORYTREE_UNIT_LIMIT_MS: "600000" } }), { ms: 600_000, source: "STORYTREE_UNIT_LIMIT_MS" }, "the run's default when that is longer");
});

test("4.10 · a unit run beside others prints nothing and gives back its whole output, its last line included", async (t) => {
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

test("4.32 · a unit's row counts the tests it skipped, so a skip is seen in the results table", async (t) => {
  const root = fixture(t, {
    "skips.test.mjs": `import { test } from "node:test";
test("runs", () => {});
test("skipped by option", { skip: "flaky: increment_x" }, () => {});
test("skipped from inside", (t) => t.skip("platform:win32: needs Windows"));
test("left to do", { todo: "not yet" }, () => {});`,
    "plain.test.mjs": `import { test } from "node:test";\ntest("runs", () => {});`,
  });
  const skipping = await runUnit({ root, files: ["skips.test.mjs"], env: process.env, stdio: "ignore" });
  assert.equal(skipping.code, 0);
  assert.match(unitReason(skipping, root), /^\d+\.\d s, 2 skipped$/);
  const plain = await runUnit({ root, files: ["plain.test.mjs"], env: process.env, stdio: "ignore" });
  assert.doesNotMatch(unitReason(plain, root), /skipped/, "a unit that skipped nothing says nothing of skips");
});

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

test("4.24 · a test's limit is three times its slowest recent pass on this machine, never under 60 s; with fewer than five passes it keeps 60 s", (t) => {
  const home = testHistory(t, [...testPasses(real, "1.1 › answers", 36_000, 50_000, 41_000, 44_000, 39_000), ...testPasses(real, "1.2 · rings", 19_000, 20_000, 18_000, 19_000, 18_500), ...testPasses(real, "1.3 · new", 50_000, 50_000)]);
  assert.deepEqual(testLimit(real, "1.1 › answers", { home, ...machine }), { ms: 150_000, source: "learned" });
  assert.deepEqual(testLimit(real, "1.2 · rings", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "learned" }, "never under 60 s");
  assert.deepEqual(testLimit(real, "1.3 · new", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.deepEqual(testLimit(real, "never seen", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.equal(testLimit(real, "1.1 › answers", { home, platform: "linux", arch: "x64" }).ms, TEST_LIMIT_MS, "another machine's times are not this one's");
});

test("4.24 · each timeout at its limit since a test last passed doubles its next limit, up to the ceiling, and its next pass ends the growth", (t) => {
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

test("4.24 · a unit's tests run under the largest of its tests' limits, naming the test it came from; a unit with none learned keeps 60 s", (t) => {
  const home = testHistory(t, [...testPasses(real, "1.1 › answers", 50_000, 50_000, 50_000, 50_000, 50_000), ...testPasses("packages/voice/src/door.test.ts", "1.9 · hangs up", 30_000, 30_000, 30_000, 30_000, 30_000), ...testPasses("packages/voice-extra/src/a.test.ts", "slower", 90_000, 90_000, 90_000, 90_000, 90_000)]);
  assert.deepEqual(unitTestLimit("packages/voice", { home, ...machine }), { ms: 150_000, source: `learned for ${real} › 1.1 › answers` });
  assert.deepEqual(unitTestLimit("packages/cli", { home, ...machine }), { ms: TEST_LIMIT_MS, source: "default" });
  assert.deepEqual(unitTestLimit(real, { home, ...machine }), { ms: 150_000, source: `learned for ${real} › 1.1 › answers` }, "a file run alone is a unit of its own");
});

test("4.24 · a run records the tests that could need more than 60 s, and every run of a test it already holds, kept per test; units' own rows are unchanged", (t) => {
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

test("4.24 · a unit gives back each test it ran, by its full name, with its time and whether it timed out at the limit; a test's own longer timeout still holds", { timeout: 60_000 }, async (t) => {
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

test("4.24 · a unit whose test timed out at a learned limit names the test, the limit and where it came from", () => {
  const reason = unitReason({ ms: 160_000, timedOut: false, unitLimitMs: 360_000, limitSource: "learned", testLimitMs: 150_000, testLimitSource: `learned for ${real} › 1.1 › answers`, tests: [{ file: real, name: "1.1 › answers", result: "fail", ms: 150_010, timedOut: true }] }, "/");
  assert.equal(reason, `160.0 s (limit 360 s, learned); timed out at the per-test limit of 150 s (learned for ${real} › 1.1 › answers): ${real} › 1.1 › answers`);
  assert.equal(unitReason({ ms: 61_000, timedOut: false, unitLimitMs: 180_000, testLimitMs: 60_000, testLimitSource: "default", tests: [{ file: real, name: "x", result: "fail", ms: 60_001, timedOut: true }] }, "/"), `61.0 s; timed out at the per-test limit of 60 s (default): ${real} › x`);
});

test("4.1 a run of named files past its deadline says it was killed, naming the test still running", async (t) => {
  const dir = fixture(t, {
    "hangs.test.mjs": `import { test } from "node:test";\ntest("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));`,
  });
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const env = { ...process.env, STORYTREE_HOME: path.join(dir, "home"), STORYTREE_TEST_PG_URL: "postgres://unused", STORYTREE_UNIT_LIMIT_MS: "3000" };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER;
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/base-dev-loop/src/test.mjs", path.join(dir, "hangs.test.mjs")], { cwd: repo, env, encoding: "utf8", timeout: 40_000 });
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 1, output);
  assert.match(output, /test harness: .*timed out after .*limit 3(\.0)? s.*killed; still running: .*hangs\.test\.mjs › never ends/);
});

function harnessRun(t, files, { deadline, home, hold, timeout = 40_000 }) {
  const dir = fixture(t, files);
  let entry = "packages/base-dev-loop/src/test.mjs";
  if (hold !== undefined) {
    entry = path.join(dir, "entry.mjs");
    writeFileSync(entry, `import { testCommand } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./test.mjs", import.meta.url))).href)};\ntestCommand({ hold: ${hold} });\n`);
  }
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const env = { ...process.env, STORYTREE_HOME: home ?? path.join(dir, "home"), STORYTREE_TEST_PG_URL: "postgres://unused", STORYTREE_TEST_DEADLINE: String(deadline) };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER;
  delete env.NODE_TEST_CONTEXT;
  const files_ = Object.keys(files).map((name) => path.join(dir, name));
  const run = spawnSync(process.execPath, ["--import", "tsx", entry, ...files_], { cwd: repo, env, encoding: "utf8", timeout });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("4.1 a run given a deadline cuts the unit it is running to the time left, naming the test still running", { timeout: 180_000 }, (t) => {
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
    const at = existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0;
    if (at > 0 && at < deadline * 1000 - 2000) break;
  }
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: .*timed out after .*cut to the run's deadline\), killed; still running: .*hangs\.test\.mjs › never ends/);
});

test("4.1 a run stalled outside any unit past its deadline names where it stalled and ends", (t) => {
  const run = harnessRun(t, { "passes.test.mjs": `import { test } from "node:test";\ntest("passes", () => {});` }, { deadline: Math.floor((Date.now() - DEADLINE_GRACE_MS) / 1000) + 2, hold: "() => new Promise(() => { setInterval(() => {}, 1000); })" });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /test harness: past the run's deadline .* while waiting for the heavy-run lock; ending the run/);
});

test("4.29 · a run of files named on the command line tells its hold its scope is files, so the hold can let it pass the full runs' queue", (t) => {
  const run = harnessRun(t, { "passes.test.mjs": `import { test } from "node:test";\ntest("passes", () => {});` }, { deadline: Math.floor(Date.now() / 1000) + 60, hold: "(options) => { console.log(`hold taken for scope: ${options.scope}`); return () => {}; }" });
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /hold taken for scope: files/);
});

test("4.30 · on macOS a unit killed at its own deadline runs once more, and its row says its first try timed out", async () => {
  const killed = { code: 1, ms: 360_200, timedOut: true, running: [{ file: "/r/forest/planet-turn.test.ts", name: "3.86 · turns" }], exitHung: [], unitLimitMs: 257_000, limitSource: "learned", tests: [{ name: "3.85", result: "fail" }], unloaded: ["forest/a.test.ts"], output: "first\n" };
  const passed = { code: 0, ms: 90_000, timedOut: false, running: [], exitHung: [], unitLimitMs: 257_000, limitSource: "learned", tests: [{ name: "3.86", result: "pass" }], unloaded: [], output: "second\n" };
  const tries = (...results) => {
    const runs = [...results];
    const runOnce = async () => runs.shift();
    runOnce.count = () => results.length - runs.length;
    return runOnce;
  };

  const mac = tries(killed, passed);
  const run = await withMacRetry(mac, { platform: "darwin" });
  assert.equal(mac.count(), 2);
  assert.equal(run.code, 0);
  assert.deepEqual([run.tests, run.unloaded, run.output], [[...killed.tests, ...passed.tests], killed.unloaded, "first\nsecond\n"]);
  assert.equal((await withMacRetry(tries({ ...killed, output: undefined }, { ...passed, output: undefined }), { platform: "darwin" })).output, undefined);
  assert.equal(unitReason(run, "/r"), "first try timed out after 360.2 s (limit 257 s, learned), killed; still running: forest/planet-turn.test.ts › 3.86 · turns; second try: 90.0 s (limit 257 s, learned)");

  const twice = await withMacRetry(tries(killed, killed), { platform: "darwin" });
  assert.equal(twice.code, 1);
  assert.match(unitReason(twice, "/r"), /^first try timed out after .*; second try: timed out after 360\.2 s/);

  for (const [first, options] of [[killed, { platform: "linux" }], [killed, { platform: "win32" }], [{ ...killed, cut: true }, { platform: "darwin" }], [killed, { platform: "darwin", timeLeft: () => false }], [{ ...killed, timedOut: false, exitHung: ["/r/a.test.mjs"] }, { platform: "darwin" }], [passed, { platform: "darwin" }]]) {
    const once = tries(first, passed);
    assert.equal(await withMacRetry(once, options), first);
    assert.equal(once.count(), 1);
  }
});
