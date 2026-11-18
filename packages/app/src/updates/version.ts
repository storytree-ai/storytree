// Capability 4 · Updates
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { versionAt, type Git } from "./release-source.js";

declare const STORYTREE_RELEASE: string | undefined;

export function sourceVersion(from?: string): { version: string; commit: string } | undefined {
  if (typeof STORYTREE_RELEASE === "string") return JSON.parse(STORYTREE_RELEASE) as { version: string; commit: string };
  const url: unknown = import.meta.url;
  const dir = from ?? (typeof url === "string" ? path.dirname(fileURLToPath(url)) : undefined);
  if (dir === undefined) return undefined;
  const git: Git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { version: versionAt(git, "HEAD"), commit: git("rev-parse", "--short=7", "HEAD") };
  } catch {
    return undefined;
  }
}

export function appVersion({ packaged, packagedVersion, appPath, source = sourceVersion }: {
  packaged: boolean;
  packagedVersion: () => string;
  appPath: string;
  source?: (from: string) => { version: string } | undefined;
}): string {
  return packaged ? packagedVersion() : (source(appPath)?.version ?? "0.3.0");
}
