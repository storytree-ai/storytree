// Capability 6 · Running the tests. `pnpm test`: run the tests a branch's changes can reach, with node:test (through tsx) against a
// real Postgres. Run it as `pnpm test` (node --import tsx packages/dev-loop/src/test.mjs): it imports
// @storytree/local-postgres, which is TypeScript. CI runs the same command, so it decides the same way.
//
// What runs (ADR-0649 D4, test-scope.mjs): the workspace packages holding a file changed
// since the branch left origin/main, working tree and untracked files included, plus every package
// that depends on them; everything whenever a change is one the workspace graph cannot account for
// (a root file, a package.json, the lockfile, the dev loop, ...) or origin/main cannot be read. The
// first line printed is the decision, `scope: ...`. Each package is one unit, its
// `<dir>/src/**/*.test.{ts,mjs}`; the package-boundary check
// (packages/dev-loop/src/package-boundaries.test.mjs) and the code allocation guardrail
// (packages/dev-loop/src/allocation.test.mjs, ADR-0838 D5) are units of every run. The units run one after another against
// the one Postgres, and a failure never stops the rest: the run ends with a PASS / FAIL / NOT RUN
// table, and exits non-zero if any unit did not pass.
//
//   pnpm run test --scope            print the decision and the units, and run nothing
//   pnpm run test --full             run everything, whatever changed
//   pnpm run test --only=cli,forest  run the named packages (dir, dir name or package name)
//   pnpm run test --rerun-failed     run what the last run in this checkout failed or never reached
//   pnpm run test <files>            run just those files, as one unit under UNIT_LIMIT_MS (or
//                                    STORYTREE_UNIT_LIMIT_MS); killed there, it says so
//   pnpm run test --help             print the usage (TEST_USAGE) and run nothing
//
// An unknown flag is refused, naming the known ones, before the heavy-run lock or a Postgres is taken.
//
// Give flags as `pnpm run test --flag`: `pnpm run` passes what follows the script name to it in
// every shell. Windows PowerShell 5.1 drops a bare `--` before pnpm sees it, so the older
// `pnpm test -- --flag` fails there with "Unknown option"; a literal `--` is still ignored here.
//
// The last result of each unit is kept in .pgtest/last-run.json for --rerun-failed; a run updates
// the units it ran and leaves the others' results as they were.
//
// With STORYTREE_TEST_PG_URL set, the tests use that server and nothing is started or stopped.
// Otherwise this runs a throwaway local server through @storytree/local-postgres, and hands the
// tests its data directory too, as STORYTREE_TEST_PG_DATA (the agent link reads the owner record
// local-postgres keeps beside it, as it reads the desktop app's). The server comes from the
// @embedded-postgres binaries (on Windows arm64, the x64 build under the OS's emulation). Its
// cluster lives in .pgtest/data and is created on first use. The server listens on 127.0.0.1 only,
// on a free port, and is ALWAYS stopped again: after a pass, after a failure, and on Ctrl-C. A run
// is refused while another live run holds .pgtest/data, and a server that an interrupted run left
// running is stopped before this one starts. Like every cluster local-postgres runs, it asks for
// a password, which the url handed to the tests carries.
//
// Files and node's own --test-* options go to `node --test`, in every unit: `pnpm run test <file>`
// runs just that file, with no scope and no record. Give options in --name=value form, so that a
// value is never mistaken for a file.
//
// On Windows, a Node.js whose libuv can end the process on a TCP connect is refused before anything
// starts, with the release to install instead (node-runtime.mjs): under it, a test file now
// and then dies at its first connection to Postgres, which reads as a flaky test.
//
// No unit can hang the run (unit-run.mjs): a test fails at 60 s, a unit's process tree is
// killed at its deadline and its row names the tests still running (or within 20 s, naming the
// file, when a file's tests have all ended but its process does not exit), and the run goes on to the next
// unit. Each unit's time is added to the machine's history (test-timings.jsonl in STORYTREE_HOME,
// default ~/.storytree/0.3), and its deadline is learned from that history: twice its slowest recent
// pass, until it has five the run's default (STORYTREE_UNIT_LIMIT_MS when set, as CI sets it, else
// 3 min), doubled after each kill since it last passed, at most 15 min. Each
// row gives the unit's time, its deadline and where the deadline came from. Any agent may set a
// unit's deadline on this machine, and clear it again:
//
//   pnpm run test --set-limit=cli=300 --reason="two gates at once on this laptop"
//   pnpm run test --clear-limit=cli
//
// A run given a deadline (STORYTREE_TEST_DEADLINE, Unix seconds; CI sets its job's limit less room
// to report, increment_7f43f74526ab) ends before the job limit cancels it, since a cancelled job can
// lose its whole log: the unit running at the deadline is cut there and named like any killed unit,
// the units after it are NOT RUN, and the table prints. Stalled outside any unit for
// DEADLINE_GRACE_MS past it (waiting, starting or stopping Postgres, or not exiting), the run says
// where it stalled and exits 1.
//
// One heavy run at a time on a machine (heavy-lock.mjs): past the scope decision, a run
// takes the machine's heavy-run lock (heavy-run.lock in STORYTREE_HOME) and holds it until its
// Postgres has stopped. While another session's run holds it, this one prints who holds it and
// waits (at most an hour), and it takes over a lock whose holder's process has gone. Under
// `pnpm gate`, the gate holds the lock and its test step runs under that hold. No flock wrapper.
//
// Logs: .pgtest/pg.log (the server, this run), .pgtest/pg.previous.log (the server, the run before,
// so a --rerun-failed keeps the red run's; server-log.mjs) and .pgtest/tools.log (initdb and pg_ctl).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DataDirInUseError, start } from "@storytree/local-postgres";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { runtimeRefusal } from "./node-runtime.mjs";
import { keepPreviousServerLog } from "./server-log.mjs";
import { parseTestArgs, planRun, readWorkspace, resultsTable, scopeFor, scopeLine, TEST_USAGE, unitGlobs } from "./test-scope.mjs";
import { clearUnitLimit, DEADLINE_GRACE_MS, defaultUnitLimit, killTree, recordTimings, runDeadline, runUnit, setUnitLimit, unitLimit, unitReason, withinDeadline } from "./unit-run.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const work = path.join(root, ".pgtest");
const dataDir = path.join(work, "data");
const serverLog = path.join(work, "pg.log");
const toolLog = path.join(work, "tools.log");
const recordFile = path.join(work, "last-run.json");

