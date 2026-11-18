// Capability 3 · The pool's dispatcher runs its lanes under the machine's cap.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { availableParallelism, homedir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
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
    cloud: { enabled: raw.cloud?.enabled === true, cap: number(raw.cloud?.cap) ?? 2, ...(raw.cloud?.trigger ? { trigger: raw.cloud.trigger } : {}), ...(raw.cloud?.reviews === true ? { reviews: true } : {}) },
    projects: raw.projects?.length ? raw.projects.map((project) => projectOf(project, local)) : [{ name: "storytree" }],
  };
}

function projectOf({ name, checkout, checks, review }, local) {
  if (!checkout && name !== "storytree") throw new Error(`the agent pool's configuration: project ${name} names no checkout`);
  return { name, ...(checkout ? { checkout: local(checkout) } : {}), ...(checks?.length ? { checks } : {}), ...(review ? { review } : {}) };
}

export const LANE = { cores: 2, memoryBytes: 3 * 1024 ** 3 };

export async function readCap({ lanesDir, sessions, box = { cores: availableParallelism(), memoryBytes: totalmem() }, lane = LANE,
  readText = (path) => readFile(path, "utf8") }) {
  const pinned = Number((await readText(join(lanesDir, "night-max-lanes")).catch(() => "")).trim());
  return pinned || sessions || Math.max(1, Math.min(Math.floor(box.cores / lane.cores), Math.floor(box.memoryBytes / lane.memoryBytes)));
}

export async function laneMemoryMax({ laneMemory, lanesDir, sessions, box = { cores: availableParallelism(), memoryBytes: totalmem() }, lane = LANE,
  readText = (path) => readFile(path, "utf8") }) {
  if (laneMemory) return String(laneMemory);
  const cap = await readCap({ lanesDir, sessions, box, lane, readText });
  return String(Math.max(lane.memoryBytes, box.memoryBytes - (cap - 1) * lane.memoryBytes));
}
