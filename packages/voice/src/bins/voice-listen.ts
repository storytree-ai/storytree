/**
 * Capability 5 · Drafted writes with read-back and undo (contract 5.9) and capability 4 · The box service (contract 4.8):
 * the box's listener, run by the owner's user service (box/voice-listen.service). It ticks the committer on every voice_run
 * notification and every run's end mark, until it is stopped.
 */
import { commitDue } from "../commit.js";
import { Drafts } from "../drafts.js";
import { listen, type Listener } from "../listen.js";
import { committerFrom, draftsUrl, isEntry, stdoutLog } from "./voice-commit.js";

/** Listen from `env` until closed; closing also closes the committer's pool. */
export function start(env: NodeJS.ProcessEnv, log: (line: string) => void = stdoutLog, { retryMs }: { retryMs?: number } = {}): Listener {
  const committer = committerFrom(env, log);
  const drafts = Drafts.open(draftsUrl(env));
  const listener = listen({ connectionString: draftsUrl(env), tick: () => commitDue(drafts, committer), runsDir: committer.runsDir, log, retryMs });
  return {
    ready: listener.ready,
    async close() {
      await listener.close();
      await drafts.close();
    },
  };
}

if (isEntry(import.meta.url)) {
  const listener = start(process.env);
  const stop = () => void listener.close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
