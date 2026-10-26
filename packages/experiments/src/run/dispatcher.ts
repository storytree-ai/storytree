/**
 * Capability 7 · Experiment dispatcher (ADR-1064 D3). `storytree experiment run` feeds lanes only from its arms' throwaway
 * libraries, so the real pool never sees an experiment increment. It shares the box's lane count with the real pool: it
 * takes a slot only while the real pool has no ranked work waiting (unranked work, the experiment's own arc among it,
 * does not hold it back), always leaves one slot for real work, and gives the arms equal turns, the arm with fewer lanes
 * first, so a pause or a quiet week hits both alike. Each arm stops on its stop rules (stop-rules.ts); a pause stops none.
 * At every look it first records each arm's new merges as points (points.ts), so its stop rules and curves see them.
 *
 * It reaches the agent runner by running its exported entries as processes, never by importing the package (the
 * increment's design call, recorded on capability 7): the command line and the MCP server import this package, and an
 * import would give both doors a path into the agent runner's story. Each entry is found through the agent runner's
 * declared exports (ADR-1112), never by a path into storytree's checkout, so a plugin outside it starts lanes the same way.
 * `launch ready` reads what the real pool, or an arm's library, would start now, with the engines running and the box's
 * cap; `runner run` runs one lane on the engine its allowance allows.
 */
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Library, Storytree } from "@storytree/library";
import { approveTrunk, machineOf, readExperiment, registerTrunk, storytreeHome, trunksOn } from "@storytree/project-and-caller";

import { carryDenies } from "../arms.js";
import { curves, recordArms, recordedLines, type Curves } from "../points/points.js";
import { ExperimentRefusal, frozenExperiment, type Experiment } from "../record/record.js";
import { armWorkspace } from "../workspaces.js";
import { readStopRules, stopReason, type StopRules } from "./stop-rules.js";

/** One arm as a run drives it: its project in its own library, its storytree home, and the checkout of its repository its lanes start in. */
export interface ArmRun {
  readonly arm: string;
  readonly project: string;
  readonly home: string;
  readonly checkout: string;
}

/**
 * What a library's pool would start now, as `launch.mjs ready` prints it, with the box's engines running and its cap: its
 * ready increments and, for when none is ready, the arcs it would plan, each with the state it would be planned in.
 */
export interface Look {
  readonly running: number;
  readonly cap: number;
  readonly lanesDir: string;
  readonly ready: readonly { readonly id: string; readonly title: string; readonly priority?: number }[];
  readonly plans?: readonly { readonly id: string; readonly title: string; readonly state: string }[];
}

/**
 * What a run keeps across its restarts, per arm: when its first lane was dispatched, its lanes so far (planning lanes
 * among them), each arc it planned with the state it planned it in, the arc whose planning lane it has not yet looked
 * past, each arc whose planning lane changed nothing with the state it was left in and when its back-off ends, how many
 * planning lanes in a row changed nothing, and why it stopped.
 */
export interface RunState {
  arms: Record<string, {
    launches: number;
    firstLane?: string;
    planned?: Record<string, string>;
    checking?: string;
    retries?: Record<string, { state: string; until: string }>;
    idlePlans?: number;
    stopped?: string;
  }>;
}

/** One lane a run starts: an increment to build, or, with `plan`, an arc to plan. */
export interface Lane {
  readonly id: string;
  readonly title: string;
  readonly plan?: true;
}

/**
 * The arms of the frozen record `experiment` as a run drives them, for its short name `name`: each arm's home, made by
 * `experiment arm make` under `root`, is given what the record says that arm denies (none when it says none), so the
 * doors enforce what was pre-registered. Refused, before any home is written, when an arm's home is not that arm's or
 * it has no checkout of its repository at `<home>/repo`.
 */
