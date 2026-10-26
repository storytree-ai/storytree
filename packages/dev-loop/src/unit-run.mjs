// Capability 6 · Running the tests. One test unit's `node --test` process, bounded so that `pnpm test` and the gate always end and
// name what hung (ADR-0731). Three layers:
//   --test-force-exit   a file whose tests have finished exits even if a failed test left a handle
//                       open (a connection, a held lock): it reports its real failure, not a hang;
//   --test-timeout      a test that never ends fails at TEST_LIMIT_MS, and node names it;
//   the exit watch      a file whose tests have all ended but whose process has not exited for
//                       EXIT_GRACE_MS (a Node exit deadlock seen on CI, increment_67a3090c077c)
//                       fails the unit at once, named, instead of waiting out its deadline; a test
//                       blocked in a synchronous call whose start never reached the reporter looks
//                       the same, so the reason names both causes;
//   the unit deadline   past UNIT_LIMIT_MS the unit's whole process tree is killed, and the tests
//                       still running are named (test-running-reporter.mjs records them).
// TEST_LIMIT_MS is about three times the slowest test seen anywhere on 2026-09-28 (117 CI jobs on
// Linux, macOS and Windows x64: 22.4 s), and the least any test gets. Each test's own limit is learned
// too (testLimit, ADR-1152): three times its slowest recent pass here, doubled after each timeout since
// it last passed; a unit's tests run under the largest of its tests' (unitTestLimit), since
// --test-timeout is one value per process, so a hanging test still fails at a bounded limit, named.
// A test's own `timeout` option overrides it, so it is never lowered.
// Each unit's deadline is learned from this machine's history (unitLimit, ADR-0785):
// twice its slowest recent pass, doubled after each kill since it last passed, or what an agent set
// for it here with a reason. Until a unit has enough history its deadline is the run's default:
// STORYTREE_UNIT_LIMIT_MS when given (CI gives one, its runners having little history), else UNIT_LIMIT_MS;
// or twice its slowest recent pass at any concurrency, when that is longer (increment_3f535ac2dc4e).
// A run that gives its own default never gives a learned deadline under it: CI carries its history
// from main's runs, and a pull request's kills are never carried back to grow it (increment_d51b4f1d9fc8).
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";

import { parseJunit } from "./test-run/test-run.mjs";

import { stopServersUnder, unitTempPrefix } from "./test-leftovers.mjs";

/** The variables that name an agent's session to a command: each watched harness's, and storytree's own. */
const SESSION_VARIABLES = [...WATCHED_HARNESSES.flatMap((harness) => (harness.shellSession === undefined ? [] : [harness.shellSession])), SESSION_ENV];

export const TEST_LIMIT_MS = 60_000;
export const UNIT_LIMIT_MS = 180_000;
export const EXIT_GRACE_MS = 20_000; // a root after() hook or coverage written at exit fits well inside
export const UNIT_LIMIT_FLOOR_MS = 60_000;
export const UNIT_LIMIT_CEILING_MS = 900_000;
export const DEADLINE_GRACE_MS = 30_000; // past the run's deadline, longer than a cut unit takes to be killed and tabled
const LEARN_FROM_PASSES = 5; // fewer passes than this on this machine: the fixed deadline
const RECENT_PASSES = 20;
export const TIMING_ROWS_KEPT = 2 * RECENT_PASSES; // per unit, machine and concurrency (per test and machine), once the history is trimmed
const TEST_LIMIT_FACTOR = 3; // a test's learned limit, times its slowest recent pass: the rule TEST_LIMIT_MS came from
const TRIM_TIMINGS_AT = 5_000; // rows; past this a recorded run trims the history
const defaultHome = () => process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3");
const limitsFile = (home) => path.join(home, "test-limits.json");

const tsx = import.meta.resolve("tsx"); // from here, so a unit whose cwd is elsewhere still finds it
const reporter = fileURLToPath(new URL("./test-running-reporter.mjs", import.meta.url));
let runs = 0;
// The units' temp folders while they run: a harness that exits mid-unit (past its run's deadline) stops their servers.
const liveTemps = new Set();
process.on("exit", () => {
  for (const temp of liveTemps) stopServersUnder(temp);
});

/**
 * Run one unit's files under node:test, resolving { code, ms, timedOut, running, exitHung, unitLimitMs, tests, unloaded },
 * `tests` being each test that ended: { file (from root), name (its full name), result, ms, timedOut (at testLimitMs) },
 * and `unloaded` each file (from root) that failed with no test in it ended, as one whose import is not built yet does.
 * With `hold`, as when other units run beside it, nothing is printed: its stdout and stderr, in the
 * order they came, are resolved as `output` once the process has ended.
 */
