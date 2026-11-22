// Capability 4 · Running the tests
import { execFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";

import { parseJunit } from "./junit.mjs";

import { removeWhenFree, stopServersUnder, unitTempPrefix } from "./test-leftovers.mjs";
import { storytreeHome as defaultHome } from "./whole-runs.mjs";

const SESSION_VARIABLES = [...WATCHED_HARNESSES.flatMap((harness) => (harness.shellSession === undefined ? [] : [harness.shellSession])), SESSION_ENV];

export const TEST_LIMIT_MS = 60_000;
export const UNIT_LIMIT_MS = 180_000;
export const EXIT_GRACE_MS = 20_000;
export const CAPTURE_LIMIT_MS = 10_000;
const LISTING_LIMIT_MS = 10_000;
const THREAD_GAP_MS = 2_000;
export const UNIT_LIMIT_FLOOR_MS = 60_000;
export const UNIT_LIMIT_CEILING_MS = 900_000;
const BUSY_SHARE = 0.25;
export const DEADLINE_GRACE_MS = 30_000;
const LEARN_FROM_PASSES = 5;
const RECENT_PASSES = 20;
export const TIMING_ROWS_KEPT = 2 * RECENT_PASSES;
const TEST_LIMIT_FACTOR = 3;
const TRIM_TIMINGS_AT = 5_000;
const limitsFile = (home) => path.join(home, "test-limits.json");

const tsx = import.meta.resolve("tsx");
const reporter = fileURLToPath(new URL("./test-running-reporter.mjs", import.meta.url));
let runs = 0;
const liveTemps = new Set();
process.on("exit", () => {
  for (const temp of liveTemps) stopServersUnder(temp);
});

export function runUnit({ root, files, env, args = [], evidence, testLimitMs = TEST_LIMIT_MS, unitLimitMs = UNIT_LIMIT_MS, exitGraceMs = EXIT_GRACE_MS, platform = process.platform, windowsProcesses: listProcesses = windowsProcesses, windowsThreads: listThreads = windowsThreads, captureLimitMs = CAPTURE_LIMIT_MS, hold = false, stdio = hold ? ["ignore", "pipe", "pipe"] : "inherit", onSpawn = () => {} }) {
  const runningFile = path.join(tmpdir(), `storytree-running-${process.pid}-${++runs}.jsonl`);
  rmSync(runningFile, { force: true });
  const guard = ["--test-force-exit"];
  const givenLimit = args.find((arg) => arg.startsWith("--test-timeout="));
  if (givenLimit !== undefined) testLimitMs = Number(givenLimit.slice("--test-timeout=".length));
  else guard.push(`--test-timeout=${testLimitMs}`);
  if (!args.some((arg) => arg.startsWith("--test-reporter"))) {
    guard.push("--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${pathToFileURL(reporter).href}`, "--test-reporter-destination=stderr");
  }
  let report;
  let provenance;
  if (evidence !== undefined) {
    mkdirSync(evidence.directory, { recursive: true });
    report = path.join(mkdtempSync(path.join(evidence.directory, "unit-")), "tests.xml");
    provenance = {
      unit: evidence.unit,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      platform,
      run: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    };
    guard.push("--test-reporter=junit", `--test-reporter-destination=${report}`);
  }
  const { NODE_TEST_CONTEXT: _, STORYTREE_TEST_EVIDENCE: _evidence, ...own } = env;
  for (const name of SESSION_VARIABLES) delete own[name];
  delete own.STORYTREE_FACTORY;
  const temp = mkdtempSync(path.join(tmpdir(), unitTempPrefix()));
  liveTemps.add(temp);
  const removeTemp = () => {
    liveTemps.delete(temp);
    const log = (message) => console.error(`test harness: ${message}`);
    stopServersUnder(temp, { log });
    void removeWhenFree(temp, { log: (message) => log(`the unit's temp folder: ${message}`) });
  };
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const options = args.filter((arg) => arg.startsWith("-"));
    const named = args.filter((arg) => !arg.startsWith("-"));
    const child = spawn(process.execPath, ["--import", tsx, "--test", ...guard, ...options, ...named, ...files], {
      cwd: root,
      env: { ...own, STORYTREE_TEST_RUNNING: runningFile, TMPDIR: temp, TMP: temp, TEMP: temp },
      stdio,
    });
    onSpawn(child);
    let output = "";
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
    let quietSince = started;
    let cpu;
    let listing = false;
    let listedAt = -Infinity;
    let killing = false;
    const listEvery = Math.min(3_000, exitGraceMs / 4);
    const settle = (reading, at) => {
      if (reading !== undefined && (cpu === undefined || cpuShare(cpu, { reading, at }, platform) >= BUSY_SHARE)) quietSince = Date.now();
      cpu = reading === undefined ? undefined : { reading, at };
    };
    const readWindows = (now) => {
      if (listing || now - listedAt < listEvery) return;
      listing = true;
      listedAt = now;
      listProcesses().then((table) => {
        listing = false;
        if (child.exitCode !== null || child.signalCode !== null) return;
        settle(new Map(treeRows(table, child.pid).map((row) => [row.pid, row.cpuMs])), now);
      }, () => {
        listing = false;
      });
    };
    const kill = () => {
      if (platform !== "win32" || report === undefined) return killTree(child);
      killing = true;
      captureExit({ child, root, runningFile, exitHung, listProcesses, listThreads, limitMs: captureLimitMs, to: path.join(path.dirname(report), "exit-capture.json") }).finally(() => killTree(child));
    };
    const exitWatch = setInterval(() => {
      if (killing) return;
      const now = Date.now();
      if (endedNotExited(runningFile, now).length === 0) {
        quietSince = now;
        cpu = undefined;
        return;
      }
      if (platform !== "win32") settle(treeCpu(child.pid, platform), now);
      else if (endedNotExited(runningFile, now - listEvery).length > 0) readWindows(now);
      if (now - quietSince < exitGraceMs) return;
      exitHung = endedNotExited(runningFile, now - exitGraceMs);
      if (exitHung.length > 0) kill();
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
      const skipped = readJsonLines(runningFile).filter((entry) => entry.event === "end" && entry.skipped === true).length;
      const unloaded = failedUnloaded(runningFile, root);
      const spared = slowExits(runningFile, exitGraceMs).filter(({ file }) => !exitHung.includes(file));
      rmSync(runningFile, { force: true });
      removeTemp();
      const result = { code: timedOut || exitHung.length > 0 ? 1 : (code ?? 1), ms: Date.now() - started, timedOut, running, exitHung, spared, unitLimitMs, tests, unloaded, skipped };
      if (report !== undefined) {
        try {
          let xml = "";
          try { xml = readFileSync(report, "utf8"); } catch {}
          const results = xml.trimEnd().endsWith("</testsuites>") ? parseJunit(xml).map((test) => ({
            ...test, file: path.relative(root, test.file).replaceAll("\\", "/"),
          })) : [];
          writeFileSync(path.join(path.dirname(report), "result.json"), JSON.stringify({ ...provenance, code: result.code, results, spared: spared.map(({ file, seconds }) => ({ file: path.relative(root, file).replaceAll("\\", "/"), seconds })) }), { flag: "wx" });
        } catch (error) {
          reject(error);
          return;
        }
      }
      closed.then(() => resolve(hold ? { ...result, output } : result));
    });
  });
}

