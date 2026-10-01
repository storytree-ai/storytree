import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** The branch `folder` is on, even one with no commit yet, or undefined when it is not on one (not a git folder, or a detached head). */
export function currentBranch(folder: string): string | undefined {
  try {
    const branch = execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
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
