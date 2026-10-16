/**
 * Capability 7 · Experiment dispatcher (ADR-1064 D3). `storytree experiment run` feeds lanes only from its arms' throwaway
 * libraries, so the real pool never sees an experiment increment. It shares the box's lane count with the real pool: it
 * takes a slot only while the real pool has no ranked work waiting (unranked work, the experiment's own arc among it,
 * does not hold it back), always leaves one slot for real work, and gives the arms equal turns, the arm with fewer lanes
 * first, so a pause or a quiet week hits both alike. Each arm stops on its stop rules (stop-rules.ts); a pause stops none.
 *
 * It reaches the agent pool by running its files as processes, never by importing the package (the increment's design
 * call, recorded on capability 7): the command line and the MCP server import this package, and an import would give
 * both doors a path into the dev loop's story. `launch.mjs ready` reads what the real pool, or an arm's library, would
 * start now, with the engines running and the box's cap; `runner.mjs run` runs one lane on the engine its allowance allows.
 */
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Library, Storytree } from "@storytree/library";
import { readExperiment, storytreeHome } from "@storytree/project-and-caller";

import { ARMS } from "../arms.js";
import { curves, type Curves } from "../points/points.js";
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

/** What a library's pool would start now, as `launch.mjs ready` prints it, with the box's engines running and its cap. */
export interface Look {
  readonly running: number;
  readonly cap: number;
  readonly lanesDir: string;
  readonly ready: readonly { readonly id: string; readonly title: string; readonly priority?: number }[];
}

/** What a run keeps across its restarts, per arm: when its first lane was dispatched, its lanes so far, and why it stopped. */
export interface RunState {
  arms: Record<string, { launches: number; firstLane?: string; stopped?: string }>;
}

/**
 * The arm names of the frozen record `experiment`: each must be an arm the arm switch holds (arms.ts's ARMS), denying the
 * same tools and commands the record writes down, so what the doors enforce is what was pre-registered. Refused otherwise.
 */
export function checkArms(experiment: Experiment): string[] {
  const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join("\n") === [...b].sort().join("\n");
  return experiment.arms.map(({ name, denies = { tools: [], commands: [] } }) => {
    const held = Object.hasOwn(ARMS, name) ? ARMS[name] : undefined;
    if (held === undefined) throw new ExperimentRefusal(`the experiment's arm "${name}" is none the arm switch holds (${Object.keys(ARMS).join(", ")}): its lanes could not be switched`);
    if (!same(held.denies.tools, denies.tools) || !same(held.denies.commands, denies.commands)) {
      throw new ExperimentRefusal(`the experiment's arm "${name}" denies ${JSON.stringify(denies)}, but the arm switch denies ${JSON.stringify(held.denies)} for it: the doors would not enforce what was pre-registered`);
    }
    return name;
  });
}

/**
 * The run's loop, every outside reading injected: `look()` is the real pool and `look(arm)` an arm's library; `points` the
 * experiment's curves; `launch` runs one lane and resolves with its exit (calling `engineUp` once its engine runs, so it
 * counts among the box's engines); `stopped` is the owner's stop. Each look: the arms whose stop rules hold are stopped
 * (kept in `state`); with ranked work waiting in the real pool it pauses; otherwise it fills the cap less the engines
 * running, the lanes it is still starting and one slot kept for real work, the arm with fewer lanes first, never starting
 * an increment it runs or ended within `backoffMs`. Ends, after its lanes end, on the owner's stop or once every arm has stopped.
 */
export async function runExperiment({ arms, rules, look, points, launch, state, stopped, sleep, now, say, pollMs = 60_000, backoffMs = 30 * 60_000 }: {
  arms: readonly ArmRun[];
  rules: StopRules;
  look: (arm?: ArmRun) => Promise<Look>;
  points: () => Promise<Curves>;
  launch: (arm: ArmRun, one: { id: string; title: string }, hooks: { engineUp: () => void }) => Promise<number>;
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
  const running = new Map<string, Promise<void>>(), starting = new Set<string>(), ended = new Map<string, number>();
  let paused = false;
  const finish = async (message: string) => {
    await Promise.all(running.values());
    dated(message);
    return 0;
  };
  for (;;) {
    if (await stopped()) return finish("stopped by the owner's stop file");
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
    const offers = new Map<ArmRun, { id: string; title: string }[]>();
    if (free > 0) {
      for (const arm of live) {
        const open = (await look(arm)).ready.filter((one) => !running.has(one.id) && !(now() < (ended.get(one.id) ?? -Infinity) + backoffMs));
        offers.set(arm, [...open]);
      }
    }
    while (free > 0) {
      const arm = live.filter((one) => offers.get(one)?.length).sort((a, b) => of(a).launches - of(b).launches)[0];
      if (arm === undefined) break;
      const one = offers.get(arm)!.shift()!;
      const kept = of(arm);
      kept.launches += 1;
      kept.firstLane ??= new Date(now()).toISOString();
      await state.save(saved);
      free -= 1;
      starting.add(one.id);
      dated(`start ${one.id} in arm ${arm.arm}`);
      running.set(one.id, launch(arm, one, { engineUp: () => starting.delete(one.id) })
        .then((code) => dated(`end ${one.id} in arm ${arm.arm} exit ${code}`), (error: Error) => dated(`lane ${one.id} in arm ${arm.arm} failed: ${error.message}`))
        .finally(() => { starting.delete(one.id); running.delete(one.id); ended.set(one.id, now()); }));
    }
    await sleep(pollMs);
  }
}

/** The storytree checkout this file is in, whose agent pool runs the lanes. */
const CHECKOUT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The run's state file in the lanes folder, kept across restarts. */
export function stateFile(lanesDir: string, name: string): string {
  return path.join(lanesDir, `experiment-${name}.json`);
}

/**
 * One arm lane: the agent pool's lane runner in `repo`, run as its own process in the arm's checkout, with the arm's home
 * as its storytree home, so the lane reads and writes the arm's library alone and its doors enforce the arm's switch.
 */
export function armLaneCommand({ arm, repo, brief, log, err, addDirs, env }: {
  arm: ArmRun; repo: string; brief: string; log: string; err: string; addDirs: readonly string[]; env: NodeJS.ProcessEnv;
}): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  return {
    command: process.execPath,
    args: [path.join(repo, "packages/agent-pool/src/runner.mjs"), "run", brief, log, err, ...addDirs],
    cwd: arm.checkout,
    env: { ...env, STORYTREE_HOME: arm.home },
  };
}

