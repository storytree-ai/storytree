// Capability 4 · Sessions
import { execFileSync } from "node:child_process";
import { readdirSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";

import { runGit } from "../activity/git.js";

export type Git = (cwd: string, args: readonly string[], input?: string) => string;

export function gitWithin(timeoutMs: number): Git {
  return (cwd, args, input) =>
    runGit(args, { cwd, input: input ?? "", timeout: timeoutMs, maxBuffer: 1 << 28 }).trim();
}

export function unlistedFolders(root: string, listed: readonly string[]): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const known = new Set(listed.map(sameKey));
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join(root, entry.name)).filter((folder) => !known.has(sameKey(folder)));
}

function sameKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function foldersInUse(): string[] | undefined {
  if (process.platform === "win32") return [];
  if (process.platform === "linux") {
    try {
      return readdirSync("/proc").filter((name) => /^\d+$/.test(name)).flatMap((pid) => {
        try {
          return [readlinkSync(`/proc/${pid}/cwd`)];
        } catch {
          return [];
        }
      });
    } catch {
      return undefined;
    }
  }
  try {
    const listing = execFileSync("lsof", ["-a", "-d", "cwd", "-Fn", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000, maxBuffer: 1 << 24 });
    return listing.split("\n").filter((line) => line.startsWith("n")).map((line) => line.slice(1));
  } catch {
    return undefined;
  }
}

export function changedAt(folder: string): number {
  return statSync(folder).mtimeMs;
}

export function holdsUnknownContent(folder: string, main: string, gitDir: string, git: Git, reachable: () => ReadonlySet<string>): boolean {
  const files = keptFiles(folder, main, gitDir, git);
  if (files.length === 0) return false;
  const hashes = git(folder, [`--git-dir=${gitDir}`, `--work-tree=${folder}`, "hash-object", "--stdin-paths"], files.join("\n") + "\n").split(/\r?\n/);
  if (hashes.length !== files.length) throw new Error("git hashed a different number of files than it was given");
  const known = reachable();
  return hashes.some((hash) => !known.has(hash));
}

export function reachableObjects(cwd: string, git: Git): Set<string> {
  return new Set(git(cwd, ["rev-list", "--objects", "--all", "--no-object-names"]).split(/\r?\n/).filter((line) => line !== ""));
}

function keptFiles(folder: string, main: string, gitDir: string, git: Git): string[] {
  const files: string[] = [];
  let level = [""];
  while (level.length > 0) {
    const entries = level.flatMap((relative) =>
      readdirSync(path.join(folder, relative), { withFileTypes: true }).flatMap((entry) => {
        if (entry.isSymbolicLink() || (relative === "" && entry.name === ".git")) return [];
        const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) return [{ path: `${child}/`, directory: true }];
        return entry.isFile() ? [{ path: child, directory: false }] : [];
      }),
    );
    const ignored = ignoredPaths(entries.map((entry) => entry.path), folder, main, gitDir, git);
    const kept = entries.filter((entry) => !ignored.has(entry.path));
    files.push(...kept.filter((entry) => !entry.directory).map((entry) => entry.path));
    level = kept.filter((entry) => entry.directory).map((entry) => entry.path.slice(0, -1));
  }
  return files;
}

function ignoredPaths(paths: readonly string[], folder: string, main: string, gitDir: string, git: Git): Set<string> {
  if (paths.length === 0) return new Set();
  const ask = (cwd: string, args: readonly string[]) => {
    try {
      return git(cwd, [...args, "check-ignore", "--no-index", "--stdin", "-z"], paths.join("\0") + "\0").split("\0");
    } catch (error) {
      if ((error as { status?: number }).status === 1) return [];
      throw error;
    }
  };
  return new Set([...ask(main, []), ...ask(folder, [`--git-dir=${gitDir}`, `--work-tree=${folder}`])].filter((line) => line !== ""));
}
