// Capability 12 · The Mint pool's dispatcher (ADR-0955 D2), which the box's launcher execs:
// node --import tsx packages/dev-loop/src/lanes/launch.mjs pool            (one dispatcher over every active arc's ready increments; exits 3 to restart on its own code change)
// node packages/dev-loop/src/lanes/launch.mjs slots                       (engines running now, and the cap)
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { blind, pickPlan, pickPool, readOnly, surveyLibrary } from "./feed.mjs";
import { codeVersion, composeBrief, countEngines, holdRunner, waitForSlot } from "./queue.mjs";
import { runLane as runEngineLane } from "./runner.mjs";
import { handedOff } from "./watch.mjs";

const run = promisify(execFile);
/** The dispatcher's exit when its own code changed on origin/main: the box wrapper starts it again, on the new code. */
export const RESTART = 3;
/** Lanes push over SSH: the https origin's OAuth token lacks the workflow scope (increment_ecdbefcd7fa1). */
export const PUSH_URL = "git@github.com:storytree-ai/storytree.git";
const stamp = (now) => new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Bring the shared checkout to origin/main, point its pushes at SSH and install; every lane's worktree is cut from it. */
export async function prepareCheckout({ repo, exec = (command, args, options) => run(command, args, options) }) {
  await exec("git", ["fetch", "-q", "origin"], { cwd: repo });
  await exec("git", ["merge", "-q", "--ff-only", "origin/main"], { cwd: repo });
  await exec("git", ["config", "remote.origin.pushurl", PUSH_URL], { cwd: repo });
  await exec("pnpm", ["install", "--silent"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
}

/** Hold an flock(1) lock on `path` while `fn` runs, so the box's shell launchers and these runners share it. */
export async function withFlock(path, fn) {
  const holder = spawn("flock", [path, "sh", "-c", "echo locked; read _"], { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise((locked, failed) => {
    holder.stdout.once("data", locked);
    holder.once("error", failed);
    holder.once("exit", (code) => failed(new Error(`flock exited ${code}`)));
  });
  try { return await fn(); }
  finally { holder.stdin.end(); }
}

/**
 * One lane: under the shared checkout lock, wait for a free engine slot and prepare the checkout; then write
 * the brief, and run it through the lane runner, which picks the engine. Status lines go to `say`. With `follow`,
 * the runner checks the lane left a report or a push for its increment, and resumes it once if not.
 */
export async function laneOnce({ increment, brief, log, err, addDirs, repo, maxLanes, lock, count, prepare, sleep, runLane, follow = false, now = Date.now, say }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  await lock(async () => {
    await waitForSlot({ max: maxLanes, count, sleep, onWait: (running) => dated(`waiting for a slot (${running} engines running) before ${increment}`) });
    try { await prepare(); }
    catch (error) { dated(`checkout update failed before ${increment} (${error.message.split("\n")[0]}); the lane runs on the checkout as it is`); }
  });
  await writeFile(brief.path, brief.text);
  dated(`start ${increment}`);
  let code;
  try { code = await runLane({ brief: brief.path, log, err, addDirs, cwd: repo, say, ...(follow ? { increment } : {}) }); }
  catch (error) { dated(`lane runner: ${error.message}; exit 75, which stops the dispatcher`); code = 75; }
  dated(`end ${increment} exit ${code}`);
  return code;
}

/**
 * The dispatcher (ADR-0955 D2, D4): whenever free slots (the cap less the engines running and the sessions it is
 * still starting) are open, it takes that many increments from one survey (feed.mjs's pickPool) and launches each;
 * a launch's `engineUp` says its engine has started, so it counts among the engines from then on. It looks again
 * when a session ends, every `pollMs` while slots are full, every `idleMs` while slots are free and nothing is ready
 * (a newly parked or released increment waits minutes, not a quarter hour), and every `intervalMs` after a failed survey. A claim
 * that refused a session is said once, and its increment waits until that claim clears. With free slots and nothing
 * ready, it launches one planning session (`{ plan: true }`) for the arc feed.mjs's pickPlan offers, never two at
 * once, each arc once. Ends on the stop file, 75 (an engine failing at once), or RESTART once `codeVersion` (the code
 * it runs in the shared checkout, queue.mjs's POOL_CODE) differs from its start, each after its running sessions end; when a survey fails or
 * finds nothing and no session is starting, it first brings the checkout up to date (`refresh`) to see that change.
 */
export async function runPool({ survey, maxLanes, count, launch, stopFile, exists = async (path) => existsSync(path),
  codeVersion = async () => undefined, refresh = async () => {},
  sleep = (ms, options) => wait(ms, undefined, options), intervalMs = 15 * 60_000, idleMs = 2 * 60_000, pollMs = 60_000, now = Date.now, say = console.log }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  const attempts = new Map(), running = new Map(), starting = new Set(), refused = new Map(), planned = new Set();
  let ending, planning, changed, change = new Promise((go) => { changed = go; });
  const wake = () => { changed(); change = new Promise((go) => { changed = go; }); };
  const version = () => Promise.resolve().then(codeVersion).catch(() => undefined);
  const began = await version();
  const codeChanged = async () => {
    const current = began && await version();
    if (!current || current === began) return false;
    ending ??= { code: RESTART, message: `dev loop code changed (${began} → ${current}): restarting` };
    return true;
  };
  const freshen = async () => {
    if (!began || starting.size) return false;
    try { await refresh(); }
    catch (error) { dated(`checkout update failed (${String(error.message).split("\n")[0]})`); }
    return codeChanged();
  };
  const start = (one) => {
    if (one.plan) planning = one.id;
    else attempts.set(one.id, { at: now() });
    starting.add(one.id);
    running.set(one.id, (async () => {
      try {
        const code = await launch(one, { engineUp: () => starting.delete(one.id) });
        if (code === 75) ending ??= { code: 75, message: `pool stopped: engine failing at once on ${one.id}` };
      } catch (error) { ending ??= { error }; }
      finally { if (planning === one.id) planning = undefined; starting.delete(one.id); running.delete(one.id); wake(); }
    })());
  };
  const pause = async (ms) => {
    const look = new AbortController();
    await Promise.race([change, Promise.resolve(sleep(ms, { signal: look.signal })).catch(() => {})]);
    look.abort();
  };
  for (;;) {
    if (!ending) await codeChanged();
    if (ending || await exists(stopFile)) {
      const last = ending ?? { code: 0, message: `stopped by ${stopFile.split(/[\\/]/).pop()}` };
      await Promise.all(running.values());
      if (last.error) throw last.error;
      dated(last.message);
      return last.code;
    }
    const free = await maxLanes() - await count() - starting.size;
    if (free <= 0) { await pause(pollMs); continue; }
    let found;
    try { found = await survey(); }
    catch (error) {
      dated(`library survey failed (${String(error.message).split("\n")[0]}); looking again in ${Math.round(intervalMs / 60_000)} min`);
      if (await freshen()) continue;
      await pause(intervalMs);
      continue;
    }
    const { picks, skipped } = pickPool(found, { attempts, running: [...running.keys()], max: free });
    for (const [id, attempt] of attempts) {
      if (attempt.refusedBy && refused.get(id) !== attempt.refusedBy) { refused.set(id, attempt.refusedBy); dated(`refused ${id}: claimed by live session ${attempt.refusedBy}; retried once that claim clears`); }
    }
    if (!picks.length) {
      const arc = planning ? undefined : pickPlan(found, { planned });
      if (arc) {
        planned.add(arc.id);
        dated(`nothing ready: planning ${arc.id} (${arc.title})`);
        start({ id: arc.id, title: arc.title, plan: true });
        await pause(pollMs);
        continue;
      }
      if (await freshen()) continue;
      dated(`nothing ready for ${free} free slot${free === 1 ? "" : "s"} (${skipped.length} skipped); looking again in ${Math.round(idleMs / 60_000)} min`);
      await pause(idleMs);
      continue;
    }
    for (const one of picks) start(one);
    await pause(pollMs);
  }
}

/** The planning session's brief rules, versioned beside this file: plan the arc's next increments, never build. */
export async function planRules() {
  return readFile(new URL("./pool-brief-plan.md", import.meta.url), "utf8");
}

/** The pool's brief rules, versioned beside this file: the read-only rules for read-only or blind work, else the build rules. */
export async function poolRules(body) {
  const name = readOnly(body) || blind(body) ? "pool-brief-read-only.md" : "pool-brief.md";
  return readFile(new URL(`./${name}`, import.meta.url), "utf8");
}

async function argsOf(pid) {
  return (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();
}

function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const lanesDir = env.LANES_DIR || join(home, "storytree-lanes");
  const repo = join(home, "code", "storytree03");
  return {
    lanesDir, repo, addDirs: [join(home, "code", "storytree03-wt"), lanesDir],
    maxLanes: async () => Number((await readFile(join(lanesDir, "night-max-lanes"), "utf8").catch(() => "")).trim()) || 5,
    count: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout),
    lock: (fn) => withFlock(join(lanesDir, "night-checkout.lock"), fn),
    prepare: () => prepareCheckout({ repo }),
    sleep: (ms, options) => wait(ms, undefined, options), argsOf, runLane: runEngineLane, survey: surveyLibrary, now: Date.now,
  };
}

/** `pool` or `slots`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults(), ...box };
  if (args[0] === "slots") {
    (b.out ?? console.log)(`${await b.count()} engines running, cap ${await b.maxLanes()}`);
    return 0;
  }
  if (args[0] === "pool") return pool(b);
  (b.out ?? console.error)("usage: launch.mjs pool | slots");
  return 2;
}

/** A survey with each increment handed to the watcher held on it, as its event wait would hold it, so the pool and planning leave it alone. */
export function withHandOffs(found, handed) {
  const waitsFor = { ...found.holds.waitsFor };
  for (const { increment, note } of handed) waitsFor[increment] = [...(waitsFor[increment] ?? []), { releaser: "event", note, holds: true }];
  return { ...found, holds: { ...found.holds, waitsFor } };
}

/** `pool`: one dispatcher (pool.pid), its status lines in pool.status, stopped by pool-stop; each session's brief, log and err as pool-<increment>-…. */
async function pool(b) {
  const L = b.lanesDir;
  const say = b.say ?? ((line) => appendFileSync(join(L, "pool.status"), `${line}\n`));
  const dated = (message) => say(`${stamp(b.now)} ${message}`);
  const runner = await holdRunner({ pidFile: join(L, "pool.pid"), pid: b.pid ?? process.pid, marks: [/launch\.mjs pool( |$)/], argsOf: b.argsOf });
  if (!runner.held) { dated(`dispatcher ${runner.by} is running: not starting`); return 1; }
  dated("dispatcher started");
  const code = await runPool({
    survey: async () => withHandOffs(await b.survey(), await handedOff(join(L, "watch"))), maxLanes: b.maxLanes, count: b.count, stopFile: join(L, "pool-stop"), sleep: b.sleep, now: b.now, say,
    codeVersion: b.codeVersion ?? (() => codeVersion({ repo: b.repo })),
    refresh: () => b.lock(b.prepare),
    launch: async (one, { engineUp }) => {
      const at = new Date(b.now()).toISOString().replace(/[-:]|\.\d{3}Z$/g, "");
      const role = !one.plan && blind(one.body) ? " You are a blind reviewer: follow .claude/agents/blind-reviewer.md (ADR-0950)." : "";
      const brief = one.plan
        ? { title: `Planning lane: ${one.id}`, intro: `Your arc: ${one.id} (${one.title}).`, notes: "", common: await planRules() }
        : { title: `Pool lane: ${one.id}`, intro: `Your increment: ${one.id}.${role}`,
          notes: await readFile(join(L, `pool-notes-${one.id}.md`), "utf8").catch(() => ""), common: await (b.rules ?? poolRules)(one.body) };
      return laneOnce({
        increment: one.id, addDirs: b.addDirs, repo: b.repo, maxLanes: b.maxLanes, lock: b.lock, count: b.count, prepare: b.prepare,
        sleep: b.sleep, runLane: b.runLane, now: b.now, follow: !one.plan,
        say: (line) => { if (/^\S+ engine \w+ /.test(line) && !/ exit -?\d+$/.test(line)) engineUp(); say(line); },
        log: join(L, `pool-${one.id}-${at}.log`), err: join(L, `pool-${one.id}-${at}.err`),
        brief: { path: join(L, `pool-${one.id}-brief.md`), text: composeBrief(brief) },
      });
    },
  });
  dated("dispatcher ended");
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
