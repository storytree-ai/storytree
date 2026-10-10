// Capability 6 · Running the tests. The machine's heavy-run lock (increment_d8c91507b3a1, increment_8610446d96b6): `pnpm test` and
// `pnpm gate` take it themselves around their heavy part, so concurrent sessions on one machine
// queue instead of saturating it. It is a file, heavy-run.lock in STORYTREE_HOME (default
// ~/.storytree/0.3), created exclusively, so it works on every platform without flock. It names its
// holder (branch, pid, checkout, since); a waiter prints who it waits for, takes the lock over when
// the holder's process has gone, and gives up after a bounded wait. A run started under a holder
// (the gate's own test step) inherits it through STORYTREE_HEAVY_LOCK_HOLDER and takes nothing.
// Waiters queue in arrival order (increment_b280164800d5): each leaves a ticket in heavy-run.queue,
// named by when it arrived, and only the oldest live ticket may take a free lock, so a later run
// cannot pass an older one. A ticket goes when its waiter takes the lock, gives up or is cancelled;
// one whose process has gone, or that its waiter stopped refreshing (its pid reused), is cleared
// by whoever reads it.
// Browser evidence uses the same lock at the command boundary, from the checkout root:
// node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx <capture.mjs> [args...]
// From a capture's directory, use the absolute path to this wrapper; it preserves cwd.
// This serializes participating commands only: it does not establish machine isolation for timing.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { constants, homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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

const STALE_TICKET_MS = 30_000;

// The queue's live tickets, oldest first, clearing those whose waiter has gone.
function liveTickets(queue, log) {
  let names;
  try {
    names = readdirSync(queue).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const live = [];
  for (const name of names) {
    const ticket = readHolder(path.join(queue, name));
    if (ticket === undefined) continue;
    let refreshed = Date.now();
    try {
      refreshed = statSync(path.join(queue, name)).mtimeMs;
    } catch {}
    const stale = Date.now() - refreshed > Math.max(STALE_TICKET_MS, 20 * (ticket.pollMs ?? 0));
    if (!stale && alive(ticket)) {
      live.push({ ...ticket, name });
      continue;
    }
    log(`heavy-run lock: ${describe(ticket)}, waiting ahead, is gone; clearing its place in the queue`);
    try {
      unlinkSync(path.join(queue, name));
    } catch {}
  }
  return live;
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
  const queued = { ...me, pollMs };
  const queue = path.join(path.dirname(file), "heavy-run.queue");
  mkdirSync(queue, { recursive: true });
  // Named by arrival time, then id, so sorting the names is the queue's order. Written whole, then
  // renamed into place, so no reader sees half a ticket.
  const ticket = path.join(queue, `${String(Date.now()).padStart(15, "0")}-${me.id}.json`);
  writeFileSync(`${ticket}.tmp`, JSON.stringify(queued));
  renameSync(`${ticket}.tmp`, ticket);
  const leave = () => {
    try {
      unlinkSync(ticket);
    } catch {}
  };
  const deadline = Date.now() + waitMs;
  let waitingFor;
  try {
    for (;;) {
      try {
        utimesSync(ticket, new Date(), new Date()); // still waiting
      } catch {}
      const ahead = liveTickets(queue, log).filter((other) => other.name < path.basename(ticket));
      if (ahead.length === 0) {
        try {
          writeFileSync(file, JSON.stringify(me), { flag: "wx" });
          break;
        } catch (error) {
          // On Windows a just-released lock another process still has open lingers, pending
          // deletion, and creating it is refused with EPERM: it is not free yet, so wait.
          if (error.code !== "EEXIST" && !(process.platform === "win32" && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
        }
      }
      const holder = readHolder(file);
      if (holder !== undefined && !alive(holder)) {
        log(`heavy-run lock: ${describe(holder)} is gone; taking the lock over`);
        if (readHolder(file)?.id === holder.id) {
          try {
            unlinkSync(file);
          } catch {}
        }
        continue;
      }
      const blocker = holder ?? ahead[0];
      if (blocker === undefined) continue;
      if (blocker.id !== waitingFor) {
        waitingFor = blocker.id;
        const behind = ahead.length ? `, ${ahead.length} run${ahead.length === 1 ? "" : "s"} queued ahead` : "";
        log(`heavy-run lock: waiting for ${describe(blocker)} to finish${behind} (${file})`);
      }
      if (stopped()) throw new Error("interrupted while waiting for the heavy-run lock");
      if (Date.now() >= deadline) throw new Error(`gave up after ${Math.round(waitMs / 60000)} min waiting for the heavy-run lock held by ${describe(blocker)}; if it is not running, delete ${file}`);
      await delay(pollMs);
    }
  } finally {
    leave();
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

/** Run a foreground command under the same hold as gate/test, passing arguments without a shell. */
export async function runHeavyCommand(command, args, { root = process.cwd(), signal, forceSignal, log = console.log } = {}) {
  const release = await acquireHeavyLock({ root, what: command, log, stopped: () => signal?.aborted });
  try {
    if (signal?.aborted) return 130;
    return await new Promise((resolve, reject) => {
      const windows = process.platform === "win32";
      const child = spawn(command, args, { cwd: root, stdio: "inherit", detached: !windows });
      const terminate = (sent) => {
        if (!child.pid) return;
        try {
          if (windows) execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
          else process.kill(-child.pid, sent);
        } catch (error) {
          if (error.code !== "ESRCH" && child.exitCode === null) child.kill(sent);
        }
      };
      const stop = () => terminate("SIGINT");
      const force = () => terminate("SIGKILL");
      signal?.addEventListener("abort", stop, { once: true });
      forceSignal?.addEventListener("abort", force, { once: true });
      child.once("error", reject);
      child.once("close", (code, endedBy) => {
        if (signal?.aborted && !windows) force();
        signal?.removeEventListener("abort", stop);
        forceSignal?.removeEventListener("abort", force);
        resolve(signal?.aborted ? 130 : code ?? (128 + (constants.signals[endedBy] ?? 1)));
      });
    });
  } finally {
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (!args.length || args[0] === "--help") {
    console.log("node packages/dev-loop/src/heavy-lock.mjs -- <executable> [args...]\nRuns a command in the current directory under the machine's gate/test lock.\nArguments pass literally, without a shell; use an executable such as node.\nCtrl-C cancels; a second interruption forces the command tree to stop.");
    process.exitCode = args.length ? 0 : 1;
  } else {
    const controller = new AbortController();
    const force = new AbortController();
    const stop = () => controller.signal.aborted ? force.abort() : controller.abort();
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
    for (const signal of signals) process.on(signal, stop);
    try {
      process.exitCode = await runHeavyCommand(args[0], args.slice(1), { signal: controller.signal, forceSignal: force.signal });
    } catch (error) {
      console.error(`heavy-run command: ${error.message}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      for (const signal of signals) process.removeListener(signal, stop);
    }
  }
}
