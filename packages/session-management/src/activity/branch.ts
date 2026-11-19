// Capability 2 · Agent activity log
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { runGit, type Git } from "./git.js";

export function currentBranch(folder: string, git: Git = runGit): string | undefined {
  const root = worktreeRoot(folder);
  if (root === undefined) return undefined;
  const head = headOf(path.join(root, ".git"));
  if (head === undefined) return askGit(folder, git);
  if (!head.startsWith("ref:")) return undefined;
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  return branch === undefined || branch === ".invalid" ? askGit(folder, git) : branch;
}

function headOf(dotGit: string): string | undefined {
  try {
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const pointer = /^gitdir:\s*(\S.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
      if (pointer === undefined) return undefined;
      gitDir = path.resolve(path.dirname(dotGit), pointer);
    }
    return readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return undefined;
  }
}

function askGit(folder: string, git: Git): string | undefined {
  try {
    const branch = git(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: folder }).trim();
    return branch === "" || branch === "HEAD" ? undefined : branch;
  } catch {
    return undefined;
  }
}

export function worktreeRoot(folder: string): string | undefined {
  for (let at = path.resolve(folder); ; at = path.dirname(at)) {
    if (existsSync(path.join(at, ".git"))) return at;
    if (path.dirname(at) === at) return undefined;
  }
}
