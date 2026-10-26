/**
 * Capability 5 · Drafted writes with read-back and undo (contract 5.9) and capability 4 · The box service (contracts 4.8,
 * 4.9): the box's listener, run by the owner's user service (box/voice-listen.service). It ticks the committer on every
 * voice_run notification and every run's end mark, until it is stopped. It loads its code once, so when the checkout it
 * runs from moves to another commit it ticks no more and exits, and the service starts it again on the current code.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commitDue } from "../commit.js";
import { Drafts } from "../drafts.js";
import { listen, type Listener } from "../listen.js";
import { committerFrom, draftsUrl, isEntry, stdoutLog } from "./voice-commit.js";

/** The commit the checkout this code was loaded from is on now, or null when git cannot say. */
export function checkoutHead(dir = path.dirname(fileURLToPath(import.meta.url))): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface StartOptions {
  readonly retryMs?: number;
  /** The checkout's commit now; read once at start, and again before every tick. */
  readonly head?: () => string | null;
  /** What to do once the checkout has moved: by default close and exit, so the service restarts on the current code. */
  readonly moved?: (listener: Listener) => void;
}

const exitToRestart = (listener: Listener) => void listener.close().then(() => process.exit(0));

/** Listen from `env` until closed; closing, once however often it is asked, also closes the committer's pool. */
export function start(env: NodeJS.ProcessEnv, log: (line: string) => void = stdoutLog, options: StartOptions = {}): Listener {
  const { retryMs, head = checkoutHead, moved = exitToRestart } = options;
  const committer = committerFrom(env, log);
  const drafts = Drafts.open(draftsUrl(env));
  const loaded = head();
  const tick = async () => {
    const now = head();
    if (loaded !== null && now !== null && now !== loaded) {
      // Never tick on stale code (draft 4, 2026-10-25, failed on a listener started before the box pulled its fix).
      log(`the checkout moved from ${loaded.slice(0, 8)} to ${now.slice(0, 8)}: exiting to restart on the current code`);
      moved(self);
      return;
    }
    await commitDue(drafts, committer);
  };
  const listener = listen({ connectionString: draftsUrl(env), tick, runsDir: committer.runsDir, log, retryMs });
  let closing: Promise<void> | undefined;
  const self: Listener = {
    ready: listener.ready,
    // Once: the exit on a moved checkout and a stop signal may both close it.
    close: () => (closing ??= listener.close().then(() => drafts.close())),
  };
  return self;
}

if (isEntry(import.meta.url)) {
  const listener = start(process.env);
  const stop = () => void listener.close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