export function runUnit({ root, files, env, args = [], evidence, testLimitMs = TEST_LIMIT_MS, unitLimitMs = UNIT_LIMIT_MS, exitGraceMs = EXIT_GRACE_MS, hold = false, stdio = hold ? ["ignore", "pipe", "pipe"] : "inherit", onSpawn = () => {} }) {
  const runningFile = path.join(tmpdir(), `storytree-running-${process.pid}-${++runs}.jsonl`);
  rmSync(runningFile, { force: true });
  const guard = ["--test-force-exit"];
  const givenLimit = args.find((arg) => arg.startsWith("--test-timeout="));
  if (givenLimit !== undefined) testLimitMs = Number(givenLimit.slice("--test-timeout=".length));
  else guard.push(`--test-timeout=${testLimitMs}`);
  if (!args.some((arg) => arg.startsWith("--test-reporter"))) {
    // Separate destinations: spec ending stdout can discard another reporter's final output.
    guard.push("--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${pathToFileURL(reporter).href}`, "--test-reporter-destination=stderr");
  }
  // A fresh directory per invocation: later units and reruns cannot replace earlier evidence.
  // Keep JUnit alongside the normal reporters, including the watchdog's running-test stream.
  let report;
  let provenance;
  if (evidence !== undefined) {
    mkdirSync(evidence.directory, { recursive: true });
    report = path.join(mkdtempSync(path.join(evidence.directory, "unit-")), "tests.xml");
    provenance = {
      unit: evidence.unit,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      platform: process.platform,
      run: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    };
    guard.push("--test-reporter=junit", `--test-reporter-destination=${report}`);
  }
  // A unit is a run of its own even when a test runs it: under node:test, NODE_TEST_CONTEXT would
  // make it report into the outer run instead.
  const { NODE_TEST_CONTEXT: _, STORYTREE_TEST_EVIDENCE: _evidence, ...own } = env;
  // Nor are its tests an agent's session: a command a test runs in the real project would record on the session
  // that started the run, its fixture words read as that agent's (friction_fa050a39ba6f). A test that needs one sets its own.
  for (const name of SESSION_VARIABLES) delete own[name];
  // A temp folder of the unit's own, named by each platform's variable and removed with whatever its
  // tests left in it when it ends: a run leaves nothing of its own in the system temp folder
  // (increment_74ca830203db). A Postgres a test started there is stopped first, however the unit
  // ended (increment_e72347bdd355). A run killed with its harness may leave this one folder, which
  // the next run's start sweeps (test-leftovers.mjs).
  const temp = mkdtempSync(path.join(tmpdir(), unitTempPrefix()));
  liveTemps.add(temp);
  const removeTemp = () => {
    liveTemps.delete(temp);
    stopServersUnder(temp, { log: (message) => console.error(`test harness: ${message}`) });
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      console.error(`test harness: could not remove the unit's temp folder ${temp}: ${error.message}`);
    }
  };
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // Options before any file: node hands whatever follows the first file to the tests as their own
    // argv, so `pnpm run test <file> --test-name-pattern=<p>` would run every test (friction_d5da3da1aac6).
    const options = args.filter((arg) => arg.startsWith("-"));
    const named = args.filter((arg) => !arg.startsWith("-"));
    const child = spawn(process.execPath, ["--import", tsx, "--test", ...guard, ...options, ...named, ...files], {
      cwd: root,
      env: { ...own, STORYTREE_TEST_RUNNING: runningFile, TMPDIR: temp, TMP: temp, TEMP: temp },
      stdio,
    });
    onSpawn(child);
    let output = "";
    // Its last output may still be in the pipes when it exits; a killed tree's close at once.
    const closed = !hold ? Promise.resolve() : Promise.race([new Promise((done) => child.once("close", done)), new Promise((done) => setTimeout(done, 5_000).unref())]);
    if (hold) for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => (output += chunk));
    let timedOut = false;
    let running = [];
    let exitHung = [];
    const deadline = setTimeout(() => {
      timedOut = true;
      running = stillRunning(runningFile);
      killTree(child);
    }, unitLimitMs);
    const exitWatch = setInterval(() => {
      exitHung = endedNotExited(runningFile, Date.now() - exitGraceMs);
      if (exitHung.length > 0) killTree(child);
    }, Math.min(1_000, exitGraceMs / 2));
    const stop = () => {
      clearTimeout(deadline);
      clearInterval(exitWatch);
    };
    child.on("error", (error) => {
      stop();
      rmSync(runningFile, { force: true });
      removeTemp();
      reject(error);
    });
    child.on("exit", (code) => {
      stop();
      const tests = endedTests(runningFile, root, testLimitMs);
      const unloaded = failedUnloaded(runningFile, root);
      rmSync(runningFile, { force: true });
      removeTemp();
      const result = { code: timedOut || exitHung.length > 0 ? 1 : (code ?? 1), ms: Date.now() - started, timedOut, running, exitHung, unitLimitMs, tests, unloaded };
      if (report !== undefined) {
        try {
          let xml = "";
          try { xml = readFileSync(report, "utf8"); } catch { /* A killed process may have no report. */ }
          const results = xml.trimEnd().endsWith("</testsuites>") ? parseJunit(xml).map((test) => ({
            ...test, file: path.relative(root, test.file).replaceAll("\\", "/"),
          })) : [];
          writeFileSync(path.join(path.dirname(report), "result.json"), JSON.stringify({ ...provenance, code: result.code, results }), { flag: "wx" });
        } catch (error) {
          reject(error);
          return;
        }
      }
      closed.then(() => resolve(hold ? { ...result, output } : result));
    });
  });
}