export function armRuns(experiment: Experiment, name: string, root: string): ArmRun[] {
  const runs = experiment.arms.map(({ name: arm, denies = { tools: [], commands: [] } }) => {
    const workspace = armWorkspace(name, arm, path.join(root, `x-${name}-${arm}`));
    const named = readExperiment(workspace.home);
    if (named?.name !== name || named.arm !== arm) throw new ExperimentRefusal(`${workspace.home} is not the home of arm "${arm}" of experiment "${name}": make it with \`storytree experiment arm make ${name} ${arm}\` first`);
    const checkout = path.join(workspace.home, "repo");
    if (!existsSync(checkout)) throw new ExperimentRefusal(`arm "${arm}" has no checkout at ${checkout}: clone its repository there (\`gh repo clone storytree-ai/${workspace.project} ${checkout}\`) first`);
    return { run: { arm, project: workspace.project, home: workspace.home, checkout }, denies };
  });
  for (const { run, denies } of runs) carryDenies(run.home, name, run.arm, denies);
  return runs.map(({ run }) => run);
}

/**
 * Approve each arm's checkout as its project's trunk on this machine, as the machine its home names, through `server`, the
 * admin's connection: an arm's role only reads the trunks, so no lane can approve a folder, and its doors would refuse the
 * checkout until a join it cannot make. A checkout already approved is left alone; one recorded unapproved is approved;
 * none recorded is recorded approved. Refused when the arm's project has another trunk on that machine, or the checkout is
 * another project's. Gives a line for each checkout it approved.
 */
