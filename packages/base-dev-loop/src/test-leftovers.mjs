// Capability 4 · Running the tests
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const unitTempPrefix = (pid = process.pid) => `st-unit-${pid}-`;
export const SWEEP_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const UNIT_TEMP = /^st-unit-(\d+)-/;
const SCRATCH = /^(?:storytree|st-unit)-(?:.*-)?[A-Za-z0-9]{6}$/;
const DEPTH = 4;

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
      if (pid !== undefined && isPostmaster(pid)) found.push({ dataDir: dir, pid });
      return;
    }
    if (left === 0) return;
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(dir, entry.name), left - 1);
  };
  walk(folder, depth);
  return found;
}

export function stopServersUnder(folder, { keep = () => false, log = () => {} } = {}) {
  const stopped = [];
  for (const server of serversUnder(folder)) {
    if (keep(server)) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
      else process.kill(server.pid, "SIGQUIT");
    } catch (error) {
      if (isAlive(server.pid)) log(`could not stop the Postgres (pid ${server.pid}) on ${server.dataDir}: ${error.message}`);
    }
    for (const until = Date.now() + 10_000; isAlive(server.pid) && Date.now() < until; ) sleep(50);
    stopped.push(server);
  }
  return stopped;
}

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
      removeFolder(at);
      swept.removed.push(at);
    } catch (error) {
      log(`could not remove ${at}: ${error.message}`);
    }
  }
  if (swept.stopped.length > 0) log(`stopped ${swept.stopped.length} Postgres server(s) a gone run left running in ${tmp}`);
  if (swept.removed.length > 0) log(`removed ${swept.removed.length} scratch folder(s) a gone or old run left in ${tmp}`);
  return swept;
}

const HELD = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);

export function removeFolder(at, { budgetMs = 10_000, rm = removeAll, now = Date.now, pause = sleep } = {}) {
  for (const until = now() + budgetMs; ; ) {
    try {
      rm(at);
      return;
    } catch (error) {
      if (!HELD.has(error.code) || now() >= until) throw error;
      pause(100);
    }
  }
}

export function removeWhenFree(at, { log = () => {}, retryMs = 1_000, rm = removeAll, ...options } = {}) {
  try {
    removeFolder(at, { ...options, rm });
    return Promise.resolve(true);
  } catch (error) {
    if (!HELD.has(error.code)) {
      log(`could not remove ${at}: ${error.message}`);
      return Promise.resolve(false);
    }
    log(`${at} is still held (${error.message}); removing it once it lets go`);
  }
  return new Promise((resolve) => {
    const retry = () => {
      try {
        rm(at);
        resolve(true);
      } catch (error) {
        if (HELD.has(error.code)) return void setTimeout(retry, retryMs).unref();
        log(`could not remove ${at}: ${error.message}`);
        resolve(false);
      }
    };
    setTimeout(retry, retryMs).unref();
  });
}

function removeAll(target) {
  rmSync(target, { recursive: true, force: true });
}

function postmasterPid(dataDir) {
  try {
    const pid = Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function ownerAlive(dataDir) {
  const owner = `${dataDir}.owner.json`;
  if (!existsSync(owner)) return false;
  try {
    return isAlive(JSON.parse(readFileSync(owner, "utf8")).pid);
  } catch {
    return false;
  }
}

function isPostmaster(pid) {
  if (!isAlive(pid)) return false;
  const read = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    if (process.platform === "win32") {
      if (!/postgres/i.test(read("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"]))) return false;
      const line = read("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]);
      return /postgres/i.test(line) && !/--fork/i.test(line);
    }
    if (process.platform === "linux") {
      const comm = (of) => readFileSync(`/proc/${of}/comm`, "utf8");
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      return comm(pid).includes("postgres") && !(parent > 1 && isAlive(parent) && comm(parent).includes("postgres"));
    }
    const [parent, ...name] = read("ps", ["-p", String(pid), "-o", "ppid=,comm="]).trim().split(/\s+/);
    if (!/postgres/.test(name.join(" "))) return false;
    return !(Number(parent) > 1 && /postgres/.test(read("ps", ["-p", parent, "-o", "comm="])));
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
    return error.code === "EPERM";
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
