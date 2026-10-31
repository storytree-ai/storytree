// Capability 3 · The Mint pool's dispatcher (ADR-0955 D2), which the box's launcher execs:
// node --import tsx packages/agent-pool/src/launch.mjs pool            (one dispatcher over every active arc's ready increments; exits 3 to restart on its own code change)
// node packages/agent-pool/src/launch.mjs slots                       (engines running now, and the cap)
// node --import tsx packages/agent-pool/src/launch.mjs ready [project] [--drained] (as JSON: engines running, the cap, the lanes folder and the work the pool would start now)
// node --import tsx packages/agent-pool/src/launch.mjs probe [checkout]  (whether the library and GitHub answer from the checkout, naming each refusal; exit 1 on one)
// node --import tsx packages/agent-pool/src/launch.mjs stop               (ends the dispatcher pool.pid names, if it is one)
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { laneSettings } from "./engine.mjs";
import { blind, pickPlan, pickPool, planState, readOnly, surveyLibrary } from "./feed.mjs";
import { codeVersion, composeBrief, countEngines, holdRunner, processTable, waitForSlot, WINDOWS_PROCESSES } from "./queue.mjs";
import { refusals, runLane as runEngineLane, SIGNALED } from "./runner.mjs";
import { readBoxPace } from "./pace.mjs";
import { poolConfig, readCap } from "./pool-config.mjs";
import { handedOff } from "./watch.mjs";

const run = promisify(execFile);
/** The dispatcher's exit when its own code changed on origin/main: the box wrapper starts it again, on the new code. */
export const RESTART = 3;
/** Lanes push over SSH: the https origin's OAuth token lacks the workflow scope (increment_ecdbefcd7fa1). */
export const PUSH_URL = "git@github.com:storytree-ai/storytree.git";
const stamp = (now) => new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
/** What laneOnce returns when the re-read before its start found the increment no longer ready: no lane ran. */
export const NOT_STARTED = "not started";
/** A dispatcher's command line, as pool.pid's holder is judged by. */
const DISPATCHER = /launch\.mjs pool( |$)/;

/**
 * Why increment `id` should not start now, read from a fresh survey (undefined when it is still ready): closed, gone,
 * off an active arc, or skipped by pickPool's own rules (a live claim, a wait, a held-on question, another machine).
 * Ranking and the round's shared capabilities are not judged again: `max: 0` reads only each increment's own holds.
 */
export function whyNotStart(found, id) {
  const one = found.increments.find((increment) => increment.id === id);
  if (!one || one.status === "closed") return "it is closed";
  if (one.arcState !== "active") return `its arc is ${one.arcState}`;
  return pickPool(found, { max: 0 }).skipped.find((skip) => skip.id === id)?.why;
}

/** A push URL that already reaches the repository over SSH, through the account's host or an alias of it (the box's deploy key, github.com-storytree). */
const SSH_PUSH = /^git@github\.com(-[\w.-]+)?:storytree-ai\/storytree(\.git)?$/;

/**
 * Bring the shared checkout to origin/main, point its pushes at SSH unless they already go there over SSH (the owner's
 * deploy-key URL is kept), and install from its lockfile unchanged; every lane's worktree is cut from it.
 */
export async function prepareCheckout({ repo, platform = process.platform, exec = (command, args, options) => run(command, args, options) }) {
  await exec("git", ["fetch", "-q", "origin"], { cwd: repo });
  await exec("git", ["merge", "-q", "--ff-only", "origin/main"], { cwd: repo });
  // git config --get exits 1 when no push URL is set.
  const pushUrl = await exec("git", ["config", "--get", "remote.origin.pushurl"], { cwd: repo }).then(({ stdout }) => String(stdout).trim(), () => "");
  if (!SSH_PUSH.test(pushUrl)) await exec("git", ["config", "remote.origin.pushurl", PUSH_URL], { cwd: repo });
  // pnpm is a .cmd on Windows, which only a shell runs; these words need no quoting.
  await exec("pnpm", ["install", "--frozen-lockfile", "--silent"], { cwd: repo, maxBuffer: 64 * 1024 * 1024, ...(platform === "win32" ? { shell: true } : {}) });
}

