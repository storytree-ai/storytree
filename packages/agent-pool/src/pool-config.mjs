// Capability 3 · The pool's dispatcher runs its lanes under the machine's cap. The pool's configuration (ADR-1066 D2 G):
// the pool is a general capability, its own story Agent runner (ADR-1071 D3), and each machine that runs it configures it
// in its own machine file, ~/.storytree/agent-pool.json (ADR-1179), or the file AGENT_POOL_CONFIG names, never in
// storytree's repository (ADR-1216 D1). Every field may be left out:
// - machine: the ssh host the pool runs on, which a hand-over from any other machine reaches; none, and a hand-over
//   works only on the pool's own machine (or through the library).
// - checkout: the shared checkout every lane's worktree is cut from and the watcher runs from; by default this one.
// - machineCheckout: the pool's checkout on `machine`, as written there (its own `~`), where a hand-over over ssh runs;
//   by default `checkout`, as on the pool's own machine.
// - lanes: the folder of briefs, logs, hand-offs and the pool's controls; by default ~/.storytree/agent-pool.
// - briefs: a folder whose pool-brief.md, pool-brief-plan.md, pool-brief-read-only.md or pool-brief-project.md, where it holds one, a lane is
//   briefed with in place of the one beside this file; by default none.
// - addDirs: folders each engine may write besides its worktree (the lanes folder is always one).
// - sessions: pins the cap on engines running at once (the lanes folder's night-max-lanes overrides it live); by default
//   none, and the cap is what the machine's cores and memory allow (readCap, ADR-1142).
// - laneMemory: the memory each lane's scope may use (systemd's MemoryMax: bytes, or a size such as "12G"), past which
//   the kernel kills that lane alone (runner 1.27); by default the machine's memory less every other lane's share (laneMemoryMax).
// - engines: { codex: { model }, claude: { model }, switchAt }: the model each engine runs (none, the engine's own
//   default) and the share of Codex's weekly allowance at which lanes switch to Claude (by default 100, when it is spent).
// - identity: { name, email }: who a lane's commits are by when its environment sets no git identity; by default none,
//   and git's own configuration decides.
// - watcher: { fixesPerRed, fixesPerPullRequest, intervalSeconds }: fix sessions per red, per pull request, and the
//   seconds between looks; by default 2, 6 and 60.
// - machineOnly: true, and the dispatcher takes only work whose machine field names this machine, and plans no arc,
//   leaving untagged work to the shared pool (ADR-1179 D2), and starts a lane only while plugged in and while the library
//   and GitHub answer (D3); by default false. windows/register-laptop-pool.ps1 writes a laptop's.
// - projects: [{ name, checkout, checks, review }]: the storytree projects whose ready work the pool offers, each lane started
//   in its project's checkout on this machine; storytree's may leave its checkout out (it is `checkout`), any other must name
//   one. Another project's lanes are briefed with its `checks`, the commands its lane runs before it opens a pull request,
//   in order, and its `review`, what its lane does to have its change reviewed (pool-brief-project.md). By default, or
//   empty, storytree alone.
// - cloud: { enabled, cap, trigger }: the trial overflow into Claude Code cloud sessions while the box is saturated
//   (ADR-1264, cloud.mjs): switched on only by `enabled: true`, at most `cap` cloud lanes at once (by default 2), fired
//   through the cloud task's API trigger `trigger` (a trig_ id; or CLOUD_TRIGGER_ID in ~/.storytree/secrets.json, beside
//   its token CLOUD_TRIGGER_TOKEN); by default off.
// The running dispatcher reads projects and sessions again as it runs, so an edit to either reaches its next survey; an
// edit to any other field restarts it once its running lanes end (3.39).
// `~` is the home folder of the machine reading the file. The environment variables the pool read before
// (LANES_DIR, CODEX_STOP_AT, WATCH_BOX_HOST, WATCH_FIX_LIMIT, WATCH_FIX_CAP, WATCH_INTERVAL_S) still override it.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { availableParallelism, homedir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this code is in. */
const HERE = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
/** The machine file a machine configures its pool in, under its `home`. */
export const configFile = (home = homedir()) => join(home, ".storytree", "agent-pool.json");

function readConfig(file) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`could not read the agent pool's configuration ${file}: ${error.message}`); }
}

const number = (...values) => values.map((value) => (value === undefined || value === "" ? NaN : Number(value))).find((value) => Number.isFinite(value));

