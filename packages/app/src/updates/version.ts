/** ADR-0753 D2: the command line reports the same 0.3.<n> for its build as the desktop app. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { versionAt, type Git } from "./release-source.js";

/** The release packaging stamped into a bundled build (buildBins' `release`), as JSON; undeclared when run from source. */
declare const STORYTREE_RELEASE: string | undefined;

/** This code's own build: the release stamped into it at packaging, else its version and short commit when it runs from a storytree checkout; undefined anywhere else. */
export function sourceVersion(from?: string): { version: string; commit: string } | undefined {
  if (typeof STORYTREE_RELEASE === "string") return JSON.parse(STORYTREE_RELEASE) as { version: string; commit: string };
  // A CommonJS bundle has no import.meta.url: with no folder given, it has no checkout to read.
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
