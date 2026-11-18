// Capability 4 · Sessions
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runGit } from "../activity/git.js";
import { due, projectTempFile, type MergeContext } from "../claims/merges.js";
import { startTeardown, teardownState } from "../claims/worktree-setup.js";
import { registeredHookScripts } from "../hooks/registered.js";
import { readSessions } from "./sessions.js";
import { changedAt, foldersInUse, gitWithin, holdsUnknownContent, reachableObjects, unlistedFolders } from "./worktree-leftovers.js";

export interface ReapWatch {
  readonly everyMs?: number;
  readonly protect?: readonly string[];
  readonly empty?: (trash: string) => void;
  readonly budgetMs?: number;
  readonly idleMs?: number;
  readonly nameOf?: (pid: number, timeoutMs: number) => string;
  readonly inUse?: () => readonly string[] | undefined;
}

const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
const IDLE_MS = 24 * 60 * 60_000;
const RELEASE_MS = 2_000;
const TRASH = "storytree-reaped";

interface Worktree {
  folder: string;
  branch?: string;
  locked: boolean;
}

export async function reapWorktrees(context: MergeContext, watch: ReapWatch = {}): Promise<string[]> {
  if (!due(`${context.project}-worktrees`, watch.everyMs ?? EVERY_MS)) return [];
  const budgetMs = watch.budgetMs ?? BUDGET_MS;
  const git = (cwd: string, ...args: string[]) => runGit(args, { cwd, timeout: budgetMs }).trim();
  let trees: Worktree[];
  let checkout: string | undefined;
  let trash: string;
  let main: string;
  try {
    const listing = git(context.folder, "worktree", "list", "--porcelain");
    trees = linkedWorktrees(listing);
    checkout = mainCheckout(listing);
    trash = path.join(path.resolve(context.folder, git(context.folder, "rev-parse", "--git-common-dir")), TRASH);
    main = mainLine(context.folder, git);
  } catch {
    return [];
  }
  const protect = [context.folder, ...(watch.protect ?? defaultProtected())];
  const leftovers = checkout === undefined ? [] : unlistedFolders(path.join(checkout, ".claude", "worktrees"), trees.map((tree) => tree.folder)).filter((folder) => !protect.some((kept) => inside(folder, kept)));
  const users = await context.log.lines(context.project, { within: trees.map((tree) => tree.folder), latestBy: ["session"], omit: ["command", "files", "transcript"] });
  const sessions = users.length === 0 ? [] : await readSessions(context.log, context.project, { of: users.map((line) => line.session) });
  const inUse = (watch.inUse ?? foldersInUse)();
  const candidates = trees.filter((tree) => {
    if (tree.locked || protect.some((kept) => inside(tree.folder, kept))) return false;
    if (inUse?.some((cwd) => inside(tree.folder, cwd) && !inside(path.join(tree.folder, ".pgtest", "data"), cwd))) return false;
    const users = sessions.filter((session) => session.worktrees.some((folder) => inside(tree.folder, folder)));
    return users.length > 0 && users.every((session) => session.closeOut?.verified === true || session.archived || (inUse !== undefined && (session.state === "ended" || session.state === "gone")));
  });
  const looked = lookedAt(context.project);
  candidates.sort((a, b) => (looked[a.folder] ?? 0) - (looked[b.folder] ?? 0));
  const deadline = Date.now() + budgetMs;
  const reaped: Worktree[] = [];
  for (const tree of candidates) {
    if (Date.now() > deadline) break;
    looked[tree.folder] = Date.now();
    try {
      const torn = teardownState(tree.folder);
      if (torn !== "done" && git(tree.folder, "status", "--porcelain") !== "") continue;
      git(tree.folder, "merge-base", "--is-ancestor", "HEAD", main);
      if (torn === "due") startTeardown(tree.folder);
      if (torn === "due" || torn === "running") continue;
      const server = await stopTestServer(tree.folder, deadline, watch.nameOf ?? processName);
      if (server === "running") continue;
      mkdirSync(trash, { recursive: true });
      await renameReleased(tree.folder, trash, server === "stopped" ? Date.now() + RELEASE_MS : 0);
      reaped.push(tree);
    } catch {
    }
  }
  if (checkout !== undefined) reaped.push(...(await sweepLeftovers(context, leftovers, { checkout, trash, deadline, budgetMs, idleMs: watch.idleMs ?? IDLE_MS })));
  remember(context.project, looked, trees);
  const quietly = (...args: string[]) => {
    try {
      git(context.folder, ...args);
    } catch {
    }
  };
  if (reaped.length > 0) quietly("worktree", "prune");
  for (const { branch } of reaped) if (branch !== undefined) quietly("branch", "-D", branch);
  try {
    if (existsSync(trash) && readdirSync(trash).length > 0) (watch.empty ?? emptyInBackground)(trash);
  } catch {
  }
  return reaped.map((tree) => tree.folder);
}

