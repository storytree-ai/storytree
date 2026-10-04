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
/** How much of what the check printed its refusal keeps. */
const TAIL_CHARS = 600;

/**
 * Start `launch` with `--start-check` and wait for it to exit: undefined when it exited 0, else why
 * not (its exit code and the end of what it printed, or that it did not finish in time).
 */
export function startsCleanly(launch: { execPath: string; args: readonly string[] }, timeoutMs = START_CHECK_TIMEOUT_MS): Promise<string | undefined> {
  // The updater may run with ELECTRON_RUN_AS_NODE set for its own children; the build must start as Electron.
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
  return new Promise((resolve) => {
    let said = "";
    const child = spawn(launch.execPath, [...launch.args, "--start-check"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const hear = (chunk: Buffer): void => { said = (said + chunk.toString("utf8")).slice(-TAIL_CHARS); };
    child.stdout.on("data", hear);
    child.stderr.on("data", hear);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(`it did not finish starting within ${timeoutMs / 1000} s`);
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve(error.message); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve(code === 0 ? undefined : `it exited with ${code === null ? `signal ${signal}` : `code ${code}`}${said.trim() === "" ? "" : `: ${said.trim()}`}`);
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
