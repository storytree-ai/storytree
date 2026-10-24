/**
 * Throwaway folders for the tests of Project and caller and the stories that stand on it: each test's folders live under one fresh directory
 * in the system's temp directory, removed afterwards, pass or fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeTemp } from "@storytree/test-waits";

/** Run `body` with a fresh, empty directory, and remove it afterwards. */
export async function withTempDir<T>(body: (dir: string) => Promise<T> | T): Promise<T> {
  // The real path: on macOS the temp directory is reached through a symlink (/var -> /private/var),
  // and on Windows it can be spelled with short (8.3) names (C:\Users\RUNNER~1\...); git and
  // project routing both report the long, real one.
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-link-")));
  try {
    return await body(dir);
  } finally {
    await removeTemp(dir);
  }
}

/**
 * Remove a test's temp folder once the children it started have exited: the shared removal helper
 * (ADR-1156 D3), which retries while Windows still holds the folder, for the callers that name it so.
 */
export { removeTemp as removeTempDir } from "@storytree/test-waits";

/** Run git in `cwd` with a throwaway identity, and return what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=storytree test", "-c", "user.email=test@storytree.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
