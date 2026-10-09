// Capability 12 · A Mint queue runs its lanes one at a time, or a night track up to its line in
// night-lanes-per-track beside lanes writing other packages. The box's queue runners, which its wrappers exec:
// node --import tsx packages/dev-loop/src/lanes/launch.mjs night <track>   (launch-night.sh run <track>: night-queue-<T>.txt, refilled from the library)
// node --import tsx packages/dev-loop/src/lanes/launch.mjs mintlib         (launch-mintlib.sh run: mintlib-queue.txt, stops on a failed lane)
// node packages/dev-loop/src/lanes/launch.mjs slots                       (engines running now, and the cap)
// node --import tsx packages/dev-loop/src/lanes/launch.mjs pool            (ADR-0955: one dispatcher over every active arc's ready increments)
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { blind, keepFed, markQueueInLibrary, parseFences, pickPool, queuedOnTracks, readOnly, surveyLibrary } from "./feed.mjs";
import { composeBrief, countEngines, holdRunner, runQueue, waitForSlot } from "./queue.mjs";
import { runLane as runEngineLane } from "./runner.mjs";

const run = promisify(execFile);
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
 * the brief, and run it through the lane runner, which picks the engine. Status lines go to `say`.
 */
export async function laneOnce({ increment, brief, log, err, addDirs, repo, maxLanes, lock, count, prepare, sleep, runLane, now = Date.now, say }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  await lock(async () => {
    await waitForSlot({ max: maxLanes, count, sleep, onWait: (running) => dated(`waiting for a slot (${running} engines running) before ${increment}`) });
    try { await prepare(); }
    catch (error) { dated(`checkout update failed before ${increment} (${error.message.split("\n")[0]}); the lane runs on the checkout as it is`); }
  });
  await writeFile(brief.path, brief.text);
  dated(`start ${increment}`);
  let code;
  try { code = await runLane({ brief: brief.path, log, err, addDirs, cwd: repo, say }); }
  catch (error) { dated(`lane runner: ${error.message}; exit 75 so this lane stays queued`); code = 75; }
  dated(`end ${increment} exit ${code}`);
  return code;
}

/**
 * The dispatcher (ADR-0955 D2, D4): whenever free slots (the cap less the engines running and the sessions it is
 * still starting) are open, it takes that many increments from one survey (feed.mjs's pickPool) and launches each;
 * a launch's `engineUp` says its engine has started, so it counts among the engines from then on. It looks again
 * when a session ends, every `pollMs` while slots are full, and every `intervalMs` while nothing is ready. A claim
 * that refused a session is said once, and its increment waits until that claim clears. Ends on the stop file, or
 * 75 (an engine failing at once), each after its running sessions end.
 */
export async function runPool({ survey, maxLanes, count, launch, stopFile, exists = async (path) => existsSync(path),
  sleep = (ms, options) => wait(ms, undefined, options), intervalMs = 15 * 60_000, pollMs = 60_000, now = Date.now, say = console.log }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  const attempts = new Map(), running = new Map(), starting = new Set(), refused = new Map();
  let ending, changed, change = new Promise((go) => { changed = go; });
  const wake = () => { changed(); change = new Promise((go) => { changed = go; }); };
  const start = (one) => {
    attempts.set(one.id, { at: now() });
    starting.add(one.id);
    running.set(one.id, (async () => {
      try {
        const code = await launch(one, { engineUp: () => starting.delete(one.id) });
        if (code === 75) ending ??= { code: 75, message: `pool stopped: engine failing at once on ${one.id}` };
      } catch (error) { ending ??= { error }; }
      finally { starting.delete(one.id); running.delete(one.id); wake(); }
    })());
  };
  const pause = async (ms) => {
    const look = new AbortController();
    await Promise.race([change, Promise.resolve(sleep(ms, { signal: look.signal })).catch(() => {})]);
    look.abort();
  };
  for (;;) {
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
      await pause(intervalMs);
      continue;
    }
    const { picks, skipped } = pickPool(found, { attempts, running: [...running.keys()], max: free });
    for (const [id, attempt] of attempts) {
      if (attempt.refusedBy && refused.get(id) !== attempt.refusedBy) { refused.set(id, attempt.refusedBy); dated(`refused ${id}: claimed by live session ${attempt.refusedBy}; retried once that claim clears`); }
    }
    if (!picks.length) {
      dated(`nothing ready for ${free} free slot${free === 1 ? "" : "s"} (${skipped.length} skipped); looking again in ${Math.round(intervalMs / 60_000)} min`);
      await pause(intervalMs);
      continue;
    }
    for (const one of picks) start(one);
    await pause(pollMs);
  }
}

/** The pool's brief rules, versioned beside this file: the read-only rules for read-only or blind work, else the build rules. */
export async function poolRules(body) {
  const name = readOnly(body) || blind(body) ? "pool-brief-read-only.md" : "pool-brief.md";
  return readFile(new URL(`./${name}`, import.meta.url), "utf8");
}

/** A track's lane limit from night-lanes-per-track's `T=N` lines: N when it is a whole number of at least 1, else 1. */
export function laneLimit(text, track) {
  const value = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith(`${track}=`))?.slice(2).trim();
  return /^[1-9]\d*$/.test(value ?? "") ? Number(value) : 1;
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
    sleep: (ms, options) => wait(ms, undefined, options), argsOf, runLane: runEngineLane, survey: surveyLibrary, markQueue: (marks) => markQueueInLibrary(marks), now: Date.now,
  };
}

const MINTLIB_FENCE = "infra/library-host/, .github/workflows/own-health.yml, and packages/dev-loop or packages/ci-health only while no overnight track-A lane holds them";

