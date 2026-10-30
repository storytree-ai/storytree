// Capability 3 · The keeper (3.29, increment_89c736caa64a): the Mint box's dispatcher loop and watcher are started
// again by the user's crontab, once a minute, when they are not running. cron is a system service, so what it starts
// lives in cron.service's cgroup: neither the desktop session ending nor the user manager (user@1000) exiting reaches
// it, as both did on 2026-10-31 at 00:15 and 00:17 AEDT, and it runs again after a reboot without anyone logging in.
// node packages/agent-pool/src/keep.mjs           (one look: start the loop and the watcher if they are down)
// node packages/agent-pool/src/keep.mjs install   (add its crontab line, once; run again, it changes nothing)
// The loop is left stopped while pool-stop is there, or when the dispatcher's last run ended on exit 75 (an engine
// failing at once): pool health and the session manager read that for the owner, and say it once in pool.status.
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig } from "./pool-config.mjs";
import { ensureWatcher } from "./watch.mjs";

const run = promisify(execFile);
/** The crontab line's own mark, so install finds the line it wrote. */
export const MARK = "# storytree: keep the pool dispatcher and watcher running (agent-pool keep.mjs)";
const HELD = "keep: left the dispatcher stopped";

/**
 * Why the dispatcher should stay stopped, read from pool.status after its last start: its run ended on exit 75. A
 * dispatcher ending on 75 says "pool stopped: …"; its loop then says it exited 75, when the loop itself was not killed.
 */
export function stoppedOn75(status) {
  return sinceStart(status).find((line) => / pool stopped: | launch-pool\.sh: dispatcher exited 75$/.test(line));
}

/** pool.status's lines after the dispatcher's last start. */
const sinceStart = (status) => {
  const lines = status.split("\n");
  return lines.slice(lines.findLastIndex((line) => line.endsWith(" dispatcher started")) + 1);
};

/**
 * The environment the keeper starts the loop and the watcher in: cron's is bare (PATH=/usr/bin:/bin, no runtime dir), so
 * the node running the keeper and ~/.local/bin (claude, gh) go first on PATH, and the user's runtime dir is named.
 */
export function laneEnv(env, { home = homedir(), nodeBin = dirname(process.execPath), uid = process.getuid?.(), exists = existsSync } = {}) {
  const path = [nodeBin, join(home, ".local", "bin"), ...(env.PATH || "/usr/local/bin:/usr/bin:/bin").split(delimiter)];
  const out = { ...env, HOME: env.HOME || home, PATH: [...new Set(path.filter(Boolean))].join(delimiter) };
  const runtime = `/run/user/${uid}`;
  if (!out.XDG_RUNTIME_DIR && uid !== undefined && exists(runtime)) out.XDG_RUNTIME_DIR = runtime;
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete out[name];
  return out;
}

/**
 * Whether `lanesDir`'s dispatcher loop is alive in `table` (ps's pid, ppid and args): a shell running its launch-pool.sh,
 * named by that path or bare, as pause.mjs's loopRunning reads it; a loop of another lanes folder on the box is not it.
 */
export function loopOf(table, lanesDir) {
  const own = [join(lanesDir, "launch-pool.sh"), "launch-pool.sh", "./launch-pool.sh"];
  return table.split("\n").some((line) => {
    const script = /^\s*\d+\s+\d+\s+(?:\S*\/)?(?:ba)?sh\s+(\S+)\s+run\b/.exec(line)?.[1];
    return script !== undefined && own.includes(script);
  });
}

/** One look: start the dispatcher's loop unless it runs, is paused or stopped on 75; start the watcher unless it runs. */
export async function keep({ looping, stopFile, status, startLoop, note, watcher, say = console.log }) {
  if (!(await looping()) && !existsSync(stopFile)) {
    const text = await status();
    const held = stoppedOn75(text);
    if (!held) say(`started the dispatcher's loop (pid ${await startLoop()}): it was not running`);
    else if (!sinceStart(text).some((line) => line.includes(HELD))) {
      await note(`${HELD}: its last run ended on exit 75 (${held.replace(/^\S+ /, "")}); pool health and the session manager say so to the owner`);
    }
  }
  if (await watcher()) say("started the watcher: it was not running");
}

/** The crontab `table` with the keeper's `line` in it: an older line of its own replaced, every other line kept. */
export function withKeeper(table, line) {
  const kept = table.split("\n").filter((one) => one.trim() && !one.includes(MARK));
  return `${[...kept, line].join("\n")}\n`;
}

/** The crontab line: once a minute, from the checkout, with the newest node under nvm, its output in keep.log. */
export function cronLine({ checkout, lanesDir }) {
  const node = `"$(ls -d "$HOME"/.nvm/versions/node/*/bin | sort -V | tail -n1)/node"`;
  return `* * * * * cd ${checkout} && [ -f packages/agent-pool/src/keep.mjs ] && ${node} packages/agent-pool/src/keep.mjs >> ${join(lanesDir, "keep.log")} 2>&1 ${MARK}`;
}

const argsOf = async (pid) => (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();

function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const { lanesDir, checkout } = poolConfig({ home, env });
  const free = laneEnv(env, { home });
  const detached = (command, args, log) => {
    const out = openSync(log, "a");
    const child = spawn(command, args, { cwd: checkout, env: free, detached: true, stdio: ["ignore", out, out] });
    child.unref();
    return child.pid;
  };
  const statusFile = join(lanesDir, "pool.status");
  return {
    lanesDir, checkout, stopFile: join(lanesDir, "pool-stop"),
    looping: async () => loopOf((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout, lanesDir),
    status: () => readFile(statusFile, "utf8").catch(() => ""),
    note: (message) => appendFile(statusFile, `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}\n`),
    startLoop: async () => detached("setsid", ["nohup", "bash", join(lanesDir, "launch-pool.sh"), "run"], join(lanesDir, "pool.runner.log")),
    watcher: () => ensureWatcher({ pidFile: join(lanesDir, "watch", "watch.pid"), argsOf,
      spawn: async () => detached(process.execPath, [join(checkout, "packages", "agent-pool", "src", "watch.mjs"), "run"], join(lanesDir, "watch.runner.log")) }),
    crontab: {
      read: async () => (await run("crontab", ["-l"]).catch(() => ({ stdout: "" }))).stdout,
      write: (table) => new Promise((done, failed) => {
        const child = spawn("crontab", ["-"], { stdio: ["pipe", "inherit", "inherit"] });
        child.on("error", failed);
        child.on("close", (code) => (code === 0 ? done() : failed(new Error(`crontab exited ${code}`))));
        child.stdin.end(table);
      }),
    },
  };
}

/** One look, or `install`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults({ home: box.home, env: box.env }), ...box };
  const say = b.say ?? ((line) => console.log(`${new Date().toISOString()} ${line}`));
  if (args[0] === "install") {
    const table = await b.crontab.read();
    const next = withKeeper(table, cronLine(b));
    if (next === table) { say("the keeper's crontab line is already there"); return 0; }
    await b.crontab.write(next);
    say(`added the keeper's crontab line: ${cronLine(b)}`);
    return 0;
  }
  if (args.length) { say("usage: keep.mjs [install]"); return 2; }
  await keep({ ...b, say });
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
