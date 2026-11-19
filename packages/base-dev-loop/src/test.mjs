// Capability 4 · Running the tests

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DataDirInUseError, start } from "@storytree/local-postgres";

import { resultsTable } from "./gate.mjs";
import { floorRefusal, runtimeRefusal } from "./node-runtime.mjs";
import { recordReds } from "./red-runs.mjs";
import { keepPreviousServerLog } from "./server-log.mjs";
import { namedFolders, parseTestArgs, planRun, readWorkspace, RERUN_HINT, scopeFor, scopeLine, TEST_USAGE, unitGlobs } from "./test-scope.mjs";
import { stopServersUnder, sweepLeftovers } from "./test-leftovers.mjs";
import { runPool, shardPlan, shardUnits, slowestFirst, takeShard, testJobs } from "./unit-pool.mjs";
import { runWhat, takeWorktreeRun } from "./worktree-run.mjs";
import { appendWholeRun, GATE_RUN_ENV, startClock, wholeRunRow } from "./whole-runs.mjs";
import { clearUnitLimit, DEADLINE_GRACE_MS, defaultUnitLimit, killTree, recentPassTimes, recordTimings, runDeadline, runUnit, setUnitLimit, TEST_LIMIT_MS, unitLimit, unitReason, unitTestLimit, withinDeadline, withMacRetry } from "./unit-run.mjs";

let root;
let work, dataDir, serverLog, toolLog, recordFile, shardPlanFile;
let alone;
let alwaysRun;

let shard;
let flags;
let testArgs;
let namedFiles;
let hold;
let now;
let deadline;
const children = new Set();
let jobs = 1;
let interrupted = false;
let server;
let phase = "deciding the scope";
let plannedShards;
let decided;
let clock;

const holdNothing = async () => () => {};

export function testCommand({ argv: given = process.argv.slice(2), hold: takeHold = holdNothing, root: tested = fileURLToPath(new URL("../../..", import.meta.url)), alone: runAlone = [], alwaysRun: carried = [], now: clockNow = Date.now } = {}) {
  hold = takeHold;
  now = clockNow;
  root = tested;
  work = path.join(root, ".pgtest");
  dataDir = path.join(work, "data");
  serverLog = path.join(work, "pg.log");
  toolLog = path.join(work, "tools.log");
  recordFile = path.join(work, "last-run.json");
  shardPlanFile = path.join(work, "shard-plan.txt");
  alone = runAlone;
  alwaysRun = carried;
  const taken = takeShard(given);
  shard = taken.shard;
  const parsed = parseTestArgs(taken.argv);
  ({ flags, testArgs } = parsed);
  const folders = namedFolders({ root, workspace: readWorkspace(root), testArgs });
  testArgs = folders.testArgs;
  flags.only.push(...folders.only);
  const flagRefusal = taken.refusal ?? parsed.refusal ?? folders.refusal;
  if (parsed.help || flagRefusal !== undefined) {
    if (flagRefusal !== undefined) console.error(`test harness: ${flagRefusal}\n`);
    (parsed.help ? console.log : console.error)(TEST_USAGE);
    process.exit(parsed.help ? 0 : 2);
  }
  namedFiles = testArgs.some((arg) => !arg.startsWith("-"));

  deadline = runDeadline(process.env);
  if (deadline !== undefined) {
    setTimeout(() => {
      console.error(`\ntest harness: past the run's deadline (STORYTREE_TEST_DEADLINE, ${new Date(deadline).toISOString()}) while ${phase}; ending the run`);
      for (const child of children) killTree(child);
      if (server !== undefined) stopServersUnder(server.dataDir);
      process.exit(1);
    }, Math.max(0, deadline + DEADLINE_GRACE_MS - Date.now())).unref();
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => {
      interrupted = true;
      for (const child of children) child.kill();
    });
  }

  main().then(
    (code) => {
      phase = "ending, its results printed, though its process did not exit";
      process.exitCode = interrupted ? 130 : code;
    },
    (error) => {
      console.error(`\ntest harness: ${error.message}`);
      printTail(toolLog);
      printTail(serverLog);
      process.exitCode = 1;
    },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) testCommand();

