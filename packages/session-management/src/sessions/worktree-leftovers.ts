/**
 * Capability 4 · Sessions: folders under the worktrees root that git no longer lists (ADR-0790 D4).
 * On Windows `git worktree remove` fails with "Filename too long" deep in `node_modules`, yet still
 * unregisters the worktree, so the folder it leaves is in no listing the reaper reads. These helpers
 * say which of those folders may go: one no live process works in, idle, holding no file whose
 * content git does not have. The reaper moves each into its trash like a registered worktree.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";

import { runGit } from "../activity/git.js";

/** Run git in `cwd`, its output trimmed, with room for a listing of every object. */
export type Git = (cwd: string, args: readonly string[], input?: string) => string;

/** A git runner that gives up after `timeoutMs`, with the repository's own commands off (3.46). */
export function gitWithin(timeoutMs: number): Git {
  return (cwd, args, input) =>
    runGit(args, { cwd, input: input ?? "", timeout: timeoutMs, maxBuffer: 1 << 28 }).trim();
}

/** The folders directly under `root` that are not `listed`, never following a link. */
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

/** A path as this platform compares them: Windows ignores case. */
function sameKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * The working folders of this machine's processes, or undefined when they cannot be read. On Windows
 * none are read: there the rename into the trash fails while any process works inside a folder.
 */
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

/** When `folder` itself last changed, in milliseconds since the epoch. */
export function changedAt(folder: string): number {
  return statSync(folder).mtimeMs;
}

/**
 * Whether `folder` holds a file whose content no ref of the repository reaches: every file that
 * neither the main checkout's ignore rules nor the folder's own ignore is hashed as git would store
 * it and looked up among the objects reachable from refs. Links are never followed: a link holds
 * nothing of its own. Throws when git cannot say, which keeps the folder.
 */
export function holdsUnknownContent(folder: string, main: string, gitDir: string, git: Git, reachable: () => ReadonlySet<string>): boolean {
  const files = keptFiles(folder, main, gitDir, git);
  if (files.length === 0) return false;
  const hashes = git(folder, [`--git-dir=${gitDir}`, `--work-tree=${folder}`, "hash-object", "--stdin-paths"], files.join("\n") + "\n").split(/\r?\n/);
  if (hashes.length !== files.length) throw new Error("git hashed a different number of files than it was given");
  const known = reachable();
  return hashes.some((hash) => !known.has(hash));
}

/** Every object reachable from the repository's refs, as `cwd` sees it. */
export function reachableObjects(cwd: string, git: Git): Set<string> {
  return new Set(git(cwd, ["rev-list", "--objects", "--all", "--no-object-names"]).split(/\r?\n/).filter((line) => line !== ""));
}

/** The files in `folder` no ignore rule covers, relative with forward slashes, walked a level at a time so an ignored tree is never read. */
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

/** Which of `paths` (a directory's ending in a slash) the main checkout's ignore rules or the folder's own ignore. */
function ignoredPaths(paths: readonly string[], folder: string, main: string, gitDir: string, git: Git): Set<string> {
  if (paths.length === 0) return new Set();
  const ask = (cwd: string, args: readonly string[]) => {
    try {
      return git(cwd, [...args, "check-ignore", "--no-index", "--stdin", "-z"], paths.join("\0") + "\0").split("\0");
    } catch (error) {
      // Exit 1 says none is ignored; anything else is git unable to say.
      if ((error as { status?: number }).status === 1) return [];
      throw error;
    }
  };
  return new Set([...ask(main, []), ...ask(folder, [`--git-dir=${gitDir}`, `--work-tree=${folder}`])].filter((line) => line !== ""));
}