/** Whether process `pid` is alive: signal 0 tests it on Linux and Windows alike; a process we may not signal is alive. */
const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
};

/**
 * Hold the lock file `path` while `fn` runs, where flock(1) is absent (Windows, ADR-1179 D1): it is created exclusively with the
 * holder's pid, waited on a second at a time while a live process holds it, taken over from a dead holder, and removed after.
 */
export async function withLockFile(path, fn, { pid = process.pid, alive = isAlive, sleep = (ms) => wait(ms) } = {}) {
  for (;;) {
    try { await writeFile(path, `${pid}\n`, { flag: "wx" }); break; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const holder = Number((await readFile(path, "utf8").catch(() => "")).trim());
    if (holder && !alive(holder)) { await rm(path, { force: true }); continue; }
    await sleep(1000);
  }
  try { return await fn(); }
  finally { await rm(path, { force: true }); }
}

/** The checkout lock: flock(1), shared with the box's shell launchers, on Linux; a lock file elsewhere. */
export const checkoutLock = (path, platform = process.platform) => (fn) => (platform === "win32" ? withLockFile(path, fn) : withFlock(path, fn));

/**
 * The start rule of a machine-only dispatcher (ADR-1179 D3): a hold while `power` (the power line: Online, Offline or Unknown)
 * says the machine runs on battery, or while `refusals` names the library or GitHub as not answering, naming each; else
 * undefined. An unread power line, or a machine with no battery, is plugged in.
 */
export async function startHold({ power, refusals }) {
  const line = await Promise.resolve().then(power).catch(() => "");
  if (String(line).trim() === "Offline") return { hold: "pause", windows: ["power"], reason: "on battery: a lane starts only while the machine is plugged in" };
  const refused = await refusals();
  if (refused.length) return { hold: "pause", windows: ["network"], reason: `offline: ${refused.join("; ")}` };
  return undefined;
}

/** The power line on Windows (GetSystemPowerStatus, through .NET): Online, Offline or Unknown; elsewhere none is read, so it is plugged in. */
export async function readPowerLine({ platform = process.platform, exec = (command, args, options) => run(command, args, options) } = {}) {
  if (platform !== "win32") return "";
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus"], { timeout: 30_000 });
  return String(stdout).trim();
}

/**
 * The pool's rules name the Mint box's folders (~/code/storytree03, ~/storytree-lanes); a dispatcher configured with its own
 * checkout and lanes folder (the laptop's) briefs its lanes with those, so a lane works and reports where its runner looks.
 */
export function localBrief(text, { checkout, lanes } = {}) {
  let local = text;
  if (checkout) local = local.replace(/~\/code\/storytree03(?![\w-])/g, () => checkout);
  if (lanes) local = local.replace(/~\/storytree-lanes(?![\w-])/g, () => lanes);
  return local;
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
 * the runner checks the lane left a report or a push for its increment, and resumes it once if not. With `recheck`,
 * the increment is read again once the slot and checkout are ready, since that wait can outlast its survey by minutes:
 * a reason back (or an unread library) starts nothing and returns NOT_STARTED.
 */
export async function laneOnce({ increment, brief, log, err, addDirs, repo, maxLanes, lock, count, prepare, sleep, runLane, recheck, follow = false, now = Date.now, say }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  await lock(async () => {
    await waitForSlot({ max: maxLanes, count, sleep, onWait: (running) => dated(`waiting for a slot (${running} engines running) before ${increment}`) });
    try { await prepare(); }
    catch (error) { dated(`checkout update failed before ${increment} (${error.message.split("\n")[0]}); the lane runs on the checkout as it is`); }
  });
  const why = recheck && await Promise.resolve().then(recheck).catch((error) => `library unread before its start (${String(error.message).split("\n")[0]})`);
  if (why) { dated(`not starting ${increment}: ${why}`); return NOT_STARTED; }
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
 * once, and an arc again only once its state differs from the one it was last planned in (`plans` keeps those across restarts,
 * so an arc whose work waits on an event costs one planning lane, not one per restart). Ends on the stop file, 75 (an engine failing at once), or RESTART once `codeVersion` (the code
 * it runs in the shared checkout, queue.mjs's POOL_CODE) differs from its start, each after its running sessions end; when a survey fails or
 * finds nothing and no session is starting, it first brings the checkout up to date (`refresh`) to see that change.
 * With free slots it reads the box's `pace` first (pace.mjs, ADR-1139): while the box is saturated it starts nothing.
 * A `machineOnly` dispatcher takes only work tagged to its machine and starts no planning session (ADR-1179 D2).
 */
export async function runPool({ survey, maxLanes, count, launch, stopFile, exists = async (path) => existsSync(path),
  plans = { load: async () => new Map(), save: async () => {} }, codeVersion = async () => undefined, refresh = async () => {}, pace = async () => undefined,
  sleep = (ms, options) => wait(ms, undefined, options), intervalMs = 15 * 60_000, idleMs = 2 * 60_000, pollMs = 60_000, now = Date.now, say = console.log, machineOnly = false }) {
  const dated = (message) => say(`${stamp(now)} ${message}`);
  const attempts = new Map(), running = new Map(), starting = new Set(), refused = new Map();
  const planned = await plans.load();
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
        // Never started: the next survey judges it afresh, with no back-off and no refusal on record.
        if (code === NOT_STARTED) attempts.delete(one.id);
        // Stopped by a signal (a restart, a kill): requeued as if never started, never read as a failing engine.
        if (code === SIGNALED) { attempts.delete(one.id); dated(`stopped by a signal: requeued ${one.id}`); }
        if (code === 75) ending ??= { code: 75, message: `pool stopped: engine failing at once on ${one.id}` };
      } catch (error) { ending ??= { error }; }
      finally { if (planning === one.id) planning = undefined; starting.delete(one.id); running.delete(one.id); wake(); }
    })());
  };
  // The box's saturation (pace.mjs), said once each time it changes; an unread box holds nothing back.
  let paceKey = "clear";
  const paced = async () => {
    let held, key, line;
    try { held = await pace(); }
    catch (error) { key = "unread"; line = `box readings unread (${String(error.message).split("\n")[0]}): dispatching as usual`; }
    if (held) { key = `${held.hold} ${held.windows}`; line = `holding back dispatch: ${held.reason}`; }
    else if (!key) { key = "clear"; line = "box clear: dispatching up to the cap"; }
    if (key !== paceKey) { paceKey = key; dated(line); }
    return held;
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
    const cap = await maxLanes();
    let free = cap - await count() - starting.size;
    if (free > 0 && await paced()) free = 0;
    if (free <= 0) { await pause(pollMs); continue; }
    // A slot just freed: read the version again, since a read begun before that session ended may predate its merge.
    if (await codeChanged()) continue;
    let found;
    try { found = await survey(); }
    catch (error) {
      dated(`library survey failed (${String(error.message).split("\n")[0]}); looking again in ${Math.round(intervalMs / 60_000)} min`);
      if (await freshen()) continue;
      await pause(intervalMs);
      continue;
    }
    const { picks, skipped } = pickPool(found, { attempts, running: [...running.keys()], max: free, machineOnly });
    for (const [id, attempt] of attempts) {
      if (attempt.refusedBy && refused.get(id) !== attempt.refusedBy) { refused.set(id, attempt.refusedBy); dated(`refused ${id}: claimed by live session ${attempt.refusedBy}; retried once that claim clears`); }
    }
    if (!picks.length) {
      const arc = planning || machineOnly ? undefined : pickPlan(found, { planned, now: now() });
      if (arc) {
        planned.set(arc.id, arc.state);
        try { await plans.save(planned); }
        catch (error) { dated(`planned arcs not saved (${String(error.message).split("\n")[0]}); a restart may plan ${arc.id} again`); }
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

const windows = process.platform === "win32";

/** The process table, `pid ppid args` a line: ps on Linux, Win32_Process on Windows (queue.mjs's processTable). */
async function processes() {
  if (windows) return processTable((await run(...WINDOWS_PROCESSES, { maxBuffer: 64 * 1024 * 1024 })).stdout);
  return (await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout;
}

async function argsOf(pid) {
  if (windows) return (await processes().catch(() => "")).split("\n").find((row) => row.startsWith(`${pid} `))?.replace(/^\d+ \d+ /, "") ?? "";
  return (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();
}

/** The box's paths, cap and processes, from the pool's configuration (pool-config.mjs). */
function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const config = poolConfig({ home, env });
  const { lanesDir, checkout: repo, addDirs } = config;
  const { sessionsDir, stopAt } = laneSettings({ home, env, config });
  return {
    lanesDir, repo, addDirs, sessionsDir, stopAt, machineOnly: config.machineOnly, briefPaths: { checkout: repo, lanes: lanesDir },
    maxLanes: () => readCap({ lanesDir, sessions: config.sessions }),
    count: async () => countEngines(await processes()),
    power: () => readPowerLine(), refusals: (cwd = repo) => refusals({ cwd, env }), kill: (pid) => process.kill(pid),
    lock: checkoutLock(join(lanesDir, "night-checkout.lock")),
    prepare: () => prepareCheckout({ repo }),
    sleep: (ms, options) => wait(ms, undefined, options), argsOf, runLane: runEngineLane, survey: surveyLibrary, now: Date.now,
  };
}

/**
 * `ready`: what the box would do now for `project` (by default storytree), read by another dispatcher that shares the box's
 * cap (the experiment dispatcher, ADR-1064 D3): the engines running, the cap, the lanes folder, every increment
 * pickPool would start, with its arc's priority when it has one, and every arc pickPlan would plan with nothing ready, in
 * its order, each with the state it would be planned in (the reader keeps which it planned); with `drained`, every arc
 * drained of its work (closed, no question open) after them, as an experiment arm plans its one arc. The library is the
 * one this process's storytree home names.
 */
async function ready(b, project = "storytree", { drained = false } = {}) {
  const found = withHandOffs(await b.survey(project), await handedOff(join(b.lanesDir, "watch")));
  const { picks } = pickPool(found, { max: Infinity, now: b.now() });
  const work = picks.map((one) => ({ id: one.id, title: one.title, ...(one.priority === undefined ? {} : { priority: one.priority }) }));
  const plans = [], offered = new Map();
  for (let arc = pickPlan(found, { planned: offered, now: b.now() }); arc; arc = pickPlan(found, { planned: offered, now: b.now() })) {
    offered.set(arc.id, arc.state);
    plans.push({ id: arc.id, title: arc.title, state: arc.state });
  }
  // An arc drained of its work reads closed, so pickPlan never offers it; an experiment arm's one arc still wants planning then.
  if (drained) for (const arc of (found.arcs ?? []).filter((one) => one.state === "closed" && !one.openQuestions)) plans.push({ id: arc.id, title: arc.title, state: planState(found, arc.id) });
  (b.out ?? console.log)(JSON.stringify({ running: await b.count(), cap: await b.maxLanes(), lanesDir: b.lanesDir, ready: work, plans }));
  return 0;
}

/** `pool`, `slots` or `ready`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults({ home: box.home, env: box.env }), ...box };
  if (args[0] === "slots") {
    (b.out ?? console.log)(`${await b.count()} engines running, cap ${await b.maxLanes()}`);
    return 0;
  }
  if (args[0] === "pool") return pool(b);
  if (args[0] === "ready") return ready(b, args[1], { drained: args.includes("--drained") });
  if (args[0] === "probe") return probe(b, args[1] ?? process.cwd());
  if (args[0] === "stop") return stop(b);
  (b.out ?? console.error)("usage: launch.mjs pool | slots | ready [project] [--drained] | probe [checkout] | stop");
  return 2;
}

/** `probe`: the start rule's network probe run from `checkout`, as the laptop's registration checks a checkout before it registers it. */
async function probe(b, checkout) {
  const out = b.out ?? console.log;
  const refused = await b.refusals(checkout);
  for (const one of refused) out(`refused: ${one}`);
  if (!refused.length) out(`the library and GitHub answer from ${checkout}`);
  return refused.length ? 1 : 0;
}

/** `stop`: ends the dispatcher pool.pid names, only while that pid runs `launch.mjs pool` (as holdRunner judges), so a reused pid is left alone. */
async function stop(b) {
  const out = b.out ?? console.log;
  const pid = (await readFile(join(b.lanesDir, "pool.pid"), "utf8").catch(() => "")).trim();
  if (!pid || !DISPATCHER.test(await b.argsOf(pid))) { out("no dispatcher is running"); return 0; }
  b.kill(Number(pid));
  out(`stopped dispatcher ${pid}`);
  return 0;
}

/** A survey with each increment handed to the watcher held on it, as its event wait would hold it, so the pool and planning leave it alone. */
export function withHandOffs(found, handed) {
  const waitsFor = { ...found.holds.waitsFor };
  for (const { increment, note } of handed) waitsFor[increment] = [...(waitsFor[increment] ?? []), { releaser: "event", note, holds: true }];
  return { ...found, holds: { ...found.holds, waitsFor } };
}

/** The arcs the dispatcher planned, each with the state it was planned in, kept in `path` across its restarts; a missing or unreadable file remembers none. */
export function planFile(path) {
  return {
    load: async () => new Map(Object.entries(JSON.parse(await readFile(path, "utf8").catch(() => "{}") || "{}"))),
    save: (planned) => writeFile(path, `${JSON.stringify(Object.fromEntries(planned), null, 2)}\n`),
  };
}

/** `pool`: one dispatcher (pool.pid), its status lines in pool.status, stopped by pool-stop, its planned arcs in pool-planned.json; each session's brief, log and err as pool-<increment>-…. */
async function pool(b) {
  const L = b.lanesDir;
  const say = b.say ?? ((line) => appendFileSync(join(L, "pool.status"), `${line}\n`));
  const dated = (message) => say(`${stamp(b.now)} ${message}`);
  const runner = await holdRunner({ pidFile: join(L, "pool.pid"), pid: b.pid ?? process.pid, marks: [DISPATCHER], argsOf: b.argsOf });
  if (!runner.held) { dated(`dispatcher ${runner.by} is running: not starting`); return 1; }
  dated("dispatcher started");
  const survey = async () => withHandOffs(await b.survey(), await handedOff(join(L, "watch")));
  const code = await runPool({
    survey, maxLanes: b.maxLanes, count: b.count, machineOnly: b.machineOnly, stopFile: join(L, "pool-stop"), plans: planFile(join(L, "pool-planned.json")), sleep: b.sleep, now: b.now, say,
    // A machine-only dispatcher (the laptop's) first holds for its start rule, plugged in and online (ADR-1179 D3).
    pace: async () => (b.machineOnly ? await startHold({ power: b.power, refusals: () => b.refusals() }) : undefined) ?? (b.pace ?? readBoxPace)(),
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
        ...(one.plan ? {} : { recheck: async () => whyNotStart(await survey(), one.id) }),
        say: (line) => { if (/^\S+ engine \w+ /.test(line) && !/ exit -?\d+$/.test(line)) engineUp(); say(line); },
        log: join(L, `pool-${one.id}-${at}.log`), err: join(L, `pool-${one.id}-${at}.err`),
        brief: { path: join(L, `pool-${one.id}-brief.md`), text: localBrief(composeBrief(brief), b.briefPaths) },
      });
    },
  });
  dated("dispatcher ended");
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