const { flags, testArgs, help, refusal: flagRefusal } = parseTestArgs(process.argv.slice(2));
if (help || flagRefusal !== undefined) {
  // Before the lock or a Postgres: asking how to run the tests never runs them.
  if (flagRefusal !== undefined) console.error(`test harness: ${flagRefusal}\n`);
  (help ? console.log : console.error)(TEST_USAGE);
  process.exit(help ? 0 : 2);
}
const namedFiles = testArgs.some((arg) => !arg.startsWith("-"));

let child; // the test run, while it runs
let interrupted = false;
let phase = "deciding the scope"; // where a run past its deadline says it stalled

const deadline = runDeadline(process.env);
if (deadline !== undefined) {
  setTimeout(() => {
    console.error(`\ntest harness: past the run's deadline (STORYTREE_TEST_DEADLINE, ${new Date(deadline).toISOString()}) while ${phase}; ending the run`);
    if (child) killTree(child);
    process.exit(1);
  }, Math.max(0, deadline + DEADLINE_GRACE_MS - Date.now())).unref();
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(); // a console Ctrl-C reaches it anyway; this covers a signal sent to us alone
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

async function main() {
  const refusal = runtimeRefusal();
  if (refusal !== undefined) {
    console.error(`test harness: ${refusal}`);
    return 1;
  }
  if (flags.setLimit !== undefined || flags.clearLimit !== undefined) return changeLimit();
  let units;
  if (namedFiles) {
    console.log("scope: files — the files named on the command line");
  } else {
    const workspace = readWorkspace(root);
    let plan;
    try {
      plan = planRun({ root, workspace, decision: scopeFor(root, workspace), flags, record: readRecord() });
    } catch (error) {
      console.error(`test harness: ${error.message}`); // a flag naming no package: nothing ran
      return 1;
    }
    console.log(scopeLine(plan.decision));
    console.log(`units: ${plan.units.join(", ") || "none"}`);
    if (flags.scope) return 0;
    if (plan.units.length === 0) {
      console.log("nothing to run");
      return 0;
    }
    units = plan.units;
  }
  phase = "waiting for the heavy-run lock";
  const release = await acquireHeavyLock({ root, what: "pnpm test", stopped: () => interrupted });
  try {
    return await runHeavy(units);
  } finally {
    release();
  }
}

/** The heavy part, run under the machine's heavy-run lock: the test Postgres and the units. */
async function runHeavy(units) {
  if (interrupted) return 130;
  if (process.env.STORYTREE_TEST_PG_URL) {
    console.log("test Postgres: STORYTREE_TEST_PG_URL is set; using that server");
    return runTests(process.env, units);
  }
  const kept = keepPreviousServerLog(serverLog);
  if (kept !== undefined) console.log(`test Postgres: the previous run's server log is kept in ${path.relative(root, kept)}`);
  let server;
  phase = "starting the test Postgres";
  try {
    server = await start({
      dataDir,
      serverLog,
      toolLog,
      owner: "a `pnpm test` run",
      // Its data is thrown away, so no commit or CREATE DATABASE need wait on a disk flush.
      settings: { fsync: "off", synchronous_commit: "off", full_page_writes: "off" },
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
    return await runTests({ ...process.env, STORYTREE_TEST_PG_URL: server.url, STORYTREE_TEST_PG_DATA: server.dataDir }, units);
  } finally {
    phase = "stopping the test Postgres";
    await server.stop();
  }
}

/** Run the named files, or each unit in turn past any failure, then print and record the table. */
async function runTests(env, units) {
  if (units === undefined) {
    const run = await runNodeTest(env, []);
    if (run.timedOut || run.exitHung.length > 0) console.log(`\ntest harness: the named files ${unitReason(run, root)}`);
    return run.code;
  }
  const results = Object.fromEntries(units.map((unit) => [unit, "not run"]));
  const reasons = {};
  const timings = {};
  for (const unit of units) {
    if (interrupted) break;
    if (deadline !== undefined && Date.now() >= deadline) {
      reasons[unit] = "not started: the run's deadline had passed";
      continue;
    }
    phase = `running ${unit}`;
    console.log(`\n=== ${unit} ===`);
    const run = await runNodeTest(env, unitGlobs(unit), unit);
    if (interrupted) break; // Ctrl-C cut it short: it stays NOT RUN
    results[unit] = run.code === 0 ? "pass" : "fail";
    reasons[unit] = unitReason(run, root);
    timings[unit] = { result: results[unit], ms: run.ms, timedOut: run.timedOut && !run.cut }; // a cut is the run's deadline, not the unit's
    if (run.timedOut || run.exitHung.length > 0) console.log(`\ntest harness: ${unit} ${reasons[unit]}`);
  }
  writeRecord(results);
  try {
    recordTimings(timings);
  } catch (error) {
    console.log(`test harness: could not add this run's times to the timing history: ${error.message}`);
  }
  console.log(`\n${resultsTable(results, { reasons })}`);
  return Object.values(results).every((result) => result === "pass") ? 0 : 1;
}

async function runNodeTest(env, files, unit) {
  const limit = withinDeadline(unit === undefined ? defaultUnitLimit() : unitLimit(unit), deadline);
  try {
    // No test loads the embedding model, so no run, CI included, downloads it (ADR-0733 D6):
    // ranked search is tested with a fake embedder, and everything else ranks by words.
    const evidence = env.STORYTREE_TEST_EVIDENCE ? { directory: path.resolve(root, env.STORYTREE_TEST_EVIDENCE), unit: unit ?? "files" } : undefined;
    const run = await runUnit({ root, env: { ...env, STORYTREE_EMBEDDER: "off" }, args: testArgs, files, evidence, unitLimitMs: limit.ms, onSpawn: (spawned) => (child = spawned) });
    return { ...run, limitSource: limit.source, cut: limit.cut === true };
  } finally {
    child = undefined;
  }
}

/** --set-limit=<unit>=<seconds> --reason=… or --clear-limit=<unit>: change a unit's deadline on this machine. */
function changeLimit() {
  const [name, seconds] = flags.setLimit !== undefined ? flags.setLimit.split("=") : [flags.clearLimit];
  let unit;
  try {
    [unit] = planRun({ root, workspace: readWorkspace(root), decision: { mode: "full" }, flags: { only: [name] } }).units;
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
  const { ms, source } = unitLimit(unit);
  console.log(`${unit}: deadline ${ms / 1000} s on this machine (${source})`);
  return 0;
}

/** The last recorded result of each unit, or undefined if this checkout has none. */
function readRecord() {
  try {
    return JSON.parse(readFileSync(recordFile, "utf8"));
  } catch {
    return undefined;
  }
}

/** Record this run's results over the earlier ones, so a partial run never forgets another unit's failure. */
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