/** `pool`, `night <T>`, `mintlib` or `slots`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults(), ...box };
  const L = b.lanesDir;
  if (args[0] === "slots") {
    (b.out ?? console.log)(`${await b.count()} engines running, cap ${await b.maxLanes()}`);
    return 0;
  }
  if (args[0] === "pool") return pool(b);
  const night = args[0] === "night" && /^[A-Z]$/.test(args[1] ?? "");
  if (!night && args[0] !== "mintlib") { (b.out ?? console.error)("usage: launch.mjs pool | night <track> | mintlib | slots"); return 2; }
  const name = night ? args[1] : "mintlib";
  const status = join(L, night ? `night-${name}.status` : "mintlib.status");
  const say = b.say ?? ((line) => appendFileSync(status, `${line}\n`));
  const dated = (message) => say(`${stamp(b.now)} ${message}`);
  const marks = night ? [new RegExp(`launch-night\\.sh run ${name}( |$)`), new RegExp(`launch\\.mjs night ${name}( |$)`)]
    : [/launch-mintlib\.sh run( |$)/, /launch\.mjs mintlib( |$)/];
  const pidFile = join(L, night ? `night-${name}.pid` : "mintlib.pid");
  const runner = await holdRunner({ pidFile, pid: b.pid ?? process.pid, marks, argsOf: b.argsOf });
  if (!runner.held) {
    dated(night ? `runner ${b.pid ?? process.pid} not started: runner ${runner.by} still drives track ${name}` : `runner ${runner.by} is running: not starting`);
    return 1;
  }
  const lane = (increment, { title, intro, notes, common, log, err }) => laneOnce({
    increment, log, err, addDirs: b.addDirs, repo: b.repo, maxLanes: b.maxLanes, lock: b.lock, count: b.count, prepare: b.prepare,
    sleep: b.sleep, runLane: b.runLane, now: b.now, say,
    brief: { path: join(L, night ? `night-${name}-${increment}-brief.md` : `mintlib-${increment}-brief.md`), text: composeBrief({ title, intro, notes, common }) },
  });
  if (night) {
    const fencesText = await readFile(join(L, "night-fences.txt"), "utf8");
    const fence = fencesText.split("\n").find((line) => line.startsWith(`${name}=`))?.slice(2).trim();
    if (!fence) { dated(`night-fences.txt has no track ${name}: not starting`); return 1; }
    const code = await keepFed({
      track: name, fences: parseFences(fencesText), queueFile: join(L, `night-queue-${name}.txt`), stopFile: join(L, "night-stop"),
      survey: b.survey, queued: () => queuedOnTracks(L), markQueue: b.markQueue, sleep: b.sleep, now: b.now, say,
      limit: async () => laneLimit(await readFile(join(L, "night-lanes-per-track"), "utf8").catch(() => ""), name),
      runLane: async (increment) => lane(increment, {
        title: `Overnight lane: track ${name}, ${increment}`,
        intro: `Your increment: ${increment}. Your track: ${name}. Your write fence: ${fence}.`,
        notes: await readFile(join(L, `night-notes-${increment}.md`), "utf8").catch(() => ""),
        common: await readFile(join(L, `night-common-${name}.md`), "utf8").catch(() => readFile(join(L, "night-common.md"), "utf8")),
        log: join(L, `night-${name}-${increment}.log`), err: join(L, `night-${name}-${increment}.err`),
      }),
    });
    dated("track done");
    return code;
  }
  const common = await readFile(join(L, "mintlib-common.md"), "utf8").catch(() => "");
  if (!common.trim()) { dated(`missing ${join(L, "mintlib-common.md")}: not starting`); return 1; }
  const code = await runQueue({
    queueFile: join(L, "mintlib-queue.txt"), stopFile: join(L, "mintlib-stop"), stopOnFailure: true, now: b.now, say,
    runLane: (increment) => {
      const at = new Date(b.now()).toISOString().replace(/[-:]|\.\d{3}Z$/g, "");
      return lane(increment, {
        title: `Lane: arc_34390ae9d2e1, ${increment}`, intro: `Your increment: ${increment}. Your write fence: ${MINTLIB_FENCE}.`, common,
        log: join(L, `mintlib-${increment}-${at}.log`), err: join(L, `mintlib-${increment}-${at}.err`),
      });
    },
  });
  dated("runner ended");
  return code;
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
    survey: b.survey, maxLanes: b.maxLanes, count: b.count, stopFile: join(L, "pool-stop"), sleep: b.sleep, now: b.now, say,
    launch: async (one, { engineUp }) => {
      const at = new Date(b.now()).toISOString().replace(/[-:]|\.\d{3}Z$/g, "");
      const role = blind(one.body) ? " You are a blind reviewer: follow .claude/agents/blind-reviewer.md (ADR-0950)." : "";
      return laneOnce({
        increment: one.id, addDirs: b.addDirs, repo: b.repo, maxLanes: b.maxLanes, lock: b.lock, count: b.count, prepare: b.prepare,
        sleep: b.sleep, runLane: b.runLane, now: b.now,
        say: (line) => { if (/^\S+ engine \w+ /.test(line) && !/ exit -?\d+$/.test(line)) engineUp(); say(line); },
        log: join(L, `pool-${one.id}-${at}.log`), err: join(L, `pool-${one.id}-${at}.err`),
        brief: { path: join(L, `pool-${one.id}-brief.md`), text: composeBrief({
          title: `Pool lane: ${one.id}`, intro: `Your increment: ${one.id}.${role}`,
          notes: await readFile(join(L, `pool-notes-${one.id}.md`), "utf8").catch(() => ""), common: await (b.rules ?? poolRules)(one.body),
        }) },
      });
    },
  });
  dated("dispatcher ended");
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