export function killTree(child, signal = "SIGKILL") {
  if (!child.pid || child.exitCode !== null) return;
  try {
    // eslint-disable-next-line storytree/host-platform-under-given -- killTree kills a real child process, which only the host's own way can kill, whatever platform the run acts for.
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    for (const pid of [...descendants(child.pid), child.pid]) {
      try {
        process.kill(pid, signal);
      } catch {}
    }
  } catch {
    child.kill(signal);
  }
}

function descendants(pid) {
  const children = new Map();
  // eslint-disable-next-line storytree/posix-commands -- descendants is called only by killTree, which has already gone to taskkill on win32 and returned.
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

const isFileEntry = (entry) => entry.nesting === 0 && entry.file && `/${entry.file.replaceAll("\\", "/")}`.endsWith(`/${entry.name.replaceAll("\\", "/").replace(/^\.\//, "")}`);

function endedNotExited(runningFile, since) {
  const { lines, open } = openEntries(runningFile);
  const busy = new Set(open.filter((entry) => !isFileEntry(entry)).map((entry) => entry.file));
  const lastTest = new Map();
  for (const entry of lines) if (!isFileEntry(entry)) lastTest.set(entry.file, entry.at);
  return open
    .filter((entry) => isFileEntry(entry) && !busy.has(entry.file) && lastTest.get(entry.file) < since)
    .map((entry) => entry.file);
}

function treeCpu(pid, platform) {
  const table = [];
  try {
    if (platform === "linux") {
      for (const name of readdirSync("/proc")) {
        if (!/^\d+$/.test(name)) continue;
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          table.push({ pid: Number(name), ppid: Number(fields[1]), used: (Number(fields[11]) + Number(fields[12])) * 10 });
        } catch {}
      }
    } else if (platform === "darwin") {
      for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid=,pcpu="], { encoding: "utf8" }).split("\n")) {
        const [child, parent, share] = line.trim().split(/\s+/);
        if (!share) continue;
        table.push({ pid: Number(child), ppid: Number(parent), used: Number(share.replace(",", ".")) / 100 });
      }
    } else return undefined;
  } catch {
    return undefined;
  }
  return new Map(treeRows(table, pid).map((row) => [row.pid, row.used]));
}