export async function approveCheckouts(server: Storytree, arms: readonly ArmRun[]): Promise<string[]> {
  const lines: string[] = [];
  for (const arm of arms) {
    const machine = machineOf(arm.home), folder = realpathSync.native(arm.checkout);
    const trunks = await trunksOn(server, machine.id);
    const own = trunks.find((trunk) => trunk.project === arm.project);
    if (own !== undefined && own.folder !== folder) throw new ExperimentRefusal(`arm "${arm.arm}"'s project ${arm.project} already has its trunk at ${own.folder} on this machine, not its checkout ${folder}: forget that trunk first`);
    if (own?.approvedBy !== undefined) continue;
    const by = "experiment run";
    if (own !== undefined ? !(await approveTrunk(server, { project: arm.project, machine: machine.id, folder }, by)) : !(await registerTrunk(server, { project: arm.project, machine: machine.id, machineName: machine.name, folder }, by))) {
      const other = trunks.find((trunk) => trunk.folder === folder)?.project;
      throw new ExperimentRefusal(`arm "${arm.arm}"'s checkout ${folder} could not be approved as ${arm.project}'s trunk${other === undefined ? "" : `: it is ${other}'s`}`);
    }
    lines.push(`approved ${folder} as arm ${arm.arm}'s checkout (${arm.project})`);
  }
  return lines;
}

/**
 * How many planning lanes in a row must change nothing before an arm is stopped as declared done (increment_fad7353f8cf8,
 * a disclosed amendment to the frozen stop rules): one empty plan can be one lane's misreading, and three fresh lanes,
 * the back-off between each, agreeing that nothing is left is the factory's own verdict, at about an hour's cost.
 */
export const DECLARED_DONE = 3;

/**
 * The run's loop, every outside reading injected: `look()` is the real pool and `look(arm)` an arm's library; `record`
 * writes the arms' new merges as points and gives the lines to say of it; `points` the experiment's curves; `launch` runs one lane and resolves with its exit (calling `engineUp` once its engine runs, so it
 * counts among the box's engines); `stopped` is the owner's stop. Each look: the arms whose stop rules hold are stopped
 * (kept in `state`), after their new merges are recorded; with ranked work waiting in the real pool it pauses; otherwise it fills the cap less the engines
 * running, the lanes it is still starting and one slot kept for real work, the arm with fewer lanes first, never starting
 * an increment it runs or ended within `backoffMs`. An arm with nothing ready is offered one planning lane, as the real pool
 * plans (launch.mjs): for the first arc its look would plan whose state differs from the one the arm last planned it in
 * (kept in `state`), never while a planning lane of that arm runs. The arm's first look after its planning lane ends
 * checks it: with nothing ready and the arc still in the state it was planned in, the lane changed nothing, so the arc
 * is offered again once `backoffMs` has passed since the lane ended (kept in `state`), or sooner if its state changes. An arc
 * its look no longer lists (its work is open) is forgotten as planned, so it is offered again when it returns. An arm
 * whose planning lanes change nothing `DECLARED_DONE` times in a row is stopped as declared done. Ends, after its lanes end, on the owner's stop or once every arm has stopped.
 */
export async function runExperiment({ arms, rules, look, record, points, launch, state, stopped, sleep, now, say, pollMs = 60_000, backoffMs = 30 * 60_000 }: {
  arms: readonly ArmRun[];
  rules: StopRules;
  look: (arm?: ArmRun) => Promise<Look>;
  record: () => Promise<readonly string[]>;
  points: () => Promise<Curves>;
  launch: (arm: ArmRun, one: Lane, hooks: { engineUp: () => void }) => Promise<number>;
  state: { load: () => Promise<RunState>; save: (state: RunState) => Promise<void> };
  stopped: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  say: (line: string) => void;
  pollMs?: number;
  backoffMs?: number;
}): Promise<number> {
  const dated = (message: string) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const saved = await state.load();
  const of = (arm: ArmRun) => (saved.arms[arm.arm] ??= { launches: 0 });
  const running = new Map<string, Promise<void>>(), starting = new Set<string>(), ended = new Map<string, number>(), planning = new Set<string>();
  let paused = false;
  const finish = async (message: string) => {
    await Promise.all(running.values());
    dated(message);
    return 0;
  };
  for (;;) {
    if (await stopped()) return finish("stopped by the owner's stop file");
    try { for (const line of await record()) dated(line); }
    catch (error) { dated(`could not record the arms' points (${String((error as Error).message).split("\n")[0]}); the next look tries again`); }
    let series: Curves | undefined;
    try { series = await points(); }
    catch (error) { dated(`could not read the experiment's points (${String((error as Error).message).split("\n")[0]}); its stop rules wait for the next look`); }
    for (const arm of arms) {
      const kept = of(arm);
      const reason = series && !kept.stopped
        ? stopReason({ points: series[arm.arm] ?? [], rules, firstLane: kept.firstLane === undefined ? undefined : Date.parse(kept.firstLane), now: now() })
        : undefined;
      if (reason) {
        kept.stopped = reason;
        await state.save(saved);
        dated(`stopped arm ${arm.arm}: ${reason}`);
      }
    }
    const live = arms.filter((arm) => !of(arm).stopped);
    if (!live.length) return finish("every arm has stopped: the run is over");
    const real = await look();
    const ranked = real.ready.filter((one) => one.priority !== undefined);
    if (ranked.length) {
      if (!paused) dated(`paused: the real pool has ranked work waiting (${ranked.map((one) => one.id).join(", ")})`);
      paused = true;
      await sleep(pollMs);
      continue;
    }
    if (paused) dated("resumed: the real pool has no ranked work waiting");
    paused = false;
    let free = real.cap - real.running - starting.size - 1;
    const offers = new Map<ArmRun, Lane[]>(), states = new Map<string, string>();
    if (free > 0) {
      for (const arm of live) {
        const seen = await look(arm);
        const kept = of(arm);
        if (kept.checking !== undefined && !planning.has(arm.arm)) {
          const arc = kept.checking, unchanged = seen.plans?.find((one) => one.id === arc && one.state === kept.planned?.[arc]);
          delete kept.checking;
          if (!seen.ready.length && unchanged) {
            const { [arc]: _, ...rest } = kept.planned!;
            kept.planned = rest;
            kept.idlePlans = (kept.idlePlans ?? 0) + 1;
            if (kept.idlePlans >= DECLARED_DONE) {
              kept.stopped = `declared done: its planning lane changed nothing on ${DECLARED_DONE} consecutive tries`;
              await state.save(saved);
              dated(`stopped arm ${arm.arm}: ${kept.stopped}`);
              continue;
            }
            kept.retries = { ...kept.retries, [arc]: { state: unchanged.state, until: new Date((ended.get(arc) ?? now()) + backoffMs).toISOString() } };
            dated(`plan ${arc} in arm ${arm.arm} changed nothing: offered again after the back-off`);
          } else delete kept.idlePlans;
          await state.save(saved);
        }
        // An arc leaves the list while its work is open, so one that returns is offered again even in its first state.
        const gone = seen.plans && !planning.has(arm.arm) ? Object.keys(kept.planned ?? {}).filter((arc) => !seen.plans!.some((one) => one.id === arc)) : [];
        if (gone.length) {
          const rest = Object.fromEntries(Object.entries(kept.planned!).filter(([arc]) => !gone.includes(arc)));
          if (Object.keys(rest).length) kept.planned = rest;
          else delete kept.planned;
          await state.save(saved);
        }
        const open = seen.ready.filter((one) => !running.has(one.id) && !(now() < (ended.get(one.id) ?? -Infinity) + backoffMs));
        const plan = open.length || planning.has(arm.arm) ? undefined : (seen.plans ?? []).find((arc) => {
          const retry = kept.retries?.[arc.id];
          return kept.planned?.[arc.id] !== arc.state && !(retry?.state === arc.state && now() < Date.parse(retry.until));
        });
        if (plan) states.set(`${arm.arm} ${plan.id}`, plan.state);
        offers.set(arm, plan ? [{ id: plan.id, title: plan.title, plan: true }] : [...open]);
      }
    }
    while (free > 0) {
      const arm = live.filter((one) => offers.get(one)?.length).sort((a, b) => of(a).launches - of(b).launches)[0];
      if (arm === undefined) break;
      const one = offers.get(arm)!.shift()!;
      const kept = of(arm);
      kept.launches += 1;
      kept.firstLane ??= new Date(now()).toISOString();
      if (one.plan) {
        kept.planned = { ...kept.planned, [one.id]: states.get(`${arm.arm} ${one.id}`)! };
        if (kept.retries?.[one.id] !== undefined) {
          const { [one.id]: _, ...rest } = kept.retries;
          if (Object.keys(rest).length) kept.retries = rest;
          else delete kept.retries;
        }
        kept.checking = one.id;
        planning.add(arm.arm);
      }
      await state.save(saved);
      free -= 1;
      starting.add(one.id);
      dated(one.plan ? `plan ${one.id} (${one.title}) in arm ${arm.arm}: nothing ready` : `start ${one.id} in arm ${arm.arm}`);
      running.set(one.id, launch(arm, one, { engineUp: () => starting.delete(one.id) })
        .then((code) => dated(`end ${one.id} in arm ${arm.arm} exit ${code}`), (error: Error) => dated(`lane ${one.id} in arm ${arm.arm} failed: ${error.message}`))
        .finally(() => { starting.delete(one.id); running.delete(one.id); ended.set(one.id, now()); if (one.plan) planning.delete(arm.arm); }));
    }
    await sleep(pollMs);
  }
}

/** The storytree checkout this file is in, whose agent pool runs the lanes. */
/** The agent runner's declared entries (story_b2051c0f7372's exports): its lane runner, and the launcher whose `ready` a look reads. */
const RUNNER = fileURLToPath(import.meta.resolve("@storytree/agent-pool/runner"));
const LAUNCH = fileURLToPath(import.meta.resolve("@storytree/agent-pool/launch"));

/** The run's state file in the lanes folder, kept across restarts. */
export function stateFile(lanesDir: string, name: string): string {
  return path.join(lanesDir, `experiment-${name}.json`);
}

/** The run's status lines in the lanes folder, the hidden tests' counts among them. */
export function statusFile(lanesDir: string, name: string): string {
  return path.join(lanesDir, `experiment-${name}.status`);
}

/**
 * Where one lane of arm `arm` writes: its brief, log and error log, and the reports and scratch files (a review's return)
 * it writes itself, all in the arm's home's `lanes` folder, the one folder it is given. The run's own files (its state,
 * status, pid and output, which carry the hidden tests' counts) stay in the box's lanes folder, which no arm lane is given,
 * and another arm's lanes write in that arm's home: an arm lane's folder lists only its own arm's work.
 */
export function laneFiles({ arm, name, one, at }: { arm: ArmRun; name: string; one: Lane; at: string }): {
  folder: string; brief: string; log: string; err: string; addDirs: string[];
} {
  const folder = path.join(arm.home, "lanes");
  const base = path.join(folder, `experiment-${name}-${arm.arm}-${one.id}`);
  return { folder, brief: `${base}-brief.md`, log: `${base}-${at}.log`, err: `${base}-${at}.err`, addDirs: [folder] };
}

/**
 * One arm lane: the agent runner's lane runner, run as its own process in the arm's checkout, with the arm's home
 * as its storytree home, so the lane reads and writes the arm's library alone and its doors enforce the arm's switch.
 */
export function armLaneCommand({ arm, brief, log, err, addDirs, env }: {
  arm: ArmRun; brief: string; log: string; err: string; addDirs: readonly string[]; env: NodeJS.ProcessEnv;
}): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  return {
    command: process.execPath,
    args: [RUNNER, "run", brief, log, err, ...addDirs],
    cwd: arm.checkout,
    env: { ...env, STORYTREE_HOME: arm.home },
  };
}