async function sweepLeftovers(context: MergeContext, folders: readonly string[], pass: { checkout: string; trash: string; deadline: number; budgetMs: number; idleMs: number }): Promise<Worktree[]> {
  if (folders.length === 0) return [];
  const inUse = foldersInUse();
  if (inUse === undefined) return [];
  const since = Date.now() - pass.idleMs;
  const idle = folders.filter((folder) => !inUse.some((cwd) => inside(folder, cwd)) && changedAt(folder) < since);
  if (idle.length === 0) return [];
  const written = await context.log.lines(context.project, { within: idle, since: new Date(since).toISOString(), latestBy: ["folder"], omit: ["command", "files", "transcript"] });
  const git = gitWithin(pass.budgetMs);
  let gitDir: string;
  try {
    gitDir = path.resolve(pass.checkout, git(pass.checkout, ["rev-parse", "--git-common-dir"]));
  } catch {
    return [];
  }
  let objects: Set<string> | undefined;
  const reachable = () => (objects ??= reachableObjects(pass.checkout, git));
  const swept: Worktree[] = [];
  for (const folder of idle) {
    if (Date.now() > pass.deadline) break;
    if (written.some((line) => line.folder !== undefined && inside(folder, line.folder))) continue;
    try {
      if (holdsUnknownContent(folder, pass.checkout, gitDir, git, reachable)) continue;
      mkdirSync(pass.trash, { recursive: true });
      renameSync(folder, path.join(pass.trash, `${path.basename(folder)}-${Date.now()}`));
      swept.push({ folder: path.resolve(folder), locked: false });
    } catch {
    }
  }
  return swept;
}

async function renameReleased(folder: string, trash: string, until: number): Promise<void> {
  for (;;) {
    try {
      renameSync(folder, path.join(trash, `${path.basename(folder)}-${Date.now()}`));
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function stopTestServer(folder: string, deadline: number, nameOf: (pid: number, timeoutMs: number) => string): Promise<"none" | "stopped" | "running"> {
  let pid: number;
  try {
    pid = Number(readFileSync(path.join(folder, ".pgtest", "data", "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
  } catch {
    return "none";
  }
  let postgres = isPostgres(pid, deadline, nameOf);
  while (postgres === "unknown") {
    if (Date.now() > deadline) return "running";
    await new Promise((resolve) => setTimeout(resolve, 50));
    postgres = isPostgres(pid, deadline, nameOf);
  }
  if (!postgres) return "none";
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", timeout: 3_000, windowsHide: true });
    else process.kill(pid, "SIGQUIT");
  } catch {
  }
  while (isAlive(pid)) {
    if (Date.now() > deadline) return "running";
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return "stopped";
}

function isPostgres(pid: number, deadline: number, nameOf: (pid: number, timeoutMs: number) => string): boolean | "unknown" {
  if (!isAlive(pid)) return false;
  try {
    return /postgres/i.test(nameOf(pid, Math.max(1, deadline - Date.now())));
  } catch {
    return isAlive(pid) ? "unknown" : false;
  }
}

function processName(pid: number, timeoutMs: number): string {
  if (process.platform === "linux") return readFileSync(`/proc/${pid}/comm`, "utf8");
  const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs, windowsHide: true });
  if (process.platform === "win32") return run("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"]);
  return run("ps", ["-p", String(pid), "-o", "comm="]);
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function mainCheckout(listing: string): string | undefined {
  const fields = (listing.split(/\r?\n\r?\n/)[0] ?? "").split(/\r?\n/);
  const folder = fields.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
  return folder === undefined || fields.includes("bare") ? undefined : path.resolve(folder);
}

function linkedWorktrees(listing: string): Worktree[] {
  return listing.split(/\r?\n\r?\n/).slice(1).flatMap((block) => {
    const fields = block.split(/\r?\n/);
    const folder = fields.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
    if (folder === undefined || fields.includes("bare")) return [];
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    return [{ folder: path.resolve(folder), ...(branch === undefined ? {} : { branch }), locked: fields.some((field) => field === "locked" || field.startsWith("locked ")) }];
  });
}

function mainLine(cwd: string, git: (cwd: string, ...args: string[]) => string): string {
  for (const line of ["origin/HEAD", "origin/main"]) {
    try {
      return git(cwd, "rev-parse", "--abbrev-ref", line);
    } catch {
    }
  }
  return "main";
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultProtected(): string[] {
  return [...registeredHookScripts(), ...(process.argv[1] === undefined ? [] : [process.argv[1]])];
}

function lookedAt(project: string): Record<string, number> {
  try {
    const stored = JSON.parse(readFileSync(lookedFile(project), "utf8")) as unknown;
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function remember(project: string, looked: Record<string, number>, trees: readonly Worktree[]): void {
  try {
    writeFileSync(lookedFile(project), JSON.stringify(Object.fromEntries(trees.flatMap((tree) => (looked[tree.folder] === undefined ? [] : [[tree.folder, looked[tree.folder]]])))));
  } catch {
  }
}

function lookedFile(project: string): string {
  return projectTempFile("storytree-worktrees-", project, ".json");
}

export const EMPTY_TRASH = "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 3 })";

function emptyInBackground(trash: string): void {
  const child = spawn(process.execPath, ["-e", EMPTY_TRASH, trash], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