async function main() {
  const refusal = runtimeRefusal() ?? floorRefusal(process.version, root);
  if (refusal !== undefined) {
    console.error(`test harness: ${refusal}`);
    return 1;
  }
  let jobsSource;
  try {
    ({ jobs, source: jobsSource } = testJobs({ flag: flags.jobs }));
  } catch (error) {
    console.error(`test harness: ${error.message}`);
    return 1;
  }
  if (flags.setLimit !== undefined || flags.clearLimit !== undefined) return changeLimit();
  let units;
  if (namedFiles && shard !== undefined) {
    console.error("test harness: --shard splits the scoped units; it cannot split files named on the command line");
    return 1;
  }
  if (namedFiles) {
    console.log("scope: files — the files named on the command line");
  } else {
    const workspace = readWorkspace(root);
    let plan;
    try {
      plan = planRun({ root, workspace, decision: scopeFor(root, workspace), flags, record: readRecord(), alone, alwaysRun });
    } catch (error) {
      console.error(`test harness: ${error.message}`);
      return 1;
    }
    console.log(scopeLine(plan.decision));
    console.log(`units: ${plan.units.join(", ") || "none"}`);
    units = plan.units;
    decided = plan.decision.mode;
    if (shard !== undefined) {
      const passTimes = recentPassTimes();
      plannedShards = shardUnits(units, shard.count, { history: (unit) => passTimes.get(unit) });
      units = plannedShards[shard.index - 1];
      process.stdout.write(`shards, split by this machine's recent pass times:\n${shardPlan(plannedShards)}`);
      console.log(`this run is shard ${shard.index}/${shard.count}: ${units.join(", ") || "none"}`);
      if (!flags.scope) writeShardPlan();
    }
    if (flags.scope) return 0;
    if (units.length === 0) {
      console.log("nothing to run");
      return 0;
    }
    jobs = Math.min(jobs, units.length);
    if (jobs > 1) console.log(`jobs: ${jobs} units at once (${jobsSource}), slowest first; each unit's output prints whole when it ends`);
    else if (jobsSource.startsWith("default:")) console.log(`jobs: 1 unit at a time (${jobsSource}); --jobs=<n> tests more at once`);
  }
  phase = "waiting for the heavy-run lock";
  const release = await hold({ root, what: "pnpm test", stopped: () => interrupted, ...(namedFiles ? { scope: "files" } : {}) });
  clock = startClock(now);
  try {
    let worktreeRun = { release: () => {} };
    if (!process.env.STORYTREE_TEST_PG_URL) {
      phase = "waiting for this worktree's other pnpm test";
      worktreeRun = await takeWorktreeRun(work, {
        what: runWhat({ root, files: namedFiles ? testArgs.filter((arg) => !arg.startsWith("-")) : [], units }),
        log: (line) => console.log(`test harness: ${line}`),
        stopped: () => interrupted,
      });
      if (worktreeRun.stopped) return 130;
    }
    try {
      return await runHeavy(units);
    } finally {
      worktreeRun.release();
    }
  } finally {
    release();
  }
}

