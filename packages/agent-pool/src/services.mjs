// Capability 3 · The pool's dispatcher and watcher as services (ADR-1216 D3, ADR-1180): the agent runner's manifest
// declares two services, `dispatcher` and `watcher`, both run always, which the service host on a machine runs while
// its settings turn them on (`storytree settings set service agent-pool/dispatcher on`), in place of the crontab's
// keep.mjs and launch-pool.sh. Each service keeps its process running as the keeper did: it adopts one already running
// (its pid file names a live one), starts it otherwise, and starts it again a minute after it ends. The dispatcher is
// left stopped while pool-stop is there, and after a run of this service's ended on exit 75 (an engine failing at once),
// until the service is started again (`storytree services restart agent-pool/dispatcher`). Under systemd each process
// is started in a scope of its own, outside the host's unit, so the host's restart (its code moved, ADR-1180 D3) kills
// none of the lanes. Stopping the dispatcher's service ends the dispatcher alone, with a signal it has no handler for,
// so its lanes, each in its own process group, run on and finish; stopping the watcher's ends its keeper and look loop,
// and a fix session it started runs on.
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { laneEnv, stoppedOn75 } from "./keep.mjs";
import { argsOf, DISPATCHER } from "./launch.mjs";
import { poolConfig } from "./pool-config.mjs";
import { MARKS } from "./watch.mjs";

/** The signal that ends the dispatcher without its lanes: the lane runner forwards SIGTERM and SIGINT to its engine, and handles no other. */
export const LEAVE = "SIGUSR2";

/** The command that starts `command` outside the service host's own unit: a systemd scope of its own when the host runs under systemd on Linux. */
export function outsideHost([command, args], { env = process.env, platform = process.platform } = {}) {
  if (platform === "linux" && env.INVOCATION_ID) return ["systemd-run", ["--user", "--scope", "--quiet", "--collect", command, ...args]];
  return [command, args];
}

/** Whether process `pid` is alive. */
export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

/** Wait `ms`, or until `signal` aborts. */
const pause = (ms, signal) => wait(ms, undefined, { signal }).catch(() => {});

/**
 * Keep the `name` process running until `stopping` aborts: adopt the one `running` names, else start one (unless `held`
 * says why not, looked at again every `pollMs`), and start it again `againMs` after it ends; on the stop, `leave` it.
 */
export async function keepRunning({ name, running, start, held = async () => undefined, isAlive = alive, leave, stopping, log, pollMs = 5_000, againMs = 60_000, sleep = pause }) {
  let heldFor;
  while (!stopping.aborted) {
    let pid = await running();
    if (pid === undefined) {
      const why = await held();
      if (why) {
        if (why !== heldFor) log(`the ${name} is left stopped: ${why}`);
        heldFor = why;
        await sleep(pollMs, stopping);
        continue;
      }
      heldFor = undefined;
      pid = await start();
      log(`started the ${name} (pid ${pid})`);
    } else log(`the ${name} is already running (pid ${pid}): keeping it`);
    while (!stopping.aborted && isAlive(pid)) await sleep(pollMs, stopping);
    if (stopping.aborted) {
      if (isAlive(pid)) { await leave(pid); log(`stopped the ${name} (pid ${pid})`); }
      return;
    }
    log(`the ${name} (pid ${pid}) ended: starting it again in ${Math.round(againMs / 1000)} s`);
    await sleep(againMs, stopping);
  }
}

/** The live process `pidFile` names, when its command line is one `marks` matches; a reused pid is not it. */
async function livePid(pidFile, marks, readArgs) {
  const pid = Number((await readFile(pidFile, "utf8").catch(() => "")).trim());
  if (!pid || !alive(pid)) return undefined;
  const args = await readArgs(pid);
  return marks.some((mark) => mark.test(args)) ? pid : undefined;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TSX = import.meta.resolve("tsx");

/**
 * The service keeping the dispatcher (`launch.mjs pool`) or the watcher (`watch.mjs run`) running, from this machine's
 * pool configuration; `box` overrides its folders, command and timings in tests.
 */
export function poolService(kind, box = {}) {
  return {
    async start(host) {
      const config = box.lanesDir ? box : poolConfig();
      const { lanesDir, checkout } = config;
      const status = join(lanesDir, "pool.status");
      const dispatcher = kind === "dispatcher";
      const command = box.command ?? (dispatcher ? [process.execPath, ["--import", TSX, join(HERE, "launch.mjs"), "pool"]] : [process.execPath, [join(HERE, "watch.mjs"), "run"]]);
      const pidFile = dispatcher ? join(lanesDir, "pool.pid") : join(lanesDir, "watch", "watch.pid");
      const marks = dispatcher ? [DISPATCHER] : MARKS;
      // Only an exit 75 after this service's start holds the dispatcher: starting the service again is how it is let go.
      const since = (await readFile(status, "utf8").catch(() => "")).length;
      const stopFile = join(lanesDir, "pool-stop");
      return keepRunning({
        name: kind, stopping: host.stopping, log: host.log, ...(box.pollMs ? { pollMs: box.pollMs, againMs: box.pollMs } : {}),
        running: () => livePid(pidFile, marks, box.argsOf ?? argsOf),
        held: async () => {
          if (!dispatcher) return undefined;
          if (existsSync(stopFile)) return "pool-stop is there";
          const failed = stoppedOn75((await readFile(status, "utf8").catch(() => "")).slice(since));
          return failed && `its last run ended on exit 75 (${failed.replace(/^\S+ /, "")}); start it again with: storytree services restart agent-pool/dispatcher`;
        },
        start: async () => {
          const out = openSync(join(lanesDir, dispatcher ? "pool.runner.log" : "watch.runner.log"), "a");
          const [file, args] = outsideHost(command);
          const child = spawn(file, args, { cwd: checkout, env: laneEnv(process.env), detached: true, stdio: ["ignore", out, out] });
          child.unref();
          return child.pid;
        },
        leave: async (pid) => {
          if (dispatcher) {
            process.kill(pid, process.platform === "win32" ? undefined : LEAVE);
            await appendFile(status, `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} dispatcher ${pid} stopped by its service; its running lanes run on\n`);
          } else process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
        },
      });
    },
  };
}

/** The agent runner's dispatcher, as a service. */
export const dispatcher = poolService("dispatcher");

/** The agent runner's watcher, as a service. */
export const watcher = poolService("watcher");
