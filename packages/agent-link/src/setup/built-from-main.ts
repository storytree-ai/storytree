/**
 * Capability 8 · Setup check. Hooks that follow main on a machine with no desktop app (contract 8.15). The app's updater keeps
 * the hooks it installed current; a machine without it (the Mint box) had hooks built once from a
 * checkout and never again (friction_c5bb32266a84). So a tool server run from a checkout's source,
 * which has no built hook script beside it, builds the checkout's commit into the storytree home
 * when that commit is origin/main's, and the setup check registers that build: a merge to main
 * reaches the hooks at the next session started on it.
 *
 * A checkout off main (a branch with work on it) builds nothing: its hooks are not what every session
 * on the machine should run. Hooks the app installed stay the app's.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { storytreeHome } from "../routing/index.js";
import { defaultHomes, registeredHookScripts, type HookCommand, type Homes } from "./hooks-config.js";

export interface FollowMainOptions {
  /** The checkout the tool server runs from. */
  readonly checkout: string;
  /** The storytree home, whose agent-tools folder keeps the builds. By default, storytreeHome(). */
  readonly storytreeHome?: string;
  /** Where the harnesses keep their settings, to see whether the app installed the hooks. */
  readonly homes?: Homes;
  /** How to build the agent link's commands into a folder; by default, buildBins. */
  readonly build?: (outdir: string) => Promise<unknown>;
}

/** How many builds are kept: a hook already running from an older one may still load its chunks. */
const KEPT = 3;

/** The hook script the app installs: it lives in the app's resources/agent-tools folder. */
const APP_PAYLOAD = /[\\/]resources[\\/]agent-tools[\\/]/;

/** The hook command built from `checkout`'s commit when it is origin/main's, building it if it is not built yet; otherwise undefined. */
export async function builtFromMain(options: FollowMainOptions): Promise<HookCommand | undefined> {
  const head = commit(options.checkout, "HEAD");
  if (head === undefined || head !== commit(options.checkout, "refs/remotes/origin/main")) return undefined;
  if (registeredHookScripts(options.homes ?? defaultHomes()).some((script) => APP_PAYLOAD.test(script))) return undefined;
  const builds = path.join(options.storytreeHome ?? storytreeHome(), "agent-tools");
  const dir = path.join(builds, head);
  const script = path.join(dir, "storytree-hook.mjs");
  if (!existsSync(script)) {
    // Built beside, then moved into place: a hook never runs a half-written build, and two sessions starting at once both end with one.
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

/** The commit `ref` names in `checkout`, or undefined where git cannot say. */
function commit(checkout: string, ref: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Remove all but the newest builds, never `current`. */
function prune(builds: string, current: string): void {
  try {
    const older = readdirSync(builds)
      .filter((name) => name !== current && !name.includes(".building-"))
      .map((name) => ({ name, at: statSync(path.join(builds, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(KEPT - 1);
    for (const { name } of older) rmSync(path.join(builds, name), { recursive: true, force: true });
  } catch {
    // Old builds left behind cost disk, never a session.
  }
}

/** The agent link's own build, loaded only here: a bundled command never builds itself, and never carries esbuild. */
async function buildBins(outdir: string): Promise<unknown> {
  const source = new URL("../bins/build.ts", import.meta.url).href;
  const { buildBins: build } = (await import(source)) as { buildBins: (outdir: string) => Promise<unknown> };
  const built = await build(outdir);
  linkEmbeddingRuntime(outdir);
  return built;
}

/**
 * The build leaves the embedding runtime (transformers.js and its native ONNX Runtime) outside its
 * bundle; the app's payload carries a copy, but a build of main has no app. It is linked to the
 * checkout's own install instead, which is there for as long as the checkout's tool server runs:
 * without it ranked search would fall back to words (friction_35d68b222871).
 */
function linkEmbeddingRuntime(outdir: string): void {
  const library = createRequire(fileURLToPath(import.meta.resolve("@storytree/library")));
  const name = "@huggingface/transformers";
  // Its exports hide package.json, so the package is found on the paths Node would look in.
  const installed = (library.resolve.paths(name) ?? []).map((modules) => path.join(modules, name)).find((dir) => existsSync(path.join(dir, "package.json")));
  if (installed === undefined) throw new Error(`the checkout has no ${name} installed: run pnpm install`);
  const link = path.join(outdir, "node_modules", name);
  mkdirSync(path.dirname(link), { recursive: true });
  // From its real folder, it resolves its own dependencies (ONNX Runtime, sharp) where pnpm put them. A junction needs no administrator on Windows.
  symlinkSync(realpathSync(installed), link, "junction");
}