async function runHeavy(units) {
  if (interrupted) return 130;
  phase = "sweeping what earlier runs left in the temp folder";
  sweepLeftovers({ log: (message) => console.log(`test harness: ${message}`) });
  if (process.env.STORYTREE_TEST_PG_URL) {
    console.log("test Postgres: STORYTREE_TEST_PG_URL is set; using that server");
    const env = process.env;
    return runTests({ ...env, STORYTREE_TEST_PG_ADMIN_URL: env.STORYTREE_TEST_PG_ADMIN_URL || env.STORYTREE_TEST_PG_URL }, units);
  }
  const kept = keepPreviousServerLog(serverLog);
  if (kept !== undefined) console.log(`test Postgres: the previous run's server log is kept in ${path.relative(root, kept)}`);
  phase = "starting the test Postgres";
  try {
    server = await start({
      dataDir,
      serverLog,
      toolLog,
      owner: "a `pnpm test` run",
      signIn: "client",
      superuserUrl: true,
      settings: { fsync: "off", synchronous_commit: "off", full_page_writes: "off", max_connections: "300" },
      log: (message) => console.log(`test Postgres: ${message}`),
    });
  } catch (error) {
    if (error instanceof DataDirInUseError) {
      throw new Error(`another test run (pid ${error.pid}) is using the test Postgres in ${dataDir}; wait for it to finish`);
    }
    throw error;
  }
  try {
    if (interrupted) return 130;
    return await runTests({ ...process.env, STORYTREE_TEST_PG_URL: patient(server.url), STORYTREE_TEST_PG_ADMIN_URL: patient(server.superuserUrl), STORYTREE_TEST_PG_DATA: server.dataDir }, units);
  } finally {
    phase = "stopping the test Postgres";
    await server.stop();
    server = undefined;
  }
}

function patient(url) {
  const named = new URL(url);
  named.searchParams.set("connect_timeout", "30");
  return named.href;
}

async function runTests(env, units) {
  if (units === undefined) {
    const run = await runNodeTest(env, []);
    keepReds([run]);
    if (run.timedOut || run.exitHung.length > 0) console.log(`\ntest harness: the named files ${unitReason(run, root)}`);
    return run.code;
  }
  const results = Object.fromEntries(units.map((unit) => [unit, "not run"]));
  const reasons = {};
  const timings = {};
  const tests = [];
  const unitRuns = [];
  const running = new Set();
  const passTimes = jobs > 1 ? recentPassTimes() : new Map();
  const order = jobs > 1 ? slowestFirst(units, { root, history: (unit) => passTimes.get(unit) }) : units;
  await runPool(order, jobs, async (unit) => {
    if (deadline !== undefined && Date.now() >= deadline) {
      reasons[unit] = "not started: the run's deadline had passed";
      return;
    }
    running.add(unit);
    phase = `running ${[...running].join(", ")}`;
    console.log(jobs > 1 ? `started ${unit}` : `\n=== ${unit} ===`);
    const files = unitGlobs(unit, { root, alone });
    const run = await withMacRetry(() => runNodeTest(env, files, unit), { timeLeft: () => !interrupted && (deadline === undefined || Date.now() < deadline) });
    running.delete(unit);
    if (jobs > 1) process.stdout.write(`\n=== ${unit} ===\n${run.output}`);
    if (interrupted) return;
    results[unit] = run.code === 0 ? "pass" : "fail";
    reasons[unit] = unitReason(run, root);
    timings[unit] = { result: results[unit], ms: run.ms, timedOut: run.timedOut && !run.cut };
    tests.push(...run.tests);
    unitRuns.push(run);
    if (run.timedOut || run.exitHung.length > 0) console.log(`\ntest harness: ${unit} ${reasons[unit]}`);
  }, { stopped: () => interrupted, alone: (unit) => alone.includes(unit) });
  writeRecord(results);
  keepReds(unitRuns);
  try {
    recordTimings(timings, { jobs, tests });
  } catch (error) {
    console.log(`test harness: could not add this run's times to the timing history: ${error.message}`);
  }
  console.log(`\n${resultsTable(results, { reasons, rerunHint: RERUN_HINT })}`);
  if (plannedShards !== undefined) process.stdout.write(`this was shard ${shard.index}/${shard.count}; every shard's units:\n${shardPlan(plannedShards)}`);
  const passed = Object.values(results).every((result) => result === "pass");
  keepWholeRun(units.length, passed);
  return passed ? 0 : 1;
}

const WHOLE_SCOPES = { full: "full", affected: "scoped" };

