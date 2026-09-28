/**
 * Capability 4 · Updates: the app follows merged main (contracts 4.1 and 4.2, ADR-0637 D2, the
 * half for storytree 0.3's own development).
 *
 * The app on the owner's machine runs from a runtime folder of its own (~/.storytree/0.3/runtime):
 * a bare clone of the repository (`repo.git`) and two build slots, `a` and `b`, each a git worktree
 * of it. The app runs from one slot. When `main` on the origin moves, main's new commit is checked
 * out and built in the OTHER slot, so the running app is never touched, and the app then restarts
 * into it. Only `main` is ever fetched or checked out, so work not merged to main is never run, and
 * a build that fails leaves the running slot as it was.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Slot = "a" | "b";

/** A built slot: where it is, and the commit of main it was built at. */
export interface RunningBuild {
  readonly slot: Slot;
  readonly dir: string;
  readonly sha: string;
}

/** Builds the app in a slot's folder (in the app, installs and bundles it). */
export type Build = (dir: string) => Promise<void>;

export interface SetUpOptions {
  /** The runtime folder: ~/.storytree/0.3/runtime */
  runtimeDir: string;
  /** Where the repository comes from: its URL, or a folder. */
  origin: string;
  build: Build;
}

/** First use: clone the repository, and build main's commit in slot `a`. */
export async function setUpRuntime({ runtimeDir, origin, build }: SetUpOptions): Promise<RunningBuild> {
  const repo = repoDir(runtimeDir);
  if (!existsSync(repo)) {
    mkdirSync(runtimeDir, { recursive: true });
    await git(runtimeDir, "clone", "--quiet", "--bare", "--single-branch", "--branch", "main", origin, repo);
  }
  const sha = await fetchMain(repo);
  return buildInSlot(runtimeDir, "a", sha, build);
}

export interface UpdateOptions {
  runtimeDir: string;
  /** The slot the app is running from. */
  running: RunningBuild;
  build: Build;
  /** Main has moved; report the build before work begins in the other slot. */
  onBuilding?: (sha: string) => void;
}

/**
 * Fetch main; if it has moved past the running build, check out its new commit in the other slot
 * and build it there. Returns the new build to restart into, or undefined when main has not moved.
 * A failed build rejects, and the running slot is untouched.
 */
export async function updateToMain({ runtimeDir, running, build, onBuilding }: UpdateOptions): Promise<RunningBuild | undefined> {
  const sha = await fetchMain(repoDir(runtimeDir));
  if (sha === running.sha) return undefined;
  onBuilding?.(sha);
  return buildInSlot(runtimeDir, running.slot === "a" ? "b" : "a", sha, build);
}

/** Which slot a folder is in, if it is inside one of the runtime's two. */
export function slotOf(runtimeDir: string, dir: string): Slot | undefined {
  const inside = path.resolve(dir).toLowerCase();
  return (["a", "b"] as const).find((slot) => {
    const slotDir = path.resolve(runtimeDir, slot).toLowerCase();
    return inside === slotDir || inside.startsWith(`${slotDir}${path.sep}`);
  });
}

/** The app's folder inside a slot, which Electron is started on. */
export function appDirIn(slotDir: string): string {
  return path.join(slotDir, "apps", "desktop");
}

/** The Electron executable a slot installed (electron's own path.txt names it). */
export function electronIn(slotDir: string): string {
  const electron = path.join(appDirIn(slotDir), "node_modules", "electron");
  return path.join(electron, "dist", readFileSync(path.join(electron, "path.txt"), "utf8").trim());
}

/**
 * The real build: install the slot's packages, fetch Electron's own binary (its install script,
 * which pnpm does not run here; it does nothing once the binary is there), then bundle the app, as
 * `pnpm desktop` does.
 */
export async function buildApp(dir: string): Promise<void> {
  await pnpm(dir, "install", "--frozen-lockfile");
  // Run as Node whether this is Node or the app's own Electron.
  await run(process.execPath, [path.join(appDirIn(dir), "node_modules", "electron", "install.js")], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  await pnpm(dir, "--filter", "@storytree/desktop", "build");
}

/** The commit a slot has checked out. */
export async function slotSha(dir: string): Promise<string> {
  return git(dir, "rev-parse", "HEAD");
}

function repoDir(runtimeDir: string): string {
  return path.join(runtimeDir, "repo.git");
}

/** Fetch main from the origin (and nothing else), and return its commit. */
async function fetchMain(repo: string): Promise<string> {
  await git(repo, "fetch", "--quiet", "origin", "+refs/heads/main:refs/heads/main");
  return git(repo, "rev-parse", "refs/heads/main");
}

async function buildInSlot(runtimeDir: string, slot: Slot, sha: string, build: Build): Promise<RunningBuild> {
  const dir = path.join(runtimeDir, slot);
  if (existsSync(dir)) await git(dir, "checkout", "--quiet", "--force", "--detach", sha);
  else await git(repoDir(runtimeDir), "worktree", "add", "--quiet", "--force", "--detach", dir, sha);
  await build(dir);
  return { slot, dir, sha };
}

async function pnpm(cwd: string, ...args: string[]): Promise<void> {
  // pnpm is a .cmd on Windows, which only a shell can run.
  const options = { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 } as const;
  if (process.platform === "win32") await run(["pnpm", ...args].join(" "), [], { ...options, shell: true });
  else await run("pnpm", args, options);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return stdout.trim();
}
