// Capability 3 · Hooks
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine } from "@storytree/library";

import { filtersOff, runGit, type Git as RunGit } from "../activity/git.js";
import { learn, limitOf, type Step } from "./learned-limits.js";

export const OBSERVE_STEP: Step = { name: "shell-edits", floorMs: 5_000, ceilingMs: 8_000 };

export function shellEdits(home: string, root: string, line: NewLine, failed: (error: unknown) => void = () => undefined, run: RunGit = runGit, deadlineMs?: number): NewLine[] {
  if (!["session-started", "command-started", "command-run", "file-edited"].includes(line.kind)) return [];
  const key = createHash("sha256").update(`${line.session}\0${root}`).digest("hex");
  const file = path.join(home, "shell-edits", `${key}.json`);
  const lock = `${file}.lock`;
  let held = false;
  let temporary: string | undefined;
  const limit = deadlineMs ?? limitOf(home, OBSERVE_STEP);
  const learning = deadlineMs === undefined;
  let from: number | undefined;
  try {
    if (line.kind === "command-started" && existsSync(file)) return [];
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return [];
      throw error;
    }
    held = true;
    from = Date.now();
    const git = reader(root, from + limit, limit, run);
    const previous = readSnapshot(file);
    const reflog = headLog(root, git);
    const current = { head: head(git), ...snapshot(root, git), reflog: reflog?.length };
    let files: string[] = [];
    if (line.kind === "command-run" && previous !== undefined) {
      const changed = [...new Set([...previous.files.keys(), ...current.files.keys()])]
        .filter((name) => previous.files.get(name) !== current.files.get(name));
      const fromGit = imported(git, previous, current, changed, reflog);
      files = changed.filter((name) => !fromGit.has(name)).sort();
    }
    temporary = `${file}.${randomUUID()}.part`;
    writeFileSync(temporary, JSON.stringify({ head: current.head, files: [...current.files], untracked: [...current.untracked], reflog: current.reflog }));
    renameSync(temporary, file);
    if (learning) learn(home, OBSERVE_STEP, Date.now() - from);
    if (files.length === 0 || line.kind !== "command-run") return [];
    const { command: _command, call: _call, kind: _kind, ...common } = line;
    return [{ ...common, kind: "file-edited", folder: root, files }];
  } catch (error) {
    if (learning && from !== undefined && Date.now() - from >= limit) learn(home, OBSERVE_STEP, limit);
    failed(error);
    return [];
  } finally {
    try {
      if (temporary !== undefined) rmSync(temporary, { force: true });
      if (held) rmSync(lock, { recursive: true, force: true });
    } catch { }
  }
}

export const BASELINE_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

export const PRUNE_EVERY_MS = 60 * 60 * 1000;

export function pruneBaselinesWhenDue(home: string, { now = Date.now(), everyMs = PRUNE_EVERY_MS, ...prune }: { now?: number; everyMs?: number; keptMs?: number; limit?: number } = {}): number {
  const stamp = path.join(home, "shell-edits-pruned.stamp");
  try {
    if (now - statSync(stamp).mtimeMs < everyMs) return 0;
  } catch { }
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(stamp, "");
    utimesSync(stamp, new Date(now), new Date(now));
  } catch { }
  return pruneBaselines(home, { now, ...prune });
}

export function pruneBaselines(home: string, { now = Date.now(), keptMs = BASELINE_KEPT_MS, limit = 500 }: { now?: number; keptMs?: number; limit?: number } = {}): number {
  let removed = 0;
  for (const folder of [home, path.join(home, "guarded-edits"), path.join(home, "imported-edits")].map((place) => path.join(place, "shell-edits"))) {
    let names: string[];
    try { names = readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (removed >= limit) return removed;
      if (!name.endsWith(".json") && !name.endsWith(".part")) continue;
      const file = path.join(folder, name);
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || now - stat.mtimeMs < keptMs) continue;
        rmSync(file, { force: true });
        removed += 1;
      } catch { }
    }
  }
  return removed;
}

interface Observation { head: string | undefined; files: Map<string, string>; untracked?: Set<string> | undefined; reflog?: number | undefined }

function readSnapshot(file: string): Observation | undefined {
  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    const { head, files: entries, untracked, reflog } = Array.isArray(stored) ? { head: undefined, files: stored, untracked: undefined, reflog: undefined }
      : (stored ?? {}) as { head?: unknown; files?: unknown; untracked?: unknown; reflog?: unknown };
    return (head === undefined || typeof head === "string") && Array.isArray(entries)
      && entries.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string"))
      ? {
        head, files: new Map(entries as [string, string][]),
        ...(Array.isArray(untracked) && untracked.every((name) => typeof name === "string") ? { untracked: new Set<string>(untracked) } : {}),
        ...(Number.isSafeInteger(reflog) && (reflog as number) >= 0 ? { reflog: reflog as number } : {}),
      } : undefined;
  } catch {
    return undefined;
  }
}

function head(git: Git): string | undefined {
  try { return git(["rev-parse", "-q", "--verify", "HEAD^{commit}"]).trim() || undefined; } catch { return undefined; }
}

function headLog(root: string, git: Git): Buffer | undefined {
  try { return readFileSync(path.resolve(root, git(["rev-parse", "--git-path", "logs/HEAD"]).trim())); } catch { return undefined; }
}

