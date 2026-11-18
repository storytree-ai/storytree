// Capability 10 · Survey run time and memory measured
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { AnnotatedTree } from "@storytree/library";

const run = promisify(execFile);

export interface Spread {
  readonly median: number;
  readonly spread: number;
}

export interface SurveyBenchmark {
  readonly commit: string;
  readonly runs: number;
  readonly stories: number;
  readonly wall: Spread;
  readonly cpu: Spread;
  readonly peak: Spread;
}

interface RunReading {
  readonly stories: number;
  readonly wall: number;
  readonly cpu: number;
  readonly peak: number;
}

const SURVEY_RUN = fileURLToPath(new URL("./survey-run.ts", import.meta.url));

function spreadOf(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, spread: sorted[sorted.length - 1]! - sorted[0]! };
}

async function extract(folder: string, commit: string, into: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const archive = spawn("git", ["archive", commit], { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-x", "-C", into], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: string[] = [];
    archive.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
    tar.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
    archive.stdout.pipe(tar.stdin);
    let left = 2;
    const done = (code: number | null) => {
      if (code !== 0) reject(new Error(`Could not extract ${commit} from ${folder}: ${errors.join("")}`));
      else if (--left === 0) resolve();
    };
    archive.on("error", reject);
    tar.on("error", reject);
    archive.on("close", done);
    tar.on("close", done);
  });
}

function surveyOnce(folder: string, treeFile: string): Promise<RunReading> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), SURVEY_RUN, folder, treeFile], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`A survey run exited with ${code}: ${Buffer.concat(err).toString()}`));
      else resolve(JSON.parse(Buffer.concat(out).toString().trim().split("\n").at(-1)!) as RunReading);
    });
  });
}

export async function surveyBenchmark({ folder, commit, tree, runs }: { folder: string; commit: string; tree: AnnotatedTree; runs: number }): Promise<SurveyBenchmark> {
  const sha = await run("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`], { cwd: folder }).then(
    ({ stdout }) => stdout.trim(),
    () => {
      throw new Error(`Cannot benchmark commit ${commit}: it is no commit in ${folder}.`);
    },
  );
  const checkout = await mkdtemp(path.join(tmpdir(), "survey-benchmark-checkout-"));
  const planned = await mkdtemp(path.join(tmpdir(), "survey-benchmark-plan-"));
  try {
    await extract(folder, sha, checkout);
    const treeFile = path.join(planned, "tree.json");
    await writeFile(treeFile, JSON.stringify(tree));
    const readings: RunReading[] = [];
    for (let at = 0; at < runs; at += 1) readings.push(await surveyOnce(checkout, treeFile));
    return {
      commit: sha,
      runs,
      stories: readings[0]?.stories ?? 0,
      wall: spreadOf(readings.map(({ wall }) => wall)),
      cpu: spreadOf(readings.map(({ cpu }) => cpu)),
      peak: spreadOf(readings.map(({ peak }) => peak)),
    };
  } finally {
    await Promise.all([rm(checkout, { recursive: true, force: true }), rm(planned, { recursive: true, force: true })]);
  }
}