function keepWholeRun(units, passed) {
  const scope = WHOLE_SCOPES[decided];
  if (scope === undefined || shard !== undefined || interrupted) return;
  const gate = process.env[GATE_RUN_ENV];
  appendWholeRun(wholeRunRow("test", clock, { scope, units, result: passed ? "pass" : "fail", jobs, ...(gate ? { gate } : {}) }), { log: (line) => console.log(`test harness: ${line}`) });
}

function keepReds(runs) {
  try {
    recordReds(root, { tests: runs.flatMap((run) => run.tests ?? []), unloaded: runs.flatMap((run) => run.unloaded ?? []) });
  } catch (error) {
    console.log(`test harness: could not keep this run's failing tests in .pgtest/red-runs.jsonl: ${error.message}`);
  }
}

async function runNodeTest(env, files, unit) {
  const limit = withinDeadline(unit === undefined ? defaultUnitLimit() : unitLimit(unit, { jobs }), deadline);
  const testLimit = unit === undefined ? { ms: TEST_LIMIT_MS, source: "default" } : unitTestLimit(unit);
  let spawned;
  try {
    const evidence = env.STORYTREE_TEST_EVIDENCE ? { directory: path.resolve(root, env.STORYTREE_TEST_EVIDENCE), unit: unit ?? "files" } : undefined;
    const hold = unit !== undefined && jobs > 1;
    const run = await runUnit({ root, env: { ...env, STORYTREE_EMBEDDER: "off" }, args: testArgs, files, evidence, testLimitMs: testLimit.ms, unitLimitMs: limit.ms, hold, onSpawn: (child) => children.add((spawned = child)) });
    return { ...run, limitSource: limit.source, cut: limit.cut === true, testLimitMs: testLimit.ms, testLimitSource: testLimit.source };
  } finally {
    children.delete(spawned);
  }
}

function changeLimit() {
  const [name, seconds] = flags.setLimit !== undefined ? flags.setLimit.split("=") : [flags.clearLimit];
  let unit;
  try {
    [unit] = planRun({ root, workspace: readWorkspace(root), decision: { mode: "full" }, flags: { only: [name] }, alone }).units;
  } catch (error) {
    console.error(`test harness: ${error.message}`);
    return 1;
  }
  if (unit === undefined) {
    console.error(`test harness: ${name} has no tests, so no deadline`);
    return 1;
  }
  try {
    if (flags.clearLimit !== undefined) clearUnitLimit(unit);
    else setUnitLimit(unit, Number(seconds) * 1000, { reason: flags.reason });
  } catch (error) {
    console.error(`test harness: ${error.message}`);
    return 1;
  }
  const { ms, source } = unitLimit(unit, { jobs });
  console.log(`${unit}: deadline ${ms / 1000} s on this machine (${source})`);
  return 0;
}

function writeShardPlan() {
  try {
    mkdirSync(work, { recursive: true });
    writeFileSync(shardPlanFile, shardPlan(plannedShards));
  } catch (error) {
    console.log(`test harness: could not write the shard plan to ${path.relative(root, shardPlanFile)}: ${error.message}`);
  }
}

function readRecord() {
  try {
    return JSON.parse(readFileSync(recordFile, "utf8"));
  } catch {
    return undefined;
  }
}

function writeRecord(results) {
  try {
    mkdirSync(work, { recursive: true });
    const units = { ...readRecord()?.units, ...results };
    writeFileSync(recordFile, `${JSON.stringify({ at: new Date().toISOString(), units }, null, 2)}\n`);
  } catch (error) {
    console.log(`test harness: could not record this run for --rerun-failed: ${error.message}`);
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function printTail(file, lines = 20) {
  const text = readText(file).trimEnd();
  if (!text) return;
  console.error(`\n--- last lines of ${path.relative(root, file)} ---`);
  console.error(text.split(/\r?\n/).slice(-lines).join("\n"));
}
