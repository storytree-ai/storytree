// Capability 3 · The dispatcher's pace (ADR-1139, which replaces ADR-1056 D3's rate-limit pacing): a new lane is held back only
// while the box itself is saturated, so one more lane would slow every lane. Claude's and Codex's usage never hold it back.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Really maxed, not merely busy: a run queue half again the cores, 5% of memory or less free, a GPU 95% busy or full. */
export const SATURATED = { loadPerCore: 1.5, memoryFree: 0.05, gpu: 0.95 };

/**
 * The hold a box reading calls for: a pause naming each saturated part with its reading, else undefined. A part not read
 * (no /proc, no working nvidia-smi) holds nothing back. `reading`: { cores, load5, memTotal, memAvailable, gpus: [{ util, memUsed, memTotal }] }.
 */
export function saturationOf(reading, limits = SATURATED) {
  const full = [];
  const { cores, load5, memTotal, memAvailable, gpus = [] } = reading;
  if (cores && Number.isFinite(load5) && load5 / cores >= limits.loadPerCore) full.push(["cpu", `CPU load ${load5.toFixed(1)} on ${cores} cores`]);
  if (memTotal && Number.isFinite(memAvailable) && memAvailable / memTotal <= limits.memoryFree) {
    full.push(["memory", `memory ${Math.round(100 * (1 - memAvailable / memTotal))}% used`]);
  }
  gpus.forEach(({ util, memUsed, memTotal: gpuTotal }, i) => {
    if (util >= 100 * limits.gpu || (gpuTotal && memUsed / gpuTotal >= limits.gpu)) {
      full.push([`gpu${i}`, `GPU ${i} ${util}% busy, memory ${Math.round(100 * memUsed / gpuTotal)}% used`]);
    }
  });
  if (!full.length) return undefined;
  return { hold: "pause", windows: full.map(([kind]) => kind), reason: `box saturated: ${full.map(([, said]) => said).join(", ")}` };
}

const nvidiaSmi = async () => (await run("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { timeout: 10_000 })).stdout;

/** The box's saturation now, read from /proc/loadavg, /proc/meminfo and nvidia-smi; each source that fails is left unread. */
export async function readBoxPace({ cores = availableParallelism(), readText = (path) => readFile(path, "utf8"), nvidia = nvidiaSmi } = {}) {
  const [load, memory, gpu] = await Promise.all([readText("/proc/loadavg"), readText("/proc/meminfo"), nvidia()].map((p) => p.catch(() => "")));
  const kB = (name) => Number(memory.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1]);
  const gpus = gpu.split("\n").map((line) => line.split(",").map(Number)).filter((parts) => parts.length === 3 && parts.every(Number.isFinite))
    .map(([util, memUsed, memTotal]) => ({ util, memUsed, memTotal }));
  return saturationOf({ cores, load5: Number(load.split(/\s+/)[1]), memTotal: kB("MemTotal"), memAvailable: kB("MemAvailable"), gpus });
}
