import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeTemp } from "@storytree/test-waits";

export async function withTempDir<T>(body: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-link-")));
  try {
    return await body(dir);
  } finally {
    await removeTemp(dir);
  }
}

export { removeTemp as removeTempDir } from "@storytree/test-waits";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=storytree test", "-c", "user.email=test@storytree.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function writeMarker(folder: string, text: string | Uint8Array): void {
  mkdirSync(path.join(folder, ".storytree"), { recursive: true });
  writeFileSync(path.join(folder, ".storytree", "project.json"), text);
}
