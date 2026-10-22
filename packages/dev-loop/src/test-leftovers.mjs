// Capability 6 · Running the tests: what a test run leaves in Temp (increment_e72347bdd355). A test that
// starts a Postgres starts it through pg_ctl, which detaches the server from the test's process tree, so
// killing a unit never reached it: a server started under Temp on 2026-10-11 was still running twelve
// days later, from a worktree that no longer existed. A unit's end stops every server on a data folder
// in its temp folder (unit-run.mjs), and a run's start sweeps what a run that died left behind.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A unit's temp folder carries the pid of the run that made it, so a later run can tell a gone run's. */
export const unitTempPrefix = (pid = process.pid) => `st-unit-${pid}-`;
export const SWEEP_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const UNIT_TEMP = /^st-unit-(\d+)-/;
// Folders made by mkdtemp with storytree's prefixes: a prefix, then six random characters.
const SCRATCH = /^(?:storytree|st-unit)-(?:.*-)?[A-Za-z0-9]{6}$/;
const DEPTH = 4; // how deep under a scratch folder a data folder is looked for

/** The Postgres servers running on data folders under `folder`, as { dataDir, pid }. */
export function serversUnder(folder, depth = DEPTH) {
  const found = [];
  const walk = (dir, left) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === "PG_VERSION")) {
      const pid = postmasterPid(dir);
      if (pid !== undefined && isPostgres(pid)) found.push({ dataDir: dir, pid });
      return;
    }
    if (left === 0) return;
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(dir, entry.name), left - 1);
  };
  walk(folder, depth);
  return found;
}

/**
 * Stop every server running under `folder` but those `keep` names, and wait for each to go. Stopped
 * at once, with no checkpoint: its data is thrown away. Synchronous, so a harness exiting can call it.
 */
export function stopServersUnder(folder, { keep = () => false, log = () => {} } = {}) {
  const stopped = [];
  for (const server of serversUnder(folder)) {
    if (keep(server)) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
      else process.kill(server.pid, "SIGQUIT"); // Postgres's immediate shutdown: it ends its own backends
    } catch (error) {
      if (isAlive(server.pid)) log(`could not stop the Postgres (pid ${server.pid}) on ${server.dataDir}: ${error.message}`);
    }
    for (const until = Date.now() + 10_000; isAlive(server.pid) && Date.now() < until; ) sleep(50);
    stopped.push(server);
  }
  return stopped;
}

/**
 * At a run's start, in the system temp folder: a unit temp folder whose run has gone is removed, its
 * servers stopped first; a server under another storytree scratch folder whose owner record names no
 * live process is stopped; and a scratch folder older than SWEEP_AGE_MS that no live server uses is
 * removed. A live run's unit folders are left alone, servers and all.
 */
export function sweepLeftovers({ tmp = tmpdir(), now = Date.now(), log = () => {} } = {}) {
  const swept = { stopped: [], removed: [] };
  let entries;
  try {
    entries = readdirSync(tmp, { withFileTypes: true });
  } catch {
    return swept;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !SCRATCH.test(entry.name)) continue;
    const at = path.join(tmp, entry.name);
    const run = UNIT_TEMP.exec(entry.name);
    if (run !== null && isAlive(Number(run[1]))) continue;
    const goneRun = run !== null;
    swept.stopped.push(...stopServersUnder(at, { keep: (server) => !goneRun && ownerAlive(server.dataDir), log }));
    if (!goneRun && (serversUnder(at).length > 0 || now - modified(at) < SWEEP_AGE_MS)) continue;
    try {
      rmSync(at, { recursive: true, force: true, maxRetries: 5 });
      swept.removed.push(at);
    } catch (error) {
      log(`could not remove ${at}: ${error.message}`);
    }
  }
  if (swept.stopped.length > 0) log(`stopped ${swept.stopped.length} Postgres server(s) a gone run left running in ${tmp}`);
  if (swept.removed.length > 0) log(`removed ${swept.removed.length} scratch folder(s) a gone or old run left in ${tmp}`);
  return swept;
}

/** The pid in a data folder's postmaster.pid, which Postgres writes on start and removes on a clean stop. */
function postmasterPid(dataDir) {
  try {
    const pid = Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the process that started the server on `dataDir` lives, by the owner record local-postgres keeps beside it. */
function ownerAlive(dataDir) {
  const owner = `${dataDir}.owner.json`;
  if (!existsSync(owner)) return false;
  try {
    return isAlive(JSON.parse(readFileSync(owner, "utf8")).pid);
  } catch {
    return false;
  }
}

/**
 * Whether `pid` is a Postgres process. A postmaster.pid outlives a crash or a reboot, and its pid may
 * since have been given to some other program, which must never be killed for it.
 */
function isPostgres(pid) {
  if (!isAlive(pid)) return false;
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/comm`, "utf8").includes("postgres");
    if (process.platform === "win32") {
      return /postgres/i.test(execFileSync("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    }
    return /postgres/.test(execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return false;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // alive, but not ours to signal
  }
}

function modified(at) {
  try {
    return statSync(at).mtimeMs;
  } catch {
    return 0;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
