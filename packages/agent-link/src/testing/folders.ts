/**
 * Throwaway folders for the agent link's tests: each test's folders live under one fresh directory
 * in the system's temp directory, removed afterwards, pass or fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Run `body` with a fresh, empty directory, and remove it afterwards. */
export async function withTempDir<T>(body: (dir: string) => Promise<T> | T): Promise<T> {
  // The real path: on macOS the temp directory is reached through a symlink (/var -> /private/var),
  // and on Windows it can be spelled with short (8.3) names (C:\Users\RUNNER~1\...); git and
  // project routing both report the long, real one.
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-link-")));
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * Remove a test's temp folder once the children it started have exited.
 */
export async function removeTempDir(dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
}

/** Run git in `cwd` with a throwaway identity, and return what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=storytree test", "-c", "user.email=test@storytree.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
