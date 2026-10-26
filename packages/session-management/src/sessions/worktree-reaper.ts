/**
 * Capability 4 · Sessions: merged worktrees are reaped by the hooks once their sessions have left
 * (ADR-0790). Nothing else removes a worktree: `storytree workspace` and the Claude desktop app make
 * them, and a session's own worktree is its live folder, so close-out could never remove it.
 *
 * - A linked worktree of the project's repository on this machine (never the main checkout) goes only
 *   when every session whose lines name a folder in it has left (its close-out verified, ADR-0758
 *   D3, or archived by its app), at least one such session is known, it is clean with nothing
 *   untracked, its head is already in the main line as this clone last fetched it, it is not locked,
 *   and it holds neither the folder the hook runs in nor a registered hook script. Its branch goes
 *   with it. A test Postgres still running on its `.pgtest/data`, left by a run whose harness was
 *   killed outright, is stopped first; one that has not stopped by the pass's deadline keeps the
 *   worktree for the next pass. Once one is stopped, the rename is tried again for up to two seconds,
 *   because Windows releases a killed server's handles on the folder late.
 * - It is renamed into a trash folder in the git directory first: on Windows that fails while any
 *   process works inside it, which leaves a folder still in use unharmed. Then `git worktree prune`
 *   unregisters it, and the trash is emptied by a detached process with Node's recursive rmSync,
 *   which copes with the long `node_modules` paths `git worktree remove` fails on, so a hook never
 *   waits on it. Whatever is left in the trash is emptied again on the next pass.
 * - A folder under the main checkout's `.claude/worktrees` that git no longer lists (left by a removal
 *   that failed on Windows long paths) goes the same way once no process works in it, no session
 *   wrote there and the folder itself has not changed for a day, and it holds no file whose content
 *   git lacks (ADR-0790 D4). Links inside it, such as pnpm's junctions, are removed, never followed.
 * - A worktree storytree set up with teardown commands (capability 19, contract 19.4) has them run
 *   first, by a process of their own, once it would otherwise go: it stays until they have finished.
 * - It runs at most once a minute per project on each machine, for at most a few seconds, and never
 *   fails a hook: git refusing anything leaves that worktree for the next pass.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runGit } from "../activity/git.js";
import { due, projectTempFile, type MergeContext } from "../claims/merges.js";
import { startTeardown, teardownState } from "../claims/worktree-setup.js";
import { registeredHookScripts } from "../hooks/registered.js";
import { readSessions } from "./sessions.js";
import { changedAt, foldersInUse, gitWithin, holdsUnknownContent, reachableObjects, unlistedFolders } from "./worktree-leftovers.js";

/** How worktrees are reaped. */
export interface ReapWatch {
  /** How often a project is looked at, at most. By default, once a minute. */
  readonly everyMs?: number;
  /** Paths whose worktree is never removed. By default, the hook scripts Claude Code and Codex register, and the one running. */
  readonly protect?: readonly string[];
  /** How the trash folder is emptied. By default, by a detached process. */
  readonly empty?: (trash: string) => void;
  /** How long one pass may take before the rest wait for the next. By default, 3 s. */
  readonly budgetMs?: number;
  /** How long a folder git no longer lists must have gone untouched before it may go. By default, a day. */
  readonly idleMs?: number;
}

const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
const IDLE_MS = 24 * 60 * 60_000;
/** How long a folder's rename is retried after its test Postgres is stopped: Windows releases a killed process's handles late. */
const RELEASE_MS = 2_000;
/** The trash folder's name, in the repository's git directory. */
const TRASH = "storytree-reaped";

/** One linked worktree, as `git worktree list --porcelain` shows it. */
interface Worktree {
  folder: string;
  branch?: string;
  locked: boolean;
}

