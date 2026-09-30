// The machine's heavy-run lock (increment_d8c91507b3a1, increment_8610446d96b6): `pnpm test` and
// `pnpm gate` take it themselves around their heavy part, so concurrent sessions on one machine
// queue instead of saturating it. It is a file, heavy-run.lock in STORYTREE_HOME (default
// ~/.storytree/0.3), created exclusively, so it works on every platform without flock. It names its
// holder (branch, pid, checkout, since); a waiter prints who it waits for, takes the lock over when
// the holder's process has gone, and gives up after a bounded wait. A run started under a holder
// (the gate's own test step) inherits it through STORYTREE_HEAVY_LOCK_HOLDER and takes nothing.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const HOLDER_ENV = "STORYTREE_HEAVY_LOCK_HOLDER";
export const WAIT_LIMIT_MS = 60 * 60 * 1000;

const lockFile = () => path.join(process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3"), "heavy-run.lock");

function readHolder(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    // Half-written: its writer is finishing, unless it has stayed unreadable for seconds.
    let old = false;
    try {
      old = Date.now() - statSync(file).mtimeMs > 5000;
    } catch {}
    return { id: "unreadable", pid: undefined, gone: old };
  }
}

function alive({ pid, gone }) {
  if (gone) return false;
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function branchOf(root) {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "detached HEAD";
  } catch {
    return "no branch";
  }
}

const describe = (holder) => `${holder.branch ?? "an unknown run"} (pid ${holder.pid}${holder.root ? `, ${holder.root}` : ""}, since ${holder.since})`;

/**
 * Take the machine's heavy-run lock, waiting behind its holder at most `waitMs`. Resolves to a
 * release function; rejects when the wait runs out. Inside a holder's own run, takes nothing.
 */
export async function acquireHeavyLock({ root, what, log = console.log, waitMs = WAIT_LIMIT_MS, pollMs = 500, stopped = () => false } = {}) {
  const file = lockFile();
  const inherited = process.env[HOLDER_ENV];
  if (inherited && readHolder(file)?.id === inherited) return () => {};
  const me = { id: randomUUID(), pid: process.pid, branch: branchOf(root), root, what, since: new Date().toISOString() };
  mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  let waitingFor;
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify(me), { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const holder = readHolder(file);
    if (holder === undefined) continue;
    if (!alive(holder)) {
      log(`heavy-run lock: ${describe(holder)} is gone; taking the lock over`);
      if (readHolder(file)?.id === holder.id) {
        try {
          unlinkSync(file);
        } catch {}
      }
      continue;
    }
    if (holder.id !== waitingFor) {
      waitingFor = holder.id;
      log(`heavy-run lock: waiting for ${describe(holder)} to finish (${file})`);
    }
    if (stopped()) throw new Error("interrupted while waiting for the heavy-run lock");
    if (Date.now() >= deadline) throw new Error(`gave up after ${Math.round(waitMs / 60000)} min waiting for the heavy-run lock held by ${describe(holder)}; if it is not running, delete ${file}`);
    await delay(pollMs);
  }
  process.env[HOLDER_ENV] = me.id; // children (the gate's test step) run under this hold
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    if (process.env[HOLDER_ENV] === me.id) delete process.env[HOLDER_ENV];
    try {
      if (readHolder(file)?.id === me.id) unlinkSync(file);
    } catch {}
  };
  process.on("exit", release);
  return release;
}