function treeRows(table, pid) {
  const children = Map.groupBy(table, (row) => row.ppid);
  const found = table.filter((row) => row.pid === pid);
  const seen = new Set([pid]);
  const walk = (parent) => {
    for (const row of children.get(parent) ?? []) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      found.push(row);
      walk(row.pid);
    }
  };
  walk(pid);
  return found;
}

function powershellJson(script) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: LISTING_LIMIT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return reject(error);
      try {
        resolve(JSON.parse(stdout.trim() || "[]"));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

export function windowsProcesses() {
  return powershellJson("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; cpuMs = [math]::Round(([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000); commandLine = $_.CommandLine } })");
}

export function windowsThreads(pids) {
  const filter = pids.map((pid) => `ProcessHandle='${Number(pid)}'`).join(" OR ");
  if (filter === "") return Promise.resolve([]);
  return powershellJson(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Thread -Filter "${filter}" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessHandle; tid = [int]$_.Handle; cpuMs = [double]$_.KernelModeTime + [double]$_.UserModeTime; waitReason = $_.ThreadWaitReason; state = $_.ThreadState } })`);
}

async function captureExit({ child, root, runningFile, exitHung, listProcesses, listThreads, limitMs, to }) {
  let cut = false;
  const capture = async () => {
    const tree = treeRows(await listProcesses(), child.pid);
    const pids = tree.map((row) => row.pid);
    const threads = [];
    for (const pause of [0, THREAD_GAP_MS]) {
      await new Promise((done) => setTimeout(done, pause));
      const at = new Date().toISOString();
      threads.push({ at, rows: await listThreads(pids) });
    }
    const lastEnded = new Map();
    for (const entry of readJsonLines(runningFile)) if (entry.event === "end" && entry.fullName !== undefined) lastEnded.set(entry.file, entry.fullName);
    const files = exitHung.map((file) => {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      return { file: relative, lastEnded: lastEnded.get(file), alive: tree.some((row) => row.commandLine?.replaceAll("\\", "/").includes(relative) === true) };
    });
    if (!cut) writeFileSync(to, JSON.stringify({ files, processes: tree, threads }));
  };
  let timer;
  try {
    await Promise.race([capture(), new Promise((done) => (timer = setTimeout(done, limitMs)))]);
  } catch {}
  cut = true;
  clearTimeout(timer);
}

function cpuShare(before, after, platform) {
  const values = [...after.reading.values()];
  if (platform === "darwin") return values.reduce((sum, share) => sum + share, 0);
  const used = [...after.reading].reduce((sum, [pid, ms]) => sum + Math.max(0, ms - (before.reading.get(pid) ?? 0)), 0);
  return used / Math.max(1, after.at - before.at);
}

function slowExits(runningFile, graceMs) {
  const lastTest = new Map();
  const slow = [];
  for (const entry of readJsonLines(runningFile)) {
    if (!isFileEntry(entry)) lastTest.set(entry.file, entry.at);
    else if (entry.event === "end" && lastTest.has(entry.file) && entry.at - lastTest.get(entry.file) > graceMs) slow.push({ file: entry.file, seconds: Math.round((entry.at - lastTest.get(entry.file)) / 100) / 10 });
  }
  return slow;
}

function endedTests(runningFile, root, limitMs) {
  return readJsonLines(runningFile).flatMap((entry) => entry.event !== "end" || entry.fullName === undefined ? [] : [{
    file: path.relative(root, realPath(entry.file)).replaceAll("\\", "/"),
    name: entry.fullName,
    result: entry.passed ? "pass" : "fail",
    ms: Math.round(entry.ms),
    timedOut: entry.timeout === true && entry.ms >= 0.99 * limitMs,
  }]);
}

function failedUnloaded(runningFile, root) {
  const lines = readJsonLines(runningFile).filter((entry) => entry.event === "end");
  const ran = new Set(lines.filter((entry) => entry.fullName !== undefined).map((entry) => realPath(entry.file)));
  return lines.filter((entry) => isFileEntry(entry) && entry.passed === false && !ran.has(realPath(entry.file))).map((entry) => path.relative(root, realPath(entry.file)).replaceAll("\\", "/"));
}

function realPath(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

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

export function defaultUnitLimit(env = process.env) {
  const ms = Number(env.STORYTREE_UNIT_LIMIT_MS);
  return env.STORYTREE_UNIT_LIMIT_MS && Number.isFinite(ms) && ms > 0 ? { ms, source: "STORYTREE_UNIT_LIMIT_MS" } : { ms: UNIT_LIMIT_MS, source: "default" };
}

export function unitLimit(unit, { home = defaultHome(), platform = process.platform, arch = process.arch, env = process.env, jobs = 1 } = {}) {
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

export function testLimit(file, name, { home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  return limitFrom(testRows(home, platform, arch).filter((row) => row.file === file && row.test === name));
}

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

export function runDeadline(env) {
  const seconds = Number(env.STORYTREE_TEST_DEADLINE);
  return env.STORYTREE_TEST_DEADLINE && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export function withinDeadline(limit, deadline, now = Date.now()) {
  if (deadline === undefined || deadline - now >= limit.ms) return limit;
  return { ms: Math.max(0, deadline - now), source: "cut to the run's deadline", cut: true };
}

export function setUnitLimit(unit, ms, { reason, home = defaultHome() }) {
  if (!reason?.trim()) throw new Error("a unit's deadline is set with a reason, shown on every run it applies to");
  if (!(ms > 0)) throw new Error(`a deadline is a positive time, not ${ms}`);
  writeLimits(home, { ...readLimits(home), [unit]: { ms, reason: reason.trim(), at: new Date().toISOString() } });
}

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
      return [];
    }
  });
}

export async function withMacRetry(runOnce, { platform = process.platform, timeLeft = () => true } = {}) {
  const first = await runOnce();
  if (platform !== "darwin" || !first.timedOut || first.cut || first.exitHung?.length > 0 || !timeLeft()) return first;
  const second = await runOnce();
  const both = (key) => [...(first[key] ?? []), ...(second[key] ?? [])];
  const output = second.output === undefined ? undefined : `${first.output ?? ""}${second.output}`;
  return { ...second, tests: both("tests"), unloaded: both("unloaded"), output, firstTry: first };
}

export function unitReason(run, root) {
  if (run.firstTry !== undefined) {
    const { firstTry, ...second } = run;
    return `first try ${unitReason(firstTry, root)}; second try: ${unitReason(second, root)}`;
  }
  const timeouts = (run.tests ?? []).filter((test) => test.timedOut);
  const spared = (run.spared ?? []).map(({ file, seconds }) => `; ${path.relative(root, file).replaceAll("\\", "/")}: its exit was waited on ${seconds.toFixed(1)} s past its last test, spared because its unit was busy`).join("");
  const reason = `${unitRowReason(run, root)}${run.skipped > 0 ? `, ${run.skipped} skipped` : ""}${spared}`;
  if (timeouts.length === 0) return reason;
  return `${reason}; timed out at the per-test limit of ${run.testLimitMs / 1000} s (${run.testLimitSource}): ${timeouts.map(({ file, name }) => `${file} › ${name}`).join("; ")}`;
}

function unitRowReason({ ms, timedOut, running = [], exitHung = [], unitLimitMs, limitSource }, root) {
  const took = `${(ms / 1000).toFixed(1)} s`;
  const limit = `limit ${unitLimitMs / 1000} s${limitSource ? `, ${limitSource}` : ""}`;
  const shown = (file) => path.relative(root, file).replaceAll("\\", "/");
  if (exitHung.length > 0) return `failed after ${took} (${limit}), killed; ${exitHung.map((file) => `${shown(file)}: its last reported test ended, and its process sat idle without exiting`).join("; ")} (a handle left open or an exit that hangs, or a test waiting in a synchronous call that uses no CPU)`;
  if (!timedOut) return limitSource ? `${took} (${limit})` : took;
  const named = running.map(({ file, name }) => {
    const shown = file ? path.relative(root, file).replaceAll("\\", "/") : "(unknown file)";
    return name === undefined ? `${shown} (outside any test)` : `${shown} › ${name}`;
  });
  const what = named.length > 0 ? `still running: ${named.join("; ")}` : "no test had started or all had ended; a file may be stuck loading";
  return `timed out after ${took} (${limit}), killed; ${what}`;
}

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

export function recentPassTimes({ home = defaultHome(), platform = process.platform, arch = process.arch } = {}) {
  const passes = new Map();
  for (const row of readJsonLines(path.join(home, "test-timings.jsonl"))) {
    if (row.unit === undefined || row.result !== "pass" || row.platform !== platform || row.arch !== arch) continue;
    passes.set(row.unit, [...(passes.get(row.unit) ?? []), row.ms].slice(-LEARN_FROM_PASSES));
  }
  return new Map([...passes].map(([unit, times]) => [unit, Math.max(...times)]));
}
