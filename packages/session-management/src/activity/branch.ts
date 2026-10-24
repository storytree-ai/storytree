/** Capability 2 · Agent activity log. */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { runGit, type Git } from "./git.js";

/**
 * The branch `folder` is on, even one with no commit yet, or undefined when it is not on one (not a git folder, or a detached head).
 * Read from the worktree's HEAD file, as `git symbolic-ref` reads it: every line the activity log writes asks, and starting git for
 * each cost about 60 ms on Windows, the largest part of an agent tool's test there (increment_f5a993f5abd4). Git is asked only when
 * HEAD is not in a form read here (a reftable repository's placeholder, a ref outside refs/heads), and then as `git` runs it.
 */
export function currentBranch(folder: string, git: Git = runGit): string | undefined {
  const root = worktreeRoot(folder);
  if (root === undefined) return undefined;
  const head = headOf(path.join(root, ".git"));
  if (head === undefined) return askGit(folder, git);
  if (!head.startsWith("ref:")) return undefined; // a detached head: a commit, not a branch
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  return branch === undefined || branch === ".invalid" ? askGit(folder, git) : branch;
}

/** What HEAD holds, trimmed, for the `.git` folder or linked worktree's `.git` file at `dotGit`; undefined when it cannot be read. */
function headOf(dotGit: string): string | undefined {
  try {
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
      if (pointer === undefined) return undefined;
      gitDir = path.resolve(path.dirname(dotGit), pointer);
    }
    return readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return undefined;
  }
}

function askGit(folder: string, git: Git): string | undefined {
  try {
    const branch = git(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: folder }).trim();
    return branch === "" || branch === "HEAD" ? undefined : branch;
  } catch {
    return undefined;
  }
}

/** The root of the git worktree `folder` is in, the nearest folder up holding a `.git`, or undefined when it is in none. */
export function worktreeRoot(folder: string): string | undefined {
  for (let at = path.resolve(folder); ; at = path.dirname(at)) {
    if (existsSync(path.join(at, ".git"))) return at;
    if (path.dirname(at) === at) return undefined;
  }
}