/**
 * The pool's settings on this machine: its configuration file's fields (`file`, the one read) over the general defaults, `~` read as `home`,
 * and the environment's overrides over both. `remoteCheckout` is the checkout as written, for a shell on the pool's
 * machine to read its own `~`.
 */
export function poolConfig({ home = homedir(), env = process.env, file = env.AGENT_POOL_CONFIG || configFile(home) } = {}) {
  const raw = readConfig(file);
  const local = (path) => (path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path);
  const lanesDir = env.LANES_DIR || local(raw.lanes ?? "~/.storytree/agent-pool");
  const watcher = raw.watcher ?? {};
  return {
    file,
    machine: env.WATCH_BOX_HOST || raw.machine || undefined,
    checkout: local(raw.checkout ?? HERE),
    remoteCheckout: raw.machineCheckout ?? raw.checkout ?? HERE,
    lanesDir,
    briefsDir: raw.briefs ? local(raw.briefs) : undefined,
    addDirs: [...(raw.addDirs ?? []).map(local), lanesDir],
    sessions: number(raw.sessions),
    ...(raw.laneMemory ? { laneMemory: raw.laneMemory } : {}),
    models: { codex: raw.engines?.codex?.model, claude: raw.engines?.claude?.model },
    switchAt: number(env.CODEX_STOP_AT, raw.engines?.switchAt) ?? 100,
    identity: raw.identity?.name && raw.identity?.email ? { name: raw.identity.name, email: raw.identity.email } : undefined,
    watcher: {
      fixesPerRed: number(env.WATCH_FIX_LIMIT, watcher.fixesPerRed) ?? 2,
      fixesPerPullRequest: number(env.WATCH_FIX_CAP, watcher.fixesPerPullRequest) ?? 6,
      intervalMs: (number(env.WATCH_INTERVAL_S, watcher.intervalSeconds) ?? 60) * 1000,
    },
    machineOnly: raw.machineOnly === true,
    cloud: { enabled: raw.cloud?.enabled === true, cap: number(raw.cloud?.cap) ?? 2, ...(raw.cloud?.trigger ? { trigger: raw.cloud.trigger } : {}) },
    projects: raw.projects?.length ? raw.projects.map((project) => projectOf(project, local)) : [{ name: "storytree" }],
  };
}

/** One project the pool serves: its name, its checkout when it is not the pool's own (storytree's), and its checks and review when it names them. */
function projectOf({ name, checkout, checks, review }, local) {
  if (!checkout && name !== "storytree") throw new Error(`the agent pool's configuration: project ${name} names no checkout`);
  return { name, ...(checkout ? { checkout: local(checkout) } : {}), ...(checks?.length ? { checks } : {}), ...(review ? { review } : {}) };
}

/** What one lane takes at its peak (an engine, its tests' Postgres, at times a headless browser), until it is measured. */
export const LANE = { cores: 2, memoryBytes: 3 * 1024 ** 3 };

/**
 * The cap on engines running at once (ADR-1142): night-max-lanes when it holds a number, else the configured `sessions`,
 * else what the machine's size allows, the smaller of its cores and its memory per lane, and never less than one.
 */
export async function readCap({ lanesDir, sessions, box = { cores: availableParallelism(), memoryBytes: totalmem() }, lane = LANE,
  readText = (path) => readFile(path, "utf8") }) {
  const pinned = Number((await readText(join(lanesDir, "night-max-lanes")).catch(() => "")).trim());
  return pinned || sessions || Math.max(1, Math.min(Math.floor(box.cores / lane.cores), Math.floor(box.memoryBytes / lane.memoryBytes)));
}

/**
 * The memory one lane's scope may use (runner 1.27): `laneMemory` when the configuration names it, else the machine's
 * memory less what every other lane under the cap takes at its peak, and never less than one lane's peak.
 */
export async function laneMemoryMax({ laneMemory, lanesDir, sessions, box = { cores: availableParallelism(), memoryBytes: totalmem() }, lane = LANE,
  readText = (path) => readFile(path, "utf8") }) {
  if (laneMemory) return String(laneMemory);
  const cap = await readCap({ lanesDir, sessions, box, lane, readText });
  return String(Math.max(lane.memoryBytes, box.memoryBytes - (cap - 1) * lane.memoryBytes));
}