/** Remove the project's worktrees on this machine that ADR-0790 lets go, and return their folders. */
export async function reapWorktrees(context: MergeContext, watch: ReapWatch = {}): Promise<string[]> {
  if (!due(`${context.project}-worktrees`, watch.everyMs ?? EVERY_MS)) return [];
  const budgetMs = watch.budgetMs ?? BUDGET_MS;
  // One git call may take the whole budget: a slow one only leaves its worktree for the next pass.
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
  // Only the sessions whose lines name a folder in one of these worktrees are read (contract 2.7).
  const leftovers = checkout === undefined ? [] : unlistedFolders(path.join(checkout, ".claude", "worktrees"), trees.map((tree) => tree.folder)).filter((folder) => !protect.some((kept) => inside(folder, kept)));
  const users = await context.log.lines(context.project, { within: trees.map((tree) => tree.folder), latestBy: ["session"], omit: ["command", "files", "transcript"] });
  const sessions = users.length === 0 ? [] : await readSessions(context.log, context.project, { of: users.map((line) => line.session) });
  const candidates = trees.filter((tree) => {
    if (tree.locked || protect.some((kept) => inside(tree.folder, kept))) return false;
    const users = sessions.filter((session) => session.worktrees.some((folder) => inside(tree.folder, folder)));
    return users.length > 0 && users.every((session) => session.closeOut?.verified === true || session.archived);
  });
  // Least recently looked at first, so worktrees that stay never crowd out the rest.
  const looked = lookedAt(context.project);
  candidates.sort((a, b) => (looked[a.folder] ?? 0) - (looked[b.folder] ?? 0));
  const deadline = Date.now() + budgetMs;
  const reaped: Worktree[] = [];
  for (const tree of candidates) {
    if (Date.now() > deadline) break;
    looked[tree.folder] = Date.now();
    try {
      // A worktree set up with a teardown is judged clean before its teardown runs, which may leave files (19.4).
      const torn = teardownState(tree.folder);
      if (torn !== "done" && git(tree.folder, "status", "--porcelain") !== "") continue;
      git(tree.folder, "merge-base", "--is-ancestor", "HEAD", main);
      // Its teardown runs in a process of its own; the worktree waits for it to finish, for a later pass.
      if (torn === "due") startTeardown(tree.folder);
      if (torn === "due" || torn === "running") continue;
      const server = await stopTestServer(tree.folder, deadline);
      if (server === "running") continue;
      mkdirSync(trash, { recursive: true });
      // Fails while anything works inside it, which is what keeps a folder in use.
      await renameReleased(tree.folder, trash, server === "stopped" ? Date.now() + RELEASE_MS : 0);
      reaped.push(tree);
    } catch {
      // Dirty, not in main, or in use: it stays for the next pass.
    }
  }
  if (checkout !== undefined) reaped.push(...(await sweepLeftovers(context, leftovers, { checkout, trash, deadline, budgetMs, idleMs: watch.idleMs ?? IDLE_MS })));
  remember(context.project, looked, trees);
  // Git refusing either leaves a registration or a branch behind, never a folder: the pass has done what it is for.
  const quietly = (...args: string[]) => {
    try {
      git(context.folder, ...args);
    } catch {
      // Left as it is.
    }
  };
  if (reaped.length > 0) quietly("worktree", "prune");
  for (const { branch } of reaped) if (branch !== undefined) quietly("branch", "-D", branch);
  try {
    if (existsSync(trash) && readdirSync(trash).length > 0) (watch.empty ?? emptyInBackground)(trash);
  } catch {
    // Left for the next pass.
  }
  return reaped.map((tree) => tree.folder);
}

/**
 * Move into `trash` each folder git no longer lists that ADR-0790 D4 lets go, within the pass's
 * deadline: no process works in it, no session wrote there and it has not changed within `idleMs`,
 * and it holds no file whose content git lacks. Any doubt keeps the folder for the next pass.
 */
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
      // As for a listed worktree: fails on Windows while anything works inside it.
      renameSync(folder, path.join(pass.trash, `${path.basename(folder)}-${Date.now()}`));
      swept.push({ folder: path.resolve(folder), locked: false });
    } catch {
      // Git could not say, or the folder is in use: it stays for the next pass.
    }
  }
  return swept;
}

/**
 * Move `folder` into `trash`, trying again until `until` while the rename fails, then throwing its
 * last failure. A server just stopped may still hold the folder open on Windows for a moment.
 */
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

/**
 * Stop the test Postgres a run left running on `<folder>/.pgtest/data`, as its postmaster.pid names
 * it, and say whether there was none, it was stopped, or it still runs at `deadline`. A pid that is
 * gone, or names a process other than Postgres, is a stale file: nothing is stopped. Signalled by
 * pid, never through local-postgres, which this package has only for its tests.
 */