const exec = promisify(execFile);

/** `launch.mjs ready` for `project`, as the storytree home `home` (this process's when omitted) sees it. */
async function lookWith(project: string, home?: string): Promise<Look> {
  const env = home === undefined ? process.env : { ...process.env, STORYTREE_HOME: home };
  const { stdout } = await exec(process.execPath, ["--import", "tsx", path.join(CHECKOUT, "packages/agent-pool/src/launch.mjs"), "ready", project],
    { cwd: CHECKOUT, env, maxBuffer: 16 * 1024 * 1024 });
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
 * make` made them for the short name `name`, each with its repository cloned at `<home>/repo`, and the lane rules in
 * `rulesFile`. Its status lines go to the lanes folder's experiment-<name>.status, its state to experiment-<name>.json;
 * the file experiment-<name>-stop there stops it. One run per experiment at a time. Resolves, with the state file, when the run ends.
 */
export async function runRecorded({ library, server, record, name, rulesFile, say: tell = console.log }: {
  library: Library; server: Pick<Storytree, "ownDatabase">; record: string; name: string; rulesFile: string; say?: (line: string) => void;
}): Promise<string> {
  const experiment = await frozenExperiment(library, record);
  const rules = readStopRules(experiment);
  const arms = checkArms(experiment).map((arm): ArmRun => {
    const workspace = armWorkspace(name, arm, path.join(storytreeHome(), "experiments", `x-${name}-${arm}`));
    const named = readExperiment(workspace.home);
    if (named?.name !== name || named.arm !== arm) throw new ExperimentRefusal(`${workspace.home} is not the home of arm "${arm}" of experiment "${name}": make it with \`storytree experiment arm make ${name} ${arm}\` first`);
    const checkout = path.join(workspace.home, "repo");
    if (!existsSync(checkout)) throw new ExperimentRefusal(`arm "${arm}" has no checkout at ${checkout}: clone its repository there (\`gh repo clone storytree-ai/${workspace.project} ${checkout}\`) first`);
    return { arm, project: workspace.project, home: workspace.home, checkout };
  });
  if (!existsSync(rulesFile)) throw new ExperimentRefusal(`there are no lane rules at ${rulesFile}: name the file every arm lane's brief ends with`);
  const lanesRules = readFileSync(rulesFile, "utf8");
  const { lanesDir } = await lookWith(library.name);
  const pidFile = path.join(lanesDir, `experiment-${name}.pid`);
  const other = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : NaN);
  if (Number.isInteger(other) && other !== process.pid && alive(other)) throw new ExperimentRefusal(`experiment ${name} is already running (process ${other})`);
  writeFileSync(pidFile, `${process.pid}\n`);
  const say = (line: string) => { appendFileSync(path.join(lanesDir, `experiment-${name}.status`), `${line}\n`); tell(line); };
  const file = stateFile(lanesDir, name);
  await runExperiment({
    arms, rules,
    look: (arm) => (arm === undefined ? lookWith(library.name) : lookWith(arm.project, arm.home)),
    points: () => curves(server, library.name, name),
    launch: async (arm, one, { engineUp }) => {
      await freshen(arm.checkout, say);
      const base = path.join(lanesDir, `experiment-${name}-${arm.arm}-${one.id}`);
      const at = new Date().toISOString().replace(/[-:]|\.\d{3}Z$/g, "");
      writeFileSync(`${base}-brief.md`, [`# Experiment lane: ${one.id}`, "",
        `Your increment: ${one.id}. You work in arm "${arm.arm}" of experiment "${name}": your storytree home is ${arm.home}, whose library is the arm's own (project ${arm.project}), and your repository is the one checked out at ${arm.checkout}.`,
        "", lanesRules].join("\n"));
      const lane = armLaneCommand({ arm, repo: CHECKOUT, brief: `${base}-brief.md`, log: `${base}-${at}.log`, err: `${base}-${at}.err`, addDirs: [lanesDir], env: process.env });
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