/** The planning lane's rules, versioned beside this file: plan the arm's arc inside the arm, never build. */
export const PLAN_RULES = fileURLToPath(new URL("./arm-plan-rules.md", import.meta.url));

/**
 * The brief one lane of arm `arm` of experiment `name` starts from: an increment to build, ending with the build rules
 * `rules`, or an arc to plan, ending with the planning rules `planRules`; each names the arm's home, library and checkout.
 */
export function laneBrief({ arm, name, one, rules, planRules }: { arm: ArmRun; name: string; one: Lane; rules: string; planRules: string }): string {
  const where = `You work in arm "${arm.arm}" of experiment "${name}": your storytree home is ${arm.home}, whose library is the arm's own (project ${arm.project}), your repository is the one checked out at ${arm.checkout}, and your lane folder is ${laneFiles({ arm, name, one, at: "" }).folder}.`;
  return (one.plan
    ? [`# Experiment planning lane: ${one.id}`, "", `Your arc: ${one.id} (${one.title}). ${where}`, "", planRules]
    : [`# Experiment lane: ${one.id}`, "", `Your increment: ${one.id}. ${where}`, "", rules]).join("\n");
}

const exec = promisify(execFile);

/** The arguments of `launch.mjs ready` for `project`: an arm's look (`arm`) also lists its drained arcs, as it plans its one arc. */
export function readyArgs(project: string, { arm = false }: { arm?: boolean } = {}): string[] {
  return ["ready", project, ...(arm ? ["--drained"] : [])];
}