/** Kill a process and every process under it: taskkill /T on Windows, the ps tree elsewhere. */
export function killTree(child, signal = "SIGKILL") {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    for (const pid of [...descendants(child.pid), child.pid]) {
      try {
        process.kill(pid, signal);
      } catch {} // already gone
    }
  } catch {
    child.kill(signal);
  }
}

function descendants(pid) {
  const children = new Map();
  for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!child) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const found = [];
  const walk = (parent) => {
    for (const child of children.get(parent) ?? []) {
      found.push(child);
      walk(child);
    }
  };
  walk(pid);
  return found;
}

/** The entries started and not yet ended in a unit's running file. */
function openEntries(runningFile) {
  const lines = readJsonLines(runningFile);
  const open = new Map();
  for (const entry of lines) {
    const key = JSON.stringify([entry.file, entry.nesting, entry.name]);
    if (entry.event === "start") open.set(key, entry);
    else open.delete(key);
  }
  return { lines, open: [...open.values()] };
}

/**
 * A file's own entry, named by the path it was given: its basename, or a path relative to the unit's
 * root, which `file` ends with (compared by suffix: on macOS `file` is the real path under /private).
 */
const isFileEntry = (entry) => entry.nesting === 0 && entry.file && `/${entry.file.replaceAll("\\", "/")}`.endsWith(`/${entry.name.replaceAll("\\", "/").replace(/^\.\//, "")}`);

/** The files whose own entry is still open, with no test open, after tests that all ended before `since`. */
function endedNotExited(runningFile, since) {
  const { lines, open } = openEntries(runningFile);
  const busy = new Set(open.filter((entry) => !isFileEntry(entry)).map((entry) => entry.file));
  const lastTest = new Map();
  for (const entry of lines) if (!isFileEntry(entry)) lastTest.set(entry.file, entry.at);
  return open
    .filter((entry) => isFileEntry(entry) && !busy.has(entry.file) && lastTest.get(entry.file) < since)
    .map((entry) => entry.file);
}

/**
 * Each test that ended in a unit's running file (test-running-reporter.mjs writes its time and result), by
 * its full name; one that failed for its time at `limitMs` or later timed out at the limit, not its own shorter one.
 */
function endedTests(runningFile, root, limitMs) {
  return readJsonLines(runningFile).flatMap((entry) => entry.event !== "end" || entry.fullName === undefined ? [] : [{
    file: path.relative(root, realPath(entry.file)).replaceAll("\\", "/"),
    name: entry.fullName,
    result: entry.passed ? "pass" : "fail",
    ms: Math.round(entry.ms),
    timedOut: entry.timeout === true && entry.ms >= 0.99 * limitMs,
  }]);
}

/** The files, from root, whose own entry ended failed with no test in them ended: a file that failed to load. */
function failedUnloaded(runningFile, root) {
  const lines = readJsonLines(runningFile).filter((entry) => entry.event === "end");
  const ran = new Set(lines.filter((entry) => entry.fullName !== undefined).map((entry) => realPath(entry.file)));
  return lines.filter((entry) => isFileEntry(entry) && entry.passed === false && !ran.has(realPath(entry.file))).map((entry) => path.relative(root, realPath(entry.file)).replaceAll("\\", "/"));
}

