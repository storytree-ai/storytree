// Capability 3 · The pool's dispatcher and watcher as services (ADR-1216 D3, ADR-1180).
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { argsOf, DISPATCHER } from "./launch.mjs";
import { poolConfig } from "./pool-config.mjs";
import { MARKS } from "./watch.mjs";

export const LEAVE = "SIGUSR2";

export function outsideHost([command, args], { env = process.env, platform = process.platform } = {}) {
  if (platform === "linux" && env.INVOCATION_ID) return ["systemd-run", ["--user", "--scope", "--quiet", "--collect", command, ...args]];
  return [command, args];
}

export function stoppedOn75(status) {
  const lines = status.split("\n");
  return lines.slice(lines.findLastIndex((line) => line.endsWith(" dispatcher started")) + 1).find((line) => / pool stopped: /.test(line));
}

export function laneEnv(env, { home = homedir(), nodeBin = dirname(process.execPath), uid = process.getuid?.(), exists = existsSync } = {}) {
  const path = [nodeBin, join(home, ".local", "bin"), ...(env.PATH || "/usr/local/bin:/usr/bin:/bin").split(delimiter)];
  const out = { ...env, HOME: env.HOME || home, PATH: [...new Set(path.filter(Boolean))].join(delimiter) };
  const runtime = `/run/user/${uid}`;
  if (!out.XDG_RUNTIME_DIR && uid !== undefined && exists(runtime)) out.XDG_RUNTIME_DIR = runtime;
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete out[name];
  return out;
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

const pause = (ms, signal) => wait(ms, undefined, { signal }).catch(() => {});

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

async function livePid(pidFile, marks) {
  const pid = Number((await readFile(pidFile, "utf8").catch(() => "")).trim());
  if (!pid || !alive(pid)) return undefined;
  const args = await argsOf(pid);
  return marks.some((mark) => mark.test(args)) ? pid : undefined;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TSX = import.meta.resolve("tsx");

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
      const since = (await readFile(status, "utf8").catch(() => "")).length;
      const stopFile = join(lanesDir, "pool-stop");
      return keepRunning({
        name: kind, stopping: host.stopping, log: host.log, ...(box.pollMs ? { pollMs: box.pollMs, againMs: box.pollMs } : {}),
        running: () => livePid(pidFile, marks),
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

export const dispatcher = poolService("dispatcher");

export const watcher = poolService("watcher");
