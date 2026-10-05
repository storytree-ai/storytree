/**
 * Capability 3 · Hooks: shell writes become the same file-edited lines as edit tools (3.22).
 * Each session/worktree keeps its last observed contents locally. Git supplies the index's blob
 * hashes; only dirty and untracked files are read again. Hashing through git keeps clean filters
 * and Windows line endings consistent with the index, so staging or committing invents no edit.
 *
 * A start (or the first command in a new worktree) establishes a baseline without attributing old
 * dirt. Explicit edits advance it without another edit line. A command's finish compares it,
 * including after failure and while offline. Nothing here reads the library or parses shell code.
 * Like the other hooks this observes, not intercepts: writes outside the hook's worktree, changes
 * undone between observations, and simultaneous writers in one worktree cannot be attributed.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine } from "../activity/index.js";

/** Extra edits made visible by this hook; errors leave its ordinary lines untouched. */
export function shellEdits(home: string, root: string, line: NewLine): NewLine[] {
  if (!["session-started", "command-started", "command-run", "file-edited"].includes(line.kind)) return [];
  const key = createHash("sha256").update(`${line.session}\0${root}`).digest("hex");
  const file = path.join(home, "shell-edits", `${key}.json`);
  const lock = `${file}.lock`;
  let held = false;
  let temporary: string | undefined;
  try {
    // A before-hook only seeds a worktree this session has not observed. In particular a delayed
    // asynchronous before-hook must not swallow the command's write by refreshing its baseline.
    if (line.kind === "command-started" && existsSync(file)) return [];
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock); // Another hook for this session/worktree is observing: never wait behind it.
    held = true;
    const previous = readSnapshot(file);
    const current = snapshot(root);
    temporary = `${file}.${randomUUID()}.part`;
    writeFileSync(temporary, JSON.stringify([...current]));
    renameSync(temporary, file);
    if (line.kind !== "command-run" || previous === undefined) return [];
    const files = [...new Set([...previous.keys(), ...current.keys()])]
      .filter((name) => previous.get(name) !== current.get(name)).sort();
    if (files.length === 0) return [];
    const { command: _command, call: _call, kind: _kind, ...common } = line;
    return [{ ...common, kind: "file-edited", folder: root, files }];
  } catch {
    return [];
  } finally {
    try {
      if (temporary !== undefined) rmSync(temporary, { force: true });
      if (held) rmSync(lock, { recursive: true, force: true });
    } catch { /* Cleanup must not discard the hook's ordinary lines either. */ }
  }
}

function readSnapshot(file: string): Map<string, string> | undefined {
  try {
    const entries: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(entries) && entries.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string"))
      ? new Map(entries as [string, string][]) : undefined;
  } catch {
    return undefined;
  }
}

/** A bounded local read, with no shell. A failed or oversized reading never replaces the baseline. */
function git(root: string, args: string[], input?: string | Buffer): string {
  return execFileSync("git", args, {
    cwd: root, input, encoding: "utf8", timeout: 1_000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
  });
}

function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of git(root, ["ls-files", "--stage", "-z"]).split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    const [mode, hash] = entry.slice(0, tab).split(" ");
    if (mode !== "160000" && hash !== undefined) files.set(entry.slice(tab + 1), hash);
  }
  const regular: string[] = [];
  for (const entry of git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]).split("\0")) {
    if (!entry) continue;
    const name = entry.slice(3);
    const full = path.join(root, name);
    let stat;
    try { stat = lstatSync(full); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.delete(name);
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Hash the link itself; never read a target outside this checkout.
      const target = readlinkSync(full, { encoding: "buffer" });
      files.set(name, git(root, ["hash-object", "--stdin", "--no-filters"], target).trim());
    } else if (stat.isFile()) regular.push(name);
    // Directories (submodules and nested repositories) are not files of this worktree.
  }
  if (regular.length > 0) {
    // Git's quoted-path syntax accepts these escapes and keeps spaces, quotes and newlines intact.
    const hashes = git(root, ["hash-object", "--stdin-paths"], regular.map((name) => JSON.stringify(name)).join("\n") + "\n").trim().split("\n");
    if (hashes.length !== regular.length) throw new Error("incomplete file hashes");
    regular.forEach((name, index) => files.set(name, hashes[index]!));
  }
  return files;
}
