// Capability 6 · Running the tests. One test unit's `node --test` process, bounded so that `pnpm test` and the gate always end and
// name what hung (ADR-0731). Three layers:
//   --test-force-exit   a file whose tests have finished exits even if a failed test left a handle
//                       open (a connection, a held lock): it reports its real failure, not a hang;
//   --test-timeout      a test that never ends fails at TEST_LIMIT_MS, and node names it;
//   the exit watch      a file whose tests have all ended but whose process has not exited for
//                       EXIT_GRACE_MS (a Node exit deadlock seen on CI, increment_67a3090c077c)
//                       fails the unit at once, named, instead of waiting out its deadline;
//   the unit deadline   past UNIT_LIMIT_MS the unit's whole process tree is killed, and the tests
//                       still running are named (test-running-reporter.mjs records them).
// TEST_LIMIT_MS is about three times the slowest test seen anywhere on 2026-09-28 (117 CI jobs on
// Linux, macOS and Windows x64: 22.4 s); a test that needs longer passes its own `timeout` option.
// Each unit's deadline is learned from this machine's history (unitLimit, ADR-0785):
// twice its slowest recent pass, doubled after each kill since it last passed, or what an agent set
// for it here with a reason. UNIT_LIMIT_MS is the deadline until a unit has enough history.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseJunit } from "./own-health.mjs";

export const TEST_LIMIT_MS = 60_000;
export const UNIT_LIMIT_MS = 180_000;
export const EXIT_GRACE_MS = 20_000; // a root after() hook or coverage written at exit fits well inside
export const UNIT_LIMIT_FLOOR_MS = 60_000;
export const UNIT_LIMIT_CEILING_MS = 900_000;
export const DEADLINE_GRACE_MS = 30_000; // past the run's deadline, longer than a cut unit takes to be killed and tabled
const LEARN_FROM_PASSES = 5; // fewer passes than this on this machine: the fixed deadline
const RECENT_PASSES = 20;
const defaultHome = () => process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3");
const limitsFile = (home) => path.join(home, "test-limits.json");

const tsx = import.meta.resolve("tsx"); // from here, so a unit whose cwd is elsewhere still finds it
const reporter = fileURLToPath(new URL("./test-running-reporter.mjs", import.meta.url));
let runs = 0;

/** Run one unit's files under node:test, resolving { code, ms, timedOut, running, exitHung, unitLimitMs }. */
export function runUnit({ root, files, env, args = [], evidence, testLimitMs = TEST_LIMIT_MS, unitLimitMs = UNIT_LIMIT_MS, exitGraceMs = EXIT_GRACE_MS, stdio = "inherit", onSpawn = () => {} }) {
  const runningFile = path.join(tmpdir(), `storytree-running-${process.pid}-${++runs}.jsonl`);
  rmSync(runningFile, { force: true });
  const guard = ["--test-force-exit"];
  if (!args.some((arg) => arg.startsWith("--test-timeout"))) guard.push(`--test-timeout=${testLimitMs}`);
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
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsx, "--test", ...guard, ...args, ...files], {
      cwd: root,
      env: { ...own, STORYTREE_TEST_RUNNING: runningFile },
      stdio,
    });
    onSpawn(child);
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
      reject(error);
    });
    child.on("exit", (code) => {
      stop();
      rmSync(runningFile, { force: true });
      const result = { code: timedOut || exitHung.length > 0 ? 1 : (code ?? 1), ms: Date.now() - started, timedOut, running, exitHung, unitLimitMs };
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
      resolve(result);
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
 * A unit's deadline on this machine and where it came from: what an agent set for it here, else
 * twice its slowest recent pass once it has enough, else UNIT_LIMIT_MS; then doubled for each kill
 * since it last passed (a killed run never enters the passes, so without this it could never
 * recover), never over UNIT_LIMIT_CEILING_MS.
 */
export function unitLimit(unit, { home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  const rows = readJsonLines(path.join(home, "test-timings.jsonl")).filter((row) => row.unit === unit && row.platform === platform && row.arch === arch);
  const set = readLimits(home)[unit];
  const passes = rows.filter((row) => row.result === "pass").slice(-RECENT_PASSES);
  let ms = UNIT_LIMIT_MS;
  let source = "default";
  if (set) [ms, source] = [set.ms, `set: ${set.reason}`];
  else if (passes.length >= LEARN_FROM_PASSES) [ms, source] = [Math.max(UNIT_LIMIT_FLOOR_MS, Math.ceil((2 * Math.max(...passes.map((row) => row.ms))) / 1000) * 1000), "learned"];
  const lastPass = rows.findLastIndex((row) => row.result === "pass");
  const kills = rows.slice(lastPass + 1).filter((row) => row.timedOut).length;
  if (kills === 0) return { ms, source };
  return { ms: Math.min(UNIT_LIMIT_CEILING_MS, ms * 2 ** kills), source: `${source}, grown after ${kills} kill${kills === 1 ? "" : "s"}` };
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
export function unitReason({ ms, timedOut, running = [], exitHung = [], unitLimitMs, limitSource }, root) {
  const took = `${(ms / 1000).toFixed(1)} s`;
  const limit = `limit ${unitLimitMs / 1000} s${limitSource ? `, ${limitSource}` : ""}`;
  const shown = (file) => path.relative(root, file).replaceAll("\\", "/");
  if (exitHung.length > 0) return `failed after ${took} (${limit}), killed; ${exitHung.map((file) => `${shown(file)}: its tests ended, but its process did not exit`).join("; ")}`;
  if (!timedOut) return limitSource ? `${took} (${limit})` : took;
  const named = running.map(({ file, name }) => {
    const shown = file ? path.relative(root, file).replaceAll("\\", "/") : "(unknown file)";
    return name === undefined ? `${shown} (outside any test)` : `${shown} › ${name}`;
  });
  const what = named.length > 0 ? `still running: ${named.join("; ")}` : "no test had started or all had ended; a file may be stuck loading";
  return `timed out after ${took} (${limit}), killed; ${what}`;
}

/** Add this run's unit times to the machine's history, which unitLimit learns each deadline from. */
export function recordTimings(units, { home = defaultHome() } = {}) {
  const at = new Date().toISOString();
  const lines = Object.entries(units).map(([unit, { result, ms, timedOut = false }]) =>
    JSON.stringify({ at, platform: process.platform, arch: process.arch, unit, result, ms, timedOut }),
  );
  if (lines.length === 0) return;
  mkdirSync(home, { recursive: true });
  appendFileSync(path.join(home, "test-timings.jsonl"), `${lines.join("\n")}\n`);
}
