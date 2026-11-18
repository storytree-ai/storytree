// Capability 3 · Nightly tier
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NIGHTLY_FACTOR = 100;

export const NIGHTLY_LIMIT_MS = 60_000;

const UNIT_LIMIT_MS = 10 * 60_000;

export function freshSeed(taken: readonly number[]): number {
  let seed: number;
  do seed = (Date.now() ^ (Math.random() * 0x1_0000_0000)) | 0;
  while (taken.includes(seed));
  return seed;
}

export function pinAdvice(seed: number): string {
  return `It was found on a fresh seed by the nightly tier: pin ${seed} into this check's seeds ({ seeds: [${seed}] }) so the quick tier runs it on every build.`;
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const IMPORTS = /["']@storytree\/property-checks["']/;

export function findCheckFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TEST_FILE.test(entry.name) && IMPORTS.test(readFileSync(full, "utf8"))) found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

export interface NightlyOptions {
  readonly root: string;
  readonly run: (command: string, args: string[], env: Record<string, string | undefined>) => number | Promise<number>;
  readonly log: (line: string) => void;
}

export async function runNightly({ root, run, log }: NightlyOptions): Promise<number> {
  const files = findCheckFiles(root);
  if (files.length === 0) {
    log("No property checks: no test file imports @storytree/property-checks, so the nightly run has nothing to run.");
    return 0;
  }
  log(`The nightly tier runs ${files.length} file(s) holding property checks: ${files.join(", ")}`);
  return run("pnpm", ["test", ...files], { ...process.env, STORYTREE_PROPERTY_TIER: "nightly", STORYTREE_UNIT_LIMIT_MS: String(UNIT_LIMIT_MS) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  process.exitCode = await runNightly({
    root,
    run: (command, args, env) =>
      new Promise((resolve) =>
        spawn(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" }).on("close", (code) => resolve(code ?? 1)),
      ),
    log: (line) => console.log(line),
  });
}
