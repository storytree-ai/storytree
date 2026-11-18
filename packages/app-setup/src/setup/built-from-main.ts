// Capability 18 · Built commands.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { storytreeHome } from "@storytree/project-and-caller";
import { defaultHomes, registeredHookScripts, type Homes } from "@storytree/session-management";

export interface HookCommand {
  readonly node: string;
  readonly script: string;
}

export interface FollowMainOptions {
  readonly checkout: string;
  readonly storytreeHome?: string;
  readonly homes?: Homes;
  readonly build?: (outdir: string) => Promise<unknown>;
}

const KEPT = 3;

const APP_PAYLOAD = /[\\/](resources[\\/]agent-tools|app-tools[\\/][^\\/]+)[\\/]/;

export async function builtFromMain(options: FollowMainOptions): Promise<HookCommand | undefined> {
  const head = commit(options.checkout, "HEAD");
  if (head === undefined) return undefined;
  if (registeredHookScripts(options.homes ?? defaultHomes()).some((script) => APP_PAYLOAD.test(script))) return undefined;
  if (head !== commit(options.checkout, "refs/remotes/origin/main") && head !== originMain(options.checkout)) return undefined;
  const builds = path.join(options.storytreeHome ?? storytreeHome(), "agent-tools");
  const dir = path.join(builds, head);
  const script = path.join(dir, "storytree-hook.mjs");
  if (!existsSync(script)) {
    const building = `${dir}.building-${process.pid}`;
    try {
      await (options.build ?? buildBins)(building);
      renameSync(building, dir);
    } catch (error) {
      if (!existsSync(script)) throw error;
    } finally {
      rmSync(building, { recursive: true, force: true });
    }
    prune(builds, head);
  }
  return { node: process.execPath, script };
}

function commit(checkout: string, ref: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const ORIGIN_ASK_MS = 10_000;

function originMain(checkout: string): string | undefined {
  try {
    const listed = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: ORIGIN_ASK_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return listed.split(/\s/)[0] || undefined;
  } catch {
    return undefined;
  }
}

function prune(builds: string, current: string): void {
  try {
    const older = readdirSync(builds)
      .filter((name) => name !== current && !name.includes(".building-"))
      .map((name) => ({ name, at: statSync(path.join(builds, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(KEPT - 1);
    for (const { name } of older) rmSync(path.join(builds, name), { recursive: true, force: true });
  } catch {
  }
}

async function buildBins(outdir: string): Promise<unknown> {
  const source = new URL("../bins/build.ts", import.meta.url).href;
  const { buildBins: build } = (await import(source)) as { buildBins: (outdir: string) => Promise<unknown> };
  const built = await build(outdir);
  linkEmbeddingRuntime(outdir);
  return built;
}

function linkEmbeddingRuntime(outdir: string): void {
  const library = createRequire(fileURLToPath(import.meta.resolve("@storytree/library")));
  const name = "@huggingface/transformers";
  const installed = (library.resolve.paths(name) ?? []).map((modules) => path.join(modules, name)).find((dir) => existsSync(path.join(dir, "package.json")));
  if (installed === undefined) throw new Error(`the checkout has no ${name} installed: run pnpm install`);
  const link = path.join(outdir, "node_modules", name);
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(realpathSync(installed), link, "junction");
}