async function stopTestServer(folder: string, deadline: number): Promise<"none" | "stopped" | "running"> {
  let pid: number;
  try {
    pid = Number(readFileSync(path.join(folder, ".pgtest", "data", "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
  } catch {
    return "none";
  }
  if (!isPostgres(pid)) return "none";
  try {
    // An immediate shutdown: the cluster is about to be removed, so nothing in it needs saving.
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", timeout: 3_000, windowsHide: true });
    else process.kill(pid, "SIGQUIT");
  } catch {
    // Not ours to stop, or already gone: whether it lives decides.
  }
  while (isAlive(pid)) {
    if (Date.now() > deadline) return "running";
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return "stopped";
}

/** Whether `pid` is a live Postgres process. */
function isPostgres(pid: number): boolean {
  if (!isAlive(pid)) return false;
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/comm`, "utf8").includes("postgres");
    const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000, windowsHide: true });
    if (process.platform === "win32") return /postgres/i.test(run("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"]));
    return /postgres/.test(run("ps", ["-p", String(pid), "-o", "comm="]));
  } catch {
    return false;
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Alive, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The main checkout a porcelain listing names first, unless the repository is bare. */
function mainCheckout(listing: string): string | undefined {
  const fields = (listing.split(/\r?\n\r?\n/)[0] ?? "").split(/\r?\n/);
  const folder = fields.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
  return folder === undefined || fields.includes("bare") ? undefined : path.resolve(folder);
}

/** The linked worktrees a porcelain listing names: every one but the first, the main checkout. */
function linkedWorktrees(listing: string): Worktree[] {
  return listing.split(/\r?\n\r?\n/).slice(1).flatMap((block) => {
    const fields = block.split(/\r?\n/);
    const folder = fields.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
    if (folder === undefined || fields.includes("bare")) return [];
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    return [{ folder: path.resolve(folder), ...(branch === undefined ? {} : { branch }), locked: fields.some((field) => field === "locked" || field.startsWith("locked ")) }];
  });
}

/**
 * The main line to compare with: what `origin` names as its default, as this clone last heard, else
 * `origin/main`, else the local `main`. A clone made by `git init` and `git remote add` has no
 * `origin/HEAD`, and its local `main` may be weeks behind, which would keep every merged worktree.
 */
function mainLine(cwd: string, git: (cwd: string, ...args: string[]) => string): string {
  for (const line of ["origin/HEAD", "origin/main"]) {
    try {
      return git(cwd, "rev-parse", "--abbrev-ref", line);
    } catch {
      // Not in this clone.
    }
  }
  return "main";
}

/** Whether `child` is `parent` or inside it. */
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The hook scripts registered on this machine, and the script this process runs. */
function defaultProtected(): string[] {
  return [...registeredHookScripts(), ...(process.argv[1] === undefined ? [] : [process.argv[1]])];
}

/** When each of the project's worktrees was last looked at on this machine. */
function lookedAt(project: string): Record<string, number> {
  try {
    const stored = JSON.parse(readFileSync(lookedFile(project), "utf8")) as unknown;
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Remember when each worktree still listed was looked at; one no longer listed is forgotten. */
function remember(project: string, looked: Record<string, number>, trees: readonly Worktree[]): void {
  try {
    writeFileSync(lookedFile(project), JSON.stringify(Object.fromEntries(trees.flatMap((tree) => (looked[tree.folder] === undefined ? [] : [[tree.folder, looked[tree.folder]]])))));
  } catch {
    // Unable to remember: the next pass starts from the same worktrees, which is only slower.
  }
}

function lookedFile(project: string): string {
  return projectTempFile("storytree-worktrees-", project, ".json");
}

/** The script that empties the trash named as its argument: Node's recursive rmSync removes a link, junctions included, without following it. */
export const EMPTY_TRASH = "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 3 })";

/** Empty `trash` in a process that outlives the hook. */
function emptyInBackground(trash: string): void {
  const child = spawn(process.execPath, ["-e", EMPTY_TRASH, trash], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
