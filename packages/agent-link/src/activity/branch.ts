import { execFileSync } from "node:child_process";

/** The branch `folder` is on, even one with no commit yet, or undefined when it is not on one (not a git folder, or a detached head). */
export function currentBranch(folder: string): string | undefined {
  try {
    const branch = execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    return branch === "" || branch === "HEAD" ? undefined : branch;
  } catch {
    return undefined;
  }
}
