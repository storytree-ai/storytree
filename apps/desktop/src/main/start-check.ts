/**
 * Capability 4 · Updates (contract 4.17) and 1 · Lifecycle (1.13): the app that follows merged main
 * never restarts into a build that cannot start, and a start that fails ends the app.
 *
 * After main's new commit is built in the other slot, that build is started with `--start-check`:
 * its main process loads, waits for Electron, registers its handlers and exits 0, without opening the
 * library (which the running app holds) or touching the network. A build whose check does not exit 0
 * in time fails as a failed build does (4.2): the running app stays as it is, and that commit is
 * remembered so it is not built again; the next commit main moves to is built and checked afresh.
 */
import { spawn } from "node:child_process";

import type { Build, RunningBuild, updateToMain } from "@storytree/app";

/** How long a build's main process may take to start and exit its check. */
export const START_CHECK_TIMEOUT_MS = 60_000;
/** Keep the start of an error before its stack, and the last output when a check times out. */
const SAID_CHARS = 600;

/** What Electron's main process prints for a rejection nothing handled: it warns, and still exits 0. */
const UNHANDLED = /UnhandledPromiseRejectionWarning: (?!Unhandled promise rejection\.)([^\r\n]*)/;

/**
 * Start `launch` with `--start-check` and wait for it to exit: undefined when it exited 0 with no
 * promise rejection left unhandled, else why not (its exit code and the start of what it printed, the
 * rejection, or that it did not finish in time). `env` is the environment it starts in (the release's
 * install check gives it a throwaway home); by default this process's own.
 */
export function startsCleanly(launch: { execPath: string; args: readonly string[]; env?: NodeJS.ProcessEnv }, timeoutMs = START_CHECK_TIMEOUT_MS): Promise<string | undefined> {
  // The updater may run with ELECTRON_RUN_AS_NODE set for its own children; the build must start as Electron.
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = launch.env ?? process.env;
  return new Promise((resolve) => {
    let said = "";
    let heard = "";
    let printedChars = 0;
    let rejection: string | undefined;
    const began = performance.now();
    let spawnedAfter: number | undefined;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const child = spawn(launch.execPath, [...launch.args, "--start-check"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.on("spawn", () => { spawnedAfter = Math.round(performance.now() - began); });
    child.on("exit", (code, signal) => { exited = { code, signal }; });
    const hear = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      printedChars += text.length;
      if (said.length < SAID_CHARS) said = (said + text).slice(0, SAID_CHARS);
      // Keep the last line's tail, so a warning split across chunks is still found.
      heard = (heard + text).slice(-2 * SAID_CHARS);
      rejection ??= UNHANDLED.exec(heard)?.[1]?.trim();
    };
    child.stdout.on("data", hear);
    child.stderr.on("data", hear);
    const timer = setTimeout(() => {
      const processState = exited === undefined ? "still running" : `exited with ${exited.code === null ? `signal ${exited.signal}` : `code ${exited.code}`}`;
      const output = printedChars > SAID_CHARS ? `${said}\n…\n${heard.slice(-SAID_CHARS)}` : said;
      const evidence = [
        `process ${child.pid ?? "unknown"}: ${spawnedAfter === undefined ? "spawn not observed" : `spawned after ${spawnedAfter} ms`}, ${processState}`,
        `stdout ${child.stdout.readableEnded ? "ended" : "open"}, stderr ${child.stderr.readableEnded ? "ended" : "open"}`,
        `elapsed ${Math.round(performance.now() - began)} ms`,
      ].join("; ");
      child.kill("SIGKILL");
      // An exited child can leave inherited pipes open in a descendant. The deadline must also
      // release our readers, or the checker itself stays alive after it has refused the build.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(`it did not finish starting within ${timeoutMs / 1000} s (${evidence})${output.trim() === "" ? "; no child output" : `: ${output.trim()}`}`);
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve(error.message); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(rejection === undefined ? undefined : `it left an unhandled promise rejection: ${rejection}`);
      else resolve(`it exited with ${code === null ? `signal ${signal}` : `code ${code}`}${said.trim() === "" ? "" : `: ${said.trim()}`}`);
    });
  });
}

interface CheckOptions {
  /** The real build (follow-main's buildApp). */
  build: Build;
  /** The commit a slot has checked out (follow-main's slotSha). */
  shaOf: (dir: string) => Promise<string>;
  /** Start the slot's build to check it: undefined when it started, else why not. */
  startCheck: (dir: string) => Promise<string | undefined>;
}

/** follow-main's update, with each new build start-checked before the app may restart into it. */
export function checkedUpdate(update: typeof updateToMain, { build, shaOf, startCheck }: CheckOptions): typeof updateToMain {
  const refused = new Map<string, string>();
  const checkedBuild: Build = async (dir) => {
    const sha = await shaOf(dir);
    const known = refused.get(sha);
    if (known !== undefined) throw new Error(known);
    await build(dir);
    const problem = await startCheck(dir);
    if (problem === undefined) return;
    const reason = `main ${sha.slice(0, 7)} was built but cannot start (${problem}); the running app stays as it is`;
    refused.set(sha, reason);
    throw new Error(reason);
  };
  return (options): Promise<RunningBuild | undefined> => update({ ...options, build: checkedBuild });
}

/** Run the app once Electron is ready; a failure in either ends the app through `fail`. */
export function runWhenReady(ready: Promise<unknown>, run: () => Promise<void>, fail: (error: unknown) => void): Promise<void> {
  return ready.then(run).catch(fail);
}

/**
 * End a `--start-check` start: wait a turn first, so a promise rejection the start left unhandled is
 * said (Electron only warns of one, and the check reads that warning), then say it reached its handlers
 * and exit 0.
 */
export async function finishStartCheck(exit: (code: number) => void): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  console.log("start check: the main process reached its handlers");
  exit(0);
}
