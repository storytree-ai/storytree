// Capability 2 · Quick tier
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scaled } from "@storytree/test-waits";

export const DEFAULT_SEEDS: readonly number[] = [20261117, 31337, -8675309];

export const QUICK_RUNS = 100;

const CHECK_BUDGET_MS = 2_000;
const PACKAGE_BUDGET_MS = 30_000;

export type Env = Readonly<Record<string, string | undefined>>;

function packageOf(file: string): string {
  return /(?:^|[\\/])packages[\\/]([^\\/]+)/.exec(file)?.[1] ?? "root";
}

const inProcess = new Map<string, number>();

export function addToTally(ms: number, file: string, env: Env, tallyPath?: string): number {
  const where = tallyPath ?? (env.STORYTREE_TEST_RUNNING ? path.join(tmpdir(), `storytree-property-tally-${packageOf(file)}`) : undefined);
  if (where === undefined) {
    const total = (inProcess.get(packageOf(file)) ?? 0) + ms;
    inProcess.set(packageOf(file), total);
    return total;
  }
  appendFileSync(where, `${ms}\n`);
  return readFileSync(where, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line), 0);
}

export function overBudget(ms: number, packageMs: number, platform: NodeJS.Platform): string | undefined {
  const check = scaled(CHECK_BUDGET_MS, platform);
  if (ms > check) return `This check took ${ms / 1000} s, over its quick-tier budget of ${check / 1000} s: narrow its arbitraries or lower its runs.`;
  const pkg = scaled(PACKAGE_BUDGET_MS, platform);
  if (packageMs > pkg) return `This check took its package's property checks to ${packageMs / 1000} s, over the package budget of ${pkg / 1000} s: narrow some checks or lower their runs.`;
  return undefined;
}

let head: string | undefined;

export function record(row: Record<string, unknown>, env: Env, recordPath?: string): void {
  if (!env.STORYTREE_TEST_RUNNING) return;
  const where = recordPath ?? path.join(process.cwd(), ".pgtest", "property-runs.jsonl");
  head ??= execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  if (!existsSync(path.dirname(where))) mkdirSync(path.dirname(where), { recursive: true });
  appendFileSync(where, `${JSON.stringify({ head, ...row })}\n`);
}