function imported(git: Git, previous: Observation, current: Observation, changed: string[], reflog: Buffer | undefined): Set<string> {
  const from = previous.head;
  const to = current.head;
  if (from === undefined || to === undefined || changed.length === 0) return new Set();
  const moves = movesOf(git, previous, reflog, from, to);
  if (moves === undefined) return from === to ? new Set() : published(git, previous, current, changed, from, to);
  const brought = new Set<string>();
  const own = new Set<string>();
  for (const move of moves) {
    const restores = /^(reset|checkout)\b/.test(move.subject);
    const names = move.from === move.to ? [] : changedBetween(git, move.from, move.to);
    if (restores) for (const name of changed) brought.add(name);
    for (const name of names) {
      (/^(pull|merge|checkout|reset|rebase)\b/.test(move.subject) ? brought : own).add(name);
      if (restores) own.delete(name);
    }
  }
  return leftAsCommitted(git, previous, current, to, changed.filter((name) => brought.has(name) && !own.has(name)));
}

function movesOf(git: Git, previous: Observation, reflog: Buffer | undefined, from: string, to: string): { from: string; to: string; subject: string }[] | undefined {
  let moves: { from: string; to: string; subject: string }[];
  if (previous.reflog !== undefined && reflog !== undefined) {
    if (previous.reflog > reflog.length) return undefined;
    moves = reflog.subarray(previous.reflog).toString("utf8").split("\n").filter(Boolean).map((entry) => {
      const [from = "", to = ""] = entry.split(" ");
      return { from, to, subject: entry.slice(entry.indexOf("\t") + 1) };
    });
  } else {
    if (from === to) return undefined;
    const entries = git(["log", "--walk-reflogs", "-n", "200", "--format=%H %gs", "HEAD"]).split("\n").filter(Boolean)
      .map((entry) => ({ hash: entry.slice(0, entry.indexOf(" ")), subject: entry.slice(entry.indexOf(" ") + 1) }));
    const start = entries.findIndex((entry) => entry.hash === from);
    if (start <= 0) return undefined;
    moves = entries.slice(0, start).map((entry, step) => ({ from: entries[step + 1]!.hash, to: entry.hash, subject: entry.subject })).reverse();
  }
  return moves[0]?.from !== from || moves.at(-1)?.to !== to || moves.some((move, index) => index > 0 && moves[index - 1]!.to !== move.from) ? undefined : moves;
}

function published(git: Git, previous: Observation, current: Observation, changed: string[], from: string, to: string): Set<string> {
  if (git(["rev-list", "-n", "1", to, "--not", "--remotes"]).trim() !== "") return new Set();
  const moved = hasCommit(git, from) ? new Set(changedBetween(git, from, to)) : undefined;
  return leftAsCommitted(git, previous, current, to, changed.filter((name) => moved === undefined || moved.has(name)));
}

function leftAsCommitted(git: Git, previous: Observation, current: Observation, to: string, candidates: string[]): Set<string> {
  if (candidates.length === 0) return new Set();
  const after = blobs(git, to, candidates);
  return new Set(candidates.filter((name) => current.files.get(name) === after.get(name) && !(previous.untracked?.has(name) && !after.has(name))));
}

function changedBetween(git: Git, from: string, to: string): string[] {
  return git(["diff", "--name-only", "-z", "--no-renames", from, to]).split("\0").filter(Boolean);
}

function hasCommit(git: Git, commit: string): boolean {
  try { git(["cat-file", "-e", `${commit}^{commit}`]); return true; } catch { return false; }
}

function blobs(git: Git, commit: string, names: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of git(["--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...names]).split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    found.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]!);
  }
  return found;
}

type Git = (args: string[], input?: string | Buffer) => string;

function reader(root: string, deadline: number, limit: number, run: RunGit): Git {
  let off: string[] | undefined;
  return (args, input) => {
    const timeout = () => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`the Git reads took longer than ${limit} ms`);
      return left;
    };
    off ??= filtersOff(run, root, timeout());
    return run([...off, "--no-optional-locks", ...args], { cwd: root, ...(input === undefined ? {} : { input }), timeout: timeout(), maxBuffer: 8 * 1024 * 1024 });
  };
}

function snapshot(root: string, git: Git): { files: Map<string, string>; untracked: Set<string> } {
  const files = new Map<string, string>();
  const untracked = new Set<string>();
  for (const entry of git(["ls-files", "--stage", "-z"]).split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    const [mode, hash] = entry.slice(0, tab).split(" ");
    if (mode !== "160000" && hash !== undefined) files.set(entry.slice(tab + 1), hash);
  }
  const regular: string[] = [];
  for (const entry of git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]).split("\0")) {
    if (!entry) continue;
    const name = entry.slice(3);
    if (entry.startsWith("??")) untracked.add(name);
    const full = path.join(root, name);
    let stat;
    try { stat = lstatSync(full); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.delete(name);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(full, { encoding: "buffer" });
      files.set(name, git(["hash-object", "--stdin", "--no-filters"], target).trim());
    } else if (stat.isFile()) regular.push(name);
  }
  if (regular.length > 0) {
    const hashes = git(["hash-object", "--stdin-paths"], regular.map((name) => JSON.stringify(name)).join("\n") + "\n").trim().split("\n");
    if (hashes.length !== regular.length) throw new Error("incomplete file hashes");
    regular.forEach((name, index) => files.set(name, hashes[index]!));
  }
  return { files, untracked };
}
