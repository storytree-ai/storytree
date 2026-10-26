// Capability 3 · The pool switch (3.23), which a cut-over to a new repository drains and resumes the pool with (process_761459dc626c B1, B9):
// node packages/agent-pool/src/pause.mjs pause [--repo <owner/name>] [--wait-minutes <n>] (no new work; waits until no other lane runs and no pull request is in the merge queue, then says what is still open)
// node packages/agent-pool/src/pause.mjs resume                                        (takes work again: the stop file goes, and the dispatcher's loop starts if it has ended)
// node packages/agent-pool/src/pause.mjs status [--repo <owner/name>]
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig } from "./pool-config.mjs";
import { isEngine } from "./queue.mjs";
import { handedOff, HOME } from "./watch.mjs";

const run = promisify(execFile);
const ps = async () => (await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout;
const rowsOf = (table) => table.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
  .map(([, pid, ppid, args]) => ({ pid, ppid, args }));

/**
 * The lanes running beside process `self`: each engine counted once (as countEngines counts), leaving out the one
 * `self` runs under, so a lane can pause the pool it runs in without waiting for itself.
 */
export function lanesBeside(table, self = String(process.pid)) {
  const rows = rowsOf(table), parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const mine = new Set();
  for (let pid = String(self); pid && !mine.has(pid); pid = parent.get(pid)) mine.add(pid);
  const engines = new Set(rows.filter((row) => isEngine(row.args)).map((row) => row.pid));
  return rows.filter((row) => engines.has(row.pid) && !engines.has(row.ppid) && !mine.has(row.pid))
    .map(({ pid, args }) => ({ pid, args: args.slice(0, 120) }));
}

/** Whether the box's dispatcher loop (launch-pool.sh run) is alive in `table`. */
export const loopRunning = (table) => rowsOf(table).some((row) => /launch-pool\.sh run\b/.test(row.args));

/** The pull requests in `repo`'s merge queue for main, as GitHub lists them. */
export async function mergeQueue(repo) {
  const [owner, name] = repo.split("/");
  const { stdout } = await run("gh", ["api", "graphql", "-f", `owner=${owner}`, "-f", `name=${name}`, "-f",
    "query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { mergeQueue(branch: \"main\") { entries(first: 100) { nodes { state pullRequest { number title } } } } } }"]);
  return (JSON.parse(stdout).data.repository.mergeQueue?.entries.nodes ?? []).map((one) => ({ number: one.pullRequest.number, title: one.pullRequest.title, state: one.state }));
}

/** `repo`'s open pull requests. */
export async function openPulls(repo) {
  const { stdout } = await run("gh", ["pr", "list", "-R", repo, "--state", "open", "--limit", "200", "--json", "number,title,isDraft"]);
  return JSON.parse(stdout);
}

/** What is still open, said after a drain or by `status`: open pull requests and the watcher's hand-offs. */
async function sayOpen({ open, handed, say }) {
  const pulls = await open().catch((error) => { say(`open pull requests unread (${String(error.message).split("\n")[0]})`); return undefined; });
  if (pulls) say(pulls.length ? `open pull requests (${pulls.length}):\n${pulls.map((one) => `  #${one.number}${one.isDraft ? " (draft)" : ""} ${one.title}`).join("\n")}` : "no open pull requests");
  const watched = await handed();
  say(watched.length ? `handed to the watcher (${watched.length}):\n${watched.map((one) => `  ${one.note.replace(/ is with the Mint box's watcher/, "")}: ${one.increment}`).join("\n")}` : "nothing handed to the watcher");
}

/**
 * `pause`: write the stop file, so the dispatcher starts nothing more and ends once its lanes have (launch.mjs runPool),
 * then wait, every `pollMs` up to `waitMs`, until no lane runs beside this process and the merge queue is empty. 0 once
 * drained, saying what is still open; 1 when the wait ran out first, saying what still runs (the pool stays paused, and
 * running `pause` again waits again).
 */
export async function pause({ stopFile, lanes, queue, open, handed, waitMs = 180 * 60_000, pollMs = 60_000, sleep = (ms) => wait(ms), now = Date.now, say = console.log }) {
  const was = existsSync(stopFile);
  if (!was) await writeFile(stopFile, `paused ${new Date(now()).toISOString()} by pause.mjs\n`);
  say(was ? `the pool was already paused (${stopFile})` : `paused: the pool takes no new work (${stopFile})`);
  const until = now() + waitMs;
  let last = "";
  for (;;) {
    const running = await lanes();
    const queued = await queue().catch((error) => [{ number: "?", title: `merge queue unread (${String(error.message).split("\n")[0]})` }]);
    if (!running.length && !queued.length) {
      say("drained: no other lane is running and the merge queue is empty");
      await sayOpen({ open, handed, say });
      return 0;
    }
    const line = [running.length ? `${running.length} lane${running.length === 1 ? "" : "s"} running (${running.map((one) => one.pid).join(", ")})` : "",
      queued.length ? `in the merge queue: ${queued.map((one) => `#${one.number}`).join(", ")}` : ""].filter(Boolean).join("; ");
    if (now() >= until) {
      say([`not drained yet: ${line}`, ...running.map((one) => `  ${one.pid} ${one.args}`), ...queued.map((one) => `  #${one.number} ${one.title}`)].join("\n"));
      say("the pool stays paused; run pause again to wait more, or resume to undo it");
      return 1;
    }
    if (line !== last) { say(`waiting: ${line}`); last = line; }
    await sleep(pollMs);
  }
}

/** `resume`: the stop file goes, and the dispatcher's loop is started when it has ended (a loop still draining starts the dispatcher again itself). */
export async function resume({ stopFile, looping, startLoop, say = console.log }) {
  const was = existsSync(stopFile);
  if (was) await rm(stopFile);
  if (await looping()) { say(`${was ? "resumed" : "the pool was not paused"}: the dispatcher's loop is running and takes work again once its current dispatcher ends`); return 0; }
  const pid = await startLoop();
  say(`${was ? "resumed" : "the pool was not paused"}: started the dispatcher's loop (pid ${pid})`);
  return 0;
}

function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const { lanesDir } = poolConfig({ home, env });
  return {
    lanesDir, stopFile: join(lanesDir, "pool-stop"), repo: HOME,
    lanes: async () => lanesBeside(await ps()),
    looping: async () => loopRunning(await ps()),
    startLoop: async () => {
      const out = openSync(join(lanesDir, "pool.runner.log"), "a");
      const child = spawn("setsid", ["nohup", "bash", join(lanesDir, "launch-pool.sh"), "run"], { detached: true, stdio: ["ignore", out, out] });
      child.unref();
      return child.pid;
    },
    handed: () => handedOff(join(lanesDir, "watch")),
  };
}

/** `pause`, `resume` or `status`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults({ home: box.home, env: box.env }), ...box };
  const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const repo = flag("--repo") ?? b.repo, say = b.say ?? console.log;
  const queue = b.queue ?? (() => mergeQueue(repo)), open = b.open ?? (() => openPulls(repo));
  if (args[0] === "pause") {
    const minutes = flag("--wait-minutes");
    return pause({ stopFile: b.stopFile, lanes: b.lanes, queue, open, handed: b.handed, say, sleep: b.sleep, now: b.now,
      ...(minutes === undefined ? {} : { waitMs: Number(minutes) * 60_000 }) });
  }
  if (args[0] === "resume") return resume({ stopFile: b.stopFile, looping: b.looping, startLoop: b.startLoop, say });
  if (args[0] === "status") {
    const running = await b.lanes(), queued = await queue().catch(() => undefined);
    say(`pool: ${existsSync(b.stopFile) ? "paused" : "taking work"}; dispatcher loop ${await b.looping() ? "running" : "not running"}`);
    say(`${running.length} other lane${running.length === 1 ? "" : "s"} running${running.length ? ` (${running.map((one) => one.pid).join(", ")})` : ""}`);
    say(queued === undefined ? "merge queue unread" : queued.length ? `in the merge queue: ${queued.map((one) => `#${one.number}`).join(", ")}` : "merge queue empty");
    await sayOpen({ open, handed: b.handed, say });
    return 0;
  }
  say("usage: pause.mjs pause [--repo <owner/name>] [--wait-minutes <n>] | resume | status [--repo <owner/name>]");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
