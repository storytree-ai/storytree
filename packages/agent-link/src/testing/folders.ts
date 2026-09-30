/**
 * Throwaway folders for the agent link's tests: each test's folders live under one fresh directory
 * in the system's temp directory, removed afterwards, pass or fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

/** Run `body` with a fresh, empty directory, and remove it afterwards. */
export async function withTempDir<T>(body: (dir: string) => Promise<T> | T): Promise<T> {
  // The real path: on macOS the temp directory is reached through a symlink (/var -> /private/var),
  // and on Windows it can be spelled with short (8.3) names (C:\Users\RUNNER~1\...); git and
  // project routing both report the long, real one.
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-link-")));
  try {
    return await body(dir);
  } finally {
    await removeTempDir(dir);
  }
}

/**
 * Remove a test's temp folder once the children it started have exited. On Windows a folder can stay
 * held for a moment after its last child is signalled or even gone (EBUSY, EPERM, ENOTEMPTY), so
 * removal retries for up to `waitMs`; past that the folder is left in the system's temp directory,
 * which is cleaned anyway, and where it was is logged, rather than failing the behaviour the test
 * protects.
 */
export async function removeTempDir(dir: string, waitMs = 10_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!HELD.has(code)) throw error;
      if (Date.now() >= deadline) {
        console.warn(`left the test folder ${dir} behind: still held after ${waitMs} ms (${code})`);
        return;
      }
      await pause(100);
    }
  }
}

const HELD = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);

/** Run git in `cwd` with a throwaway identity, and return what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=storytree test", "-c", "user.email=test@storytree.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
