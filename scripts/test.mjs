// `pnpm test`: run the tests a branch's changes can reach, with node:test (through tsx) against a
// real Postgres. Run it as `pnpm test` (node --import tsx scripts/test.mjs): it imports
// @storytree/local-postgres, which is TypeScript. CI runs the same command, so it decides the same way.
//
// What runs (ADR-0649 D4, scripts/test-scope.mjs): the workspace packages holding a file changed
// since the branch left origin/main, working tree and untracked files included, plus every package
// that depends on them; everything whenever a change is one the workspace graph cannot account for
// (a root file, a package.json, the lockfile, scripts/**, ...) or origin/main cannot be read. The
// first line printed is the decision, `scope: ...`. Each package is one unit, `<dir>/src/**/*.test.ts`,
// and scripts/*.test.mjs is one more when everything runs; the package-boundary check
// (scripts/package-boundaries.test.mjs) is a unit of every run. The units run one after another against
// the one Postgres, and a failure never stops the rest: the run ends with a PASS / FAIL / NOT RUN
// table, and exits non-zero if any unit did not pass.
//
//   pnpm test -- --scope            print the decision and the units, and run nothing
//   pnpm test -- --full             run everything, whatever changed
//   pnpm test -- --only=cli,forest  run the named packages (dir, dir name or package name; `scripts`)
//   pnpm test -- --rerun-failed     run what the last run in this checkout failed or never reached
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
// running is stopped before this one starts.
//
// Other arguments go to `node --test`, in every unit: `pnpm test -- <file>` runs just that file,
// with no scope and no record. Give options in --name=value form, so that a value is never mistaken
// for a file.
//
// On Windows, a Node.js whose libuv can end the process on a TCP connect is refused before anything
// starts, with the release to install instead (scripts/node-runtime.mjs): under it, a test file now
// and then dies at its first connection to Postgres, which reads as a flaky test.
//
// No unit can hang the run (scripts/unit-run.mjs): a test fails at 60 s, a unit's process tree is
// killed at its deadline and its row names the tests still running, and the run goes on to the next
// unit. Each unit's time is added to the machine's history (test-timings.jsonl in STORYTREE_HOME,
// default ~/.storytree/0.3), and its deadline is learned from that history: twice its slowest recent
// pass, 3 min until it has five, doubled after each kill since it last passed, at most 15 min. Each
// row gives the unit's time, its deadline and where the deadline came from. Any agent may set a
// unit's deadline on this machine, and clear it again:
//
//   pnpm test -- --set-limit=cli=300 --reason="two gates at once on this laptop"
//   pnpm test -- --clear-limit=cli
//
// One heavy run at a time on a machine (scripts/heavy-lock.mjs): past the scope decision, a run
// takes the machine's heavy-run lock (heavy-run.lock in STORYTREE_HOME) and holds it until its
// Postgres has stopped. While another session's run holds it, this one prints who holds it and
// waits (at most an hour), and it takes over a lock whose holder's process has gone. Under
// `pnpm gate`, the gate holds the lock and its test step runs under that hold. No flock wrapper.
//
// Logs: .pgtest/pg.log (the server, last run) and .pgtest/tools.log (initdb and pg_ctl).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DataDirInUseError, start } from "@storytree/local-postgres";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { runtimeRefusal } from "./node-runtime.mjs";
import { planRun, readWorkspace, resultsTable, scopeFor, scopeLine, unitGlobs } from "./test-scope.mjs";
import { clearUnitLimit, recordTimings, runUnit, setUnitLimit, UNIT_LIMIT_MS, unitLimit, unitReason } from "./unit-run.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = path.join(root, ".pgtest");
const dataDir = path.join(work, "data");
const serverLog = path.join(work, "pg.log");
const toolLog = path.join(work, "tools.log");
const recordFile = path.join(work, "last-run.json");

const flags = { full: false, scope: false, rerunFailed: false, only: [], setLimit: undefined, clearLimit: undefined, reason: undefined };
const testArgs = [];
for (const arg of process.argv.slice(2)) {
  if (arg === "--") continue;
  else if (arg === "--full") flags.full = true;
  else if (arg === "--scope") flags.scope = true;
  else if (arg === "--rerun-failed") flags.rerunFailed = true;
  else if (arg.startsWith("--only=")) flags.only.push(...arg.slice("--only=".length).split(",").filter(Boolean));
  else if (arg.startsWith("--set-limit=")) flags.setLimit = arg.slice("--set-limit=".length);
  else if (arg.startsWith("--clear-limit=")) flags.clearLimit = arg.slice("--clear-limit=".length);
  else if (arg.startsWith("--reason=")) flags.reason = arg.slice("--reason=".length);
  else testArgs.push(arg);
}
const namedFiles = testArgs.some((arg) => !arg.startsWith("-"));

let child; // the test run, while it runs
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(); // a console Ctrl-C reaches it anyway; this covers a signal sent to us alone
  });
}

main().then(
  (code) => {
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
  try {
    rmSync(serverLog, { force: true }); // the last run's; a live run still writing it keeps it
  } catch {}
  let server;
  try {
    server = await start({
      dataDir,
      serverLog,
      toolLog,
      owner: "a `pnpm test` run",
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
    await server.stop();
  }
}

/** Run the named files, or each unit in turn past any failure, then print and record the table. */
async function runTests(env, units) {
  if (units === undefined) return (await runNodeTest(env, [])).code;
  const results = Object.fromEntries(units.map((unit) => [unit, "not run"]));
  const reasons = {};
  const timings = {};
  for (const unit of units) {
    if (interrupted) break;
    console.log(`\n=== ${unit} ===`);
    const run = await runNodeTest(env, unitGlobs(unit), unit);
    if (interrupted) break; // Ctrl-C cut it short: it stays NOT RUN
    results[unit] = run.code === 0 ? "pass" : "fail";
    reasons[unit] = unitReason(run, root);
    timings[unit] = { result: results[unit], ms: run.ms, timedOut: run.timedOut };
    if (run.timedOut) console.log(`\ntest harness: ${unit} ${reasons[unit]}`);
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
  const limit = unit === undefined ? { ms: UNIT_LIMIT_MS, source: "default" } : unitLimit(unit);
  try {
    // No test loads the embedding model, so no run, CI included, downloads it (ADR-0733 D6):
    // ranked search is tested with a fake embedder, and everything else ranks by words.
    const run = await runUnit({ root, env: { ...env, STORYTREE_EMBEDDER: "off" }, args: testArgs, files, unitLimitMs: limit.ms, onSpawn: (spawned) => (child = spawned) });
    return { ...run, limitSource: limit.source };
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