/** A file by its real path, as macOS names a temporary file one way for its tests and another (under /private) for itself. */
function realPath(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** The tests started and not yet ended, the innermost of each file; a file stuck outside any test is named alone. */
function stillRunning(runningFile) {
  const byFile = new Map();
  for (const entry of openEntries(runningFile).open) {
    const isFile = isFileEntry(entry);
    const list = byFile.get(entry.file) ?? { tests: [], file: false };
    if (isFile) list.file = true;
    else list.tests.push(entry);
    byFile.set(entry.file, list);
  }
  const result = [];
  for (const [file, { tests, file: loading }] of byFile) {
    const deepest = Math.max(...tests.map((entry) => entry.nesting));
    const innermost = tests.filter((entry) => entry.nesting === deepest);
    if (innermost.length > 0) result.push(...innermost.map(({ name }) => ({ file, name })));
    else if (loading) result.push({ file, name: undefined });
  }
  return result;
}

/**
 * The deadline for a unit with too little history (and for named files): STORYTREE_UNIT_LIMIT_MS
 * when the run gives one, else UNIT_LIMIT_MS. CI gives one (increment_3bd2b051ab67), which is also
 * the least a learned deadline may be there (increment_d51b4f1d9fc8); so does a test of the deadline itself.
 */
export function defaultUnitLimit(env = process.env) {
  const ms = Number(env.STORYTREE_UNIT_LIMIT_MS);
  return env.STORYTREE_UNIT_LIMIT_MS && Number.isFinite(ms) && ms > 0 ? { ms, source: "STORYTREE_UNIT_LIMIT_MS" } : { ms: UNIT_LIMIT_MS, source: "default" };
}

/**
 * A unit's deadline on this machine and where it came from: what an agent set for it here, else
 * twice its slowest recent pass once it has enough, else the run's default (defaultUnitLimit); then
 * doubled for each kill since it last passed (a killed run never enters the passes, so without this
 * it could never recover), never over UNIT_LIMIT_CEILING_MS. Only runs testing `jobs` units at once
 * count, but for one thing: a unit with too few of those is never given less than twice its slowest
 * recent pass at any concurrency, since beside others it is no faster than alone, and a unit slower
 * than the default would otherwise be killed again after every pass until it had enough.
 */
export function unitLimit(unit, { home = defaultHome(), platform = process.platform, arch = process.arch, env = process.env, jobs = 1 } = {}) {
  // Learned only from runs testing as many units at once as this one: a unit sharing the machine
  // with others runs slower than alone (a row from before jobs were recorded ran alone).
  const here = readJsonLines(path.join(home, "test-timings.jsonl")).filter((row) => row.unit === unit && row.platform === platform && row.arch === arch);
  const rows = here.filter((row) => (row.jobs ?? 1) === jobs);
  const set = readLimits(home)[unit];
  const recent = (all) => all.filter((row) => row.result === "pass").slice(-RECENT_PASSES);
  const twiceSlowest = (passes) => Math.ceil((2 * Math.max(...passes.map((row) => row.ms))) / 1000) * 1000;
  const passes = recent(rows);
  const anyPasses = recent(here);
  let { ms, source } = defaultUnitLimit(env);
  if (set) [ms, source] = [set.ms, `set: ${set.reason}`];
  else if (passes.length >= LEARN_FROM_PASSES) {
    const learned = Math.max(UNIT_LIMIT_FLOOR_MS, twiceSlowest(passes));
    if (source === "STORYTREE_UNIT_LIMIT_MS" && learned < ms) source = `STORYTREE_UNIT_LIMIT_MS, above its learned ${learned / 1000} s`;
    else [ms, source] = [learned, "learned"];
  }
  else if (anyPasses.length > 0 && twiceSlowest(anyPasses) > ms) [ms, source] = [Math.min(UNIT_LIMIT_CEILING_MS, twiceSlowest(anyPasses)), "twice its slowest pass, too few to learn from"];
  const lastPass = rows.findLastIndex((row) => row.result === "pass");
  const kills = rows.slice(lastPass + 1).filter((row) => row.timedOut).length;
  if (kills === 0) return { ms, source };
  return { ms: Math.min(UNIT_LIMIT_CEILING_MS, ms * 2 ** kills), source: `${source}, grown after ${kills} kill${kills === 1 ? "" : "s"}` };
}

/**
 * A test's limit on this machine and where it came from (ADR-1152): three times its slowest recent pass once
 * it has enough, never under TEST_LIMIT_MS, else TEST_LIMIT_MS; then doubled for each timeout since it last
 * passed, never over UNIT_LIMIT_CEILING_MS. On CI the history is main's, so a pull request's timeouts never grow it.
 */
export function testLimit(file, name, { home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  return limitFrom(testRows(home, platform, arch).filter((row) => row.file === file && row.test === name));
}

/** The limit a unit's tests run under: the largest of its tests' (a unit's files, or the one file run alone), naming whose. */
export function unitTestLimit(unit, { home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  const tests = Map.groupBy(testRows(home, platform, arch).filter((row) => row.file === unit || row.file.startsWith(`${unit}/`)), (row) => JSON.stringify([row.file, row.test]));
  let largest = { ms: TEST_LIMIT_MS, source: "default" };
  for (const [key, rows] of tests) {
    const limit = limitFrom(rows);
    const [file, name] = JSON.parse(key);
    if (limit.ms > largest.ms) largest = { ms: limit.ms, source: `${limit.source} for ${file} › ${name}` };
  }
  return largest;
}

const testRows = (home, platform, arch) => readJsonLines(path.join(home, "test-timings.jsonl")).filter((row) => row.test !== undefined && row.platform === platform && row.arch === arch);

function limitFrom(rows) {
  const passes = rows.filter((row) => row.result === "pass").slice(-RECENT_PASSES);
  let [ms, source] = [TEST_LIMIT_MS, "default"];
  if (passes.length >= LEARN_FROM_PASSES) [ms, source] = [Math.max(TEST_LIMIT_MS, Math.ceil((TEST_LIMIT_FACTOR * Math.max(...passes.map((row) => row.ms))) / 1000) * 1000), "learned"];
  const timeouts = rows.slice(rows.findLastIndex((row) => row.result === "pass") + 1).filter((row) => row.timedOut).length;
  if (timeouts === 0) return { ms, source };
  return { ms: Math.min(UNIT_LIMIT_CEILING_MS, ms * 2 ** timeouts), source: `${source}, grown after ${timeouts} timeout${timeouts === 1 ? "" : "s"}` };
}

/** The run's deadline, from STORYTREE_TEST_DEADLINE (Unix seconds) when set: CI's job limit less room to report. */
export function runDeadline(env) {
  const seconds = Number(env.STORYTREE_TEST_DEADLINE);
  return env.STORYTREE_TEST_DEADLINE && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** A unit's limit cut to the time left before the run's deadline, saying so when it is. */
export function withinDeadline(limit, deadline, now = Date.now()) {
  if (deadline === undefined || deadline - now >= limit.ms) return limit;
  return { ms: Math.max(0, deadline - now), source: "cut to the run's deadline", cut: true };
}

/** Set a unit's deadline on this machine, with the reason any later run shows beside it. */
export function setUnitLimit(unit, ms, { reason, home = defaultHome() }) {
  if (!reason?.trim()) throw new Error("a unit's deadline is set with a reason, shown on every run it applies to");
  if (!(ms > 0)) throw new Error(`a deadline is a positive time, not ${ms}`);
  writeLimits(home, { ...readLimits(home), [unit]: { ms, reason: reason.trim(), at: new Date().toISOString() } });
}

/** Clear a set deadline, so the unit's is learned again. */
export function clearUnitLimit(unit, { home = defaultHome() } = {}) {
  const { [unit]: _, ...rest } = readLimits(home);
  writeLimits(home, rest);
}

function readLimits(home) {
  try {
    return JSON.parse(readFileSync(limitsFile(home), "utf8"));
  } catch {
    return {};
  }
}

function writeLimits(home, limits) {
  mkdirSync(home, { recursive: true });
  writeFileSync(limitsFile(home), `${JSON.stringify(limits, null, 2)}\n`);
}

function readJsonLines(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return []; // a line cut short by a run that died mid-write
    }
  });
}

/** A unit's row note in the results table: its time and deadline, and on a timeout what was still running. */
export function unitReason(run, root) {
  const timeouts = (run.tests ?? []).filter((test) => test.timedOut);
  const reason = unitRowReason(run, root);
  if (timeouts.length === 0) return reason;
  return `${reason}; timed out at the per-test limit of ${run.testLimitMs / 1000} s (${run.testLimitSource}): ${timeouts.map(({ file, name }) => `${file} › ${name}`).join("; ")}`;
}

function unitRowReason({ ms, timedOut, running = [], exitHung = [], unitLimitMs, limitSource }, root) {
  const took = `${(ms / 1000).toFixed(1)} s`;
  const limit = `limit ${unitLimitMs / 1000} s${limitSource ? `, ${limitSource}` : ""}`;
  const shown = (file) => path.relative(root, file).replaceAll("\\", "/");
  // Where a child's stdout is an async pipe (Windows), a test blocking its process in a synchronous call
  // (spawnSync, execSync) never reports its start, so it looks the same to the exit watch (friction_e50f26922ba5).
  const exitCauses = "a handle left open or an exit that hangs, or a test blocking its process in a synchronous call (spawnSync, execSync) whose start never reached the reporter";
  if (exitHung.length > 0) return `failed after ${took} (${limit}), killed; ${exitHung.map((file) => `${shown(file)}: its last reported test ended, but its process did not exit`).join("; ")} (${exitCauses})`;
  if (!timedOut) return limitSource ? `${took} (${limit})` : took;
  const named = running.map(({ file, name }) => {
    const shown = file ? path.relative(root, file).replaceAll("\\", "/") : "(unknown file)";
    return name === undefined ? `${shown} (outside any test)` : `${shown} › ${name}`;
  });
  const what = named.length > 0 ? `still running: ${named.join("; ")}` : "no test had started or all had ended; a file may be stuck loading";
  return `timed out after ${took} (${limit}), killed; ${what}`;
}

/**
 * Add this run's unit times, and how many units it tested at once, to the machine's history, which
 * unitLimit learns each deadline from; and its tests' times (runUnit's `tests`), which testLimit learns
 * each test's from: only a test that could need more than TEST_LIMIT_MS (a pass a third of it or
 * longer, or a timeout at its limit), and then every pass or timeout of it, so the history holds only
 * slow tests. Past `trimAt` rows the history keeps only each unit's last TIMING_ROWS_KEPT on each
 * machine at each concurrency, and each test's on each machine, so one carried from run to run stays small.
 */
export function recordTimings(units, { home = defaultHome(), jobs = 1, trimAt = TRIM_TIMINGS_AT, tests = [] } = {}) {
  const at = new Date().toISOString();
  const file = path.join(home, "test-timings.jsonl");
  const { platform, arch } = process;
  const held = new Set(tests.length === 0 ? [] : testRows(home, platform, arch).map((row) => JSON.stringify([row.file, row.test])));
  const lines = [
    ...Object.entries(units).map(([unit, { result, ms, timedOut = false }]) => JSON.stringify({ at, platform, arch, unit, result, ms, timedOut, jobs })),
    ...tests
      .filter((test) => test.timedOut || (test.result === "pass" && (test.ms >= TEST_LIMIT_MS / TEST_LIMIT_FACTOR || held.has(JSON.stringify([test.file, test.name])))))
      .map(({ file: testFile, name, result, ms, timedOut }) => JSON.stringify({ at, platform, arch, file: testFile, test: name, result, ms, timedOut })),
  ];
  if (lines.length === 0) return;
  mkdirSync(home, { recursive: true });
  appendFileSync(file, `${lines.join("\n")}\n`);
  const rows = readJsonLines(file);
  if (rows.length <= trimAt) return;
  const seen = new Map();
  const kept = rows.toReversed().filter((row) => {
    const key = JSON.stringify(row.test === undefined ? [row.unit, row.platform, row.arch, row.jobs ?? 1] : [row.file, row.test, row.platform, row.arch]);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return seen.get(key) <= TIMING_ROWS_KEPT;
  });
  writeFileSync(file, `${kept.toReversed().map((row) => JSON.stringify(row)).join("\n")}\n`);
}

/** Each unit's slowest recent passing time on this machine, at any number of units at once: what a pool orders by. */
export function recentPassTimes({ home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  const passes = new Map();
  for (const row of readJsonLines(path.join(home, "test-timings.jsonl"))) {
    if (row.unit === undefined || row.result !== "pass" || row.platform !== platform || row.arch !== arch) continue;
    passes.set(row.unit, [...(passes.get(row.unit) ?? []), row.ms].slice(-LEARN_FROM_PASSES));
  }
  return new Map([...passes].map(([unit, times]) => [unit, Math.max(...times)]));
}
