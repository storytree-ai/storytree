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
 *   with it.
 * - It is renamed into a trash folder in the git directory first: on Windows that fails while any
 *   process works inside it, which leaves a folder still in use unharmed. Then `git worktree prune`
 *   unregisters it, and the trash is emptied by a detached process with Node's recursive rmSync,
 *   which copes with the long `node_modules` paths `git worktree remove` fails on, so a hook never
 *   waits on it. Whatever is left in the trash is emptied again on the next pass.
 * - It runs at most once a minute per project on each machine, for at most a few seconds, and never
 *   fails a hook: git refusing anything leaves that worktree for the next pass.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { due, type MergeContext } from "../claims/merges.js";
import { registeredHookScripts } from "../setup/hooks-config.js";
import { readSessions } from "./sessions.js";

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
}

const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
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
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: budgetMs, windowsHide: true }).trim();
  let trees: Worktree[];
  let trash: string;
  let main: string;
  try {
    trees = linkedWorktrees(git(context.folder, "worktree", "list", "--porcelain"));
    trash = path.join(path.resolve(context.folder, git(context.folder, "rev-parse", "--git-common-dir")), TRASH);
    main = mainLine(context.folder, git);
  } catch {
    return [];
  }
  const protect = [context.folder, ...(watch.protect ?? defaultProtected())];
  // Only the sessions whose lines name a folder in one of these worktrees are read (contract 2.7).
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
      if (git(tree.folder, "status", "--porcelain") !== "") continue;
      git(tree.folder, "merge-base", "--is-ancestor", "HEAD", main);
      mkdirSync(trash, { recursive: true });
      // Fails while anything works inside it, which is what keeps a folder in use.
      renameSync(tree.folder, path.join(trash, `${path.basename(tree.folder)}-${Date.now()}`));
      reaped.push(tree);
    } catch {
      // Dirty, not in main, or in use: it stays for the next pass.
    }
  }
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

/** The main line to compare with: what `origin` names as its default, as this clone last heard, else the local `main`. */
function mainLine(cwd: string, git: (cwd: string, ...args: string[]) => string): string {
  try {
    return git(cwd, "rev-parse", "--abbrev-ref", "origin/HEAD");
  } catch {
    return "main";
  }
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
  return path.join(tmpdir(), `storytree-worktrees-${project}.json`);
}

/** Empty `trash` in a process that outlives the hook. */
function emptyInBackground(trash: string): void {
  const child = spawn(process.execPath, ["-e", "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 3 })", trash], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