/** The process that runs `launch ready` for `project`, as the storytree home `home` (`env`'s when omitted) sees it. */
export function lookCommand(project: string, home: string | undefined, env: NodeJS.ProcessEnv): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: ["--import", import.meta.resolve("tsx"), LAUNCH, ...readyArgs(project, { arm: home !== undefined })],
    env: home === undefined ? env : { ...env, STORYTREE_HOME: home },
  };
}

/** `launch ready` for `project`, as the storytree home `home` (this process's when omitted) sees it. */
async function lookWith(project: string, home?: string): Promise<Look> {
  const { args, env } = lookCommand(project, home, process.env);
  const { stdout } = await exec(process.execPath, args, { env, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout) as Look;
}

/** Bring an arm's checkout to its origin's main before a lane starts there; a failure is said and the lane runs on it as it is. */
async function freshen(checkout: string, say: (line: string) => void): Promise<void> {
  try {
    await exec("git", ["fetch", "-q", "origin"], { cwd: checkout });
    await exec("git", ["merge", "-q", "--ff-only", "origin/main"], { cwd: checkout });
  } catch (error) { say(`checkout ${checkout} not updated (${String((error as Error).message).split("\n")[0]}); the lane runs on it as it is`); }
}

/** Runs `command`, its output lines to `line`; resolves with its exit. */
function spawned({ command, args, cwd, env }: ReturnType<typeof armLaneCommand>, line: (text: string) => void): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"] });
    createInterface({ input: child.stdout! }).on("line", line);
    child.once("error", fail);
    child.once("close", (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}

/**
 * `storytree experiment run`: the frozen record `record` in `library` (refused unfrozen), its arms' homes as `experiment arm
 * make` made them for the short name `name`, each with its repository cloned at `<home>/repo` (approved as its trunk
 * here, approveCheckouts), and the lane rules in `rulesFile`. Its status lines go to the lanes folder's experiment-<name>.status, its state to experiment-<name>.json;
 * the file experiment-<name>-stop there stops it. Each lane's brief, logs and report go to its arm's lane folder (laneFiles). One run per experiment at a time. Resolves, with the state file, when the run ends.
 */
export async function runRecorded({ library, server, record, name, rulesFile, say: tell = console.log }: {
  library: Library; server: Storytree; record: string; name: string; rulesFile: string; say?: (line: string) => void;
}): Promise<string> {
  const experiment = await frozenExperiment(library, record);
  const rules = readStopRules(experiment);
  const arms = armRuns(experiment, name, path.join(storytreeHome(), "experiments"));
  for (const line of await approveCheckouts(server, arms)) tell(line);
  if (!existsSync(rulesFile)) throw new ExperimentRefusal(`there are no lane rules at ${rulesFile}: name the file every arm lane's brief ends with`);
  const lanesRules = readFileSync(rulesFile, "utf8"), planRules = readFileSync(PLAN_RULES, "utf8");
  const { lanesDir } = await lookWith(library.name);
  const pidFile = path.join(lanesDir, `experiment-${name}.pid`);
  const other = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : NaN);
  if (Number.isInteger(other) && other !== process.pid && alive(other)) throw new ExperimentRefusal(`experiment ${name} is already running (process ${other})`);
  writeFileSync(pidFile, `${process.pid}\n`);
  const say = (line: string) => { appendFileSync(statusFile(lanesDir, name), `${line}\n`); tell(line); };
  const file = stateFile(lanesDir, name);
  await runExperiment({
    arms, rules,
    look: (arm) => (arm === undefined ? lookWith(library.name) : lookWith(arm.project, arm.home)),
    // Only what a look wrote, or failed to, is said: an arm waiting on a run, or with nothing new, says nothing every minute.
    // Each point names the record it was run for, so `experiment curves` reads it by the record's id as well as by name.
    record: async () => recordedLines((await recordArms(server, library.name, name, arms.map((arm) => arm.arm), { record }))
      .filter(({ recorded }) => recorded === undefined || recorded.written.length > 0)),
    points: () => curves(server, library.name, name),
    launch: async (arm, one, { engineUp }) => {
      await freshen(arm.checkout, say);
      const files = laneFiles({ arm, name, one, at: new Date().toISOString().replace(/[-:]|\.\d{3}Z$/g, "") });
      mkdirSync(files.folder, { recursive: true });
      writeFileSync(files.brief, laneBrief({ arm, name, one, rules: lanesRules, planRules }));
      const lane = armLaneCommand({ arm, ...files, env: process.env });
      return spawned(lane, (line) => { if (/^\S+ engine \w+ /.test(line) && !/ exit -?\d+$/.test(line)) engineUp(); say(line); });
    },
    state: {
      load: async () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as RunState : { arms: {} }),
      save: async (state) => writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`),
    },
    stopped: async () => existsSync(path.join(lanesDir, `experiment-${name}-stop`)),
    sleep: (ms) => new Promise((go) => setTimeout(go, ms)),
    now: Date.now, say,
  });
  return file;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
