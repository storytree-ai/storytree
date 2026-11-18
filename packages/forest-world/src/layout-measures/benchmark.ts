// Capability 6 · Layout and routing time and memory measured
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import type { ForestScene } from "../scene.js";
import type { PlanetSpot } from "../planet/planet.js";
import { pathwayRouting, routePlanet } from "../planet/pathways.js";

export type LayoutSeed = "five-story-row" | "code-survey";

export interface Spread {
  readonly median: number;
  readonly spread: number;
}

export interface LayoutBenchmark {
  readonly seed: LayoutSeed;
  readonly runs: number;
  readonly islands: number;
  readonly lanes: number;
  readonly layout: Spread;
  readonly routing: Spread;
  readonly peak: Spread;
}

interface RunReading {
  readonly islands: number;
  readonly lanes: number;
  readonly layout: number;
  readonly routing: number;
  readonly peak: number;
}

interface Seed {
  readonly scene: ForestScene;
  readonly spots: [string, PlanetSpot][];
  readonly radius: number;
}

const SELF = fileURLToPath(import.meta.url);

const SEED_FILES: Readonly<Record<LayoutSeed, string>> = {
  "five-story-row": "five-story-row.json",
  "code-survey": "code-survey.json.gz",
};

function isSeed(name: string): name is LayoutSeed {
  return Object.hasOwn(SEED_FILES, name);
}

function spreadOf(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, spread: sorted[sorted.length - 1]! - sorted[0]! };
}

async function readSeed(seed: LayoutSeed): Promise<Seed> {
  const file = SEED_FILES[seed];
  const bytes = await readFile(path.join(path.dirname(SELF), "seeds", file));
  const text = file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return JSON.parse(text) as Seed;
}

async function layOutHere(seed: LayoutSeed): Promise<RunReading> {
  const { scene, spots, radius } = await readSeed(seed);
  const spotsBy = new Map(spots);
  const layoutStarted = performance.now();
  const charted = pathwayRouting(scene, spotsBy, radius);
  const layout = performance.now() - layoutStarted;
  if (charted === undefined) return { islands: scene.islands.length, lanes: 0, layout, routing: 0, peak: process.resourceUsage().maxRSS / 1024 };
  const routingStarted = performance.now();
  const network = routePlanet(charted.routing);
  const routing = performance.now() - routingStarted;
  return { islands: scene.islands.length, lanes: network.lanes.edges.length, layout, routing, peak: process.resourceUsage().maxRSS / 1024 };
}

function layOutOnce(seed: LayoutSeed): Promise<RunReading> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), SELF, seed], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`A layout run exited with ${code}: ${Buffer.concat(err).toString()}`));
      else resolve(JSON.parse(Buffer.concat(out).toString().trim().split("\n").at(-1)!) as RunReading);
    });
  });
}

export async function layoutBenchmark({ seed, runs }: { seed: string; runs: number }): Promise<LayoutBenchmark> {
  if (!isSeed(seed)) throw new Error(`Cannot benchmark seed ${seed}: it is none of ${Object.keys(SEED_FILES).join(", ")}.`);
  const readings: RunReading[] = [];
  for (let at = 0; at < runs; at += 1) readings.push(await layOutOnce(seed));
  return {
    seed,
    runs,
    islands: readings[0]?.islands ?? 0,
    lanes: readings[0]?.lanes ?? 0,
    layout: spreadOf(readings.map(({ layout }) => layout)),
    routing: spreadOf(readings.map(({ routing }) => routing)),
    peak: spreadOf(readings.map(({ peak }) => peak)),
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === SELF) {
  const [seed] = process.argv.slice(2) as [LayoutSeed];
  process.stdout.write(`${JSON.stringify(await layOutHere(seed))}\n`);
}
