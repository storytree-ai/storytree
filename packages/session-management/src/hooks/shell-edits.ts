/**
 * Capability 3 · Hooks: shell writes become the same file-edited lines as edit tools (3.22).
 * Each session/worktree keeps its last observed contents locally. Git supplies the index's blob
 * hashes; only dirty and untracked files are read again. Hashing through git keeps clean filters
 * and Windows line endings consistent with the index, so staging or committing invents no edit.
 *
 * A start (or the first command in a new worktree) establishes a baseline without attributing old
 * dirt. Explicit edits advance it without another edit line. A command's finish compares it,
 * including after failure and while offline. Nothing here reads the library or parses shell code.
 * A file a pull, merge, checkout, reset or rebase brought in, left exactly as Git wrote it, is not
 * the session's edit. Commits of its own writes still count. A reflog offset distinguishes a reset
 * at the same HEAD and a round trip between branches from no Git operation at all. A move HEAD's
 * log cannot account for (another tool moved HEAD unlogged, or the log was rewritten) still imports
 * what a commit already on a remote brought, and a comparison Git cannot finish fails the observation:
 * a checkout another process pulled is never the session's edit (increment_a550aa18c717).
 * Like the other hooks this observes, not intercepts: writes outside the hook's worktree, changes
 * undone between observations, and simultaneous writers in one worktree cannot be attributed.
 * An observation that fails keeps the last good baseline, so the next one still sees the write, and
 * says why to `failed` (3.23). Its Git reads share one budget rather than a second each: on a loaded
 * Windows runner (2026-10-07, merge-queue job 112536340924) a committed write went unseen by two
 * observations running, in a run about two seconds slower than its passing twins.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine } from "../activity/index.js";

/** How long one observation's Git reads may take, together. */
const OBSERVE_MS = 5_000;

/** Extra edits made visible by this hook; errors leave its ordinary lines untouched and go to `failed`. */
export function shellEdits(home: string, root: string, line: NewLine, failed: (error: unknown) => void = () => undefined): NewLine[] {
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
    try { mkdirSync(lock); } catch (error) {
      // Another hook for this session/worktree is observing: never wait behind it. That is no failure.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return [];
      throw error;
    }
    held = true;
    const git = reader(root, Date.now() + OBSERVE_MS);
    const previous = readSnapshot(file);
    const reflog = headLog(root, git);
    const current = { head: head(git), ...snapshot(root, git), reflog: reflog?.length };
    // Compared before the baseline moves on: a comparison that fails is a failed observation, never an edit.
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
    if (files.length === 0 || line.kind !== "command-run") return [];
    const { command: _command, call: _call, kind: _kind, ...common } = line;
    return [{ ...common, kind: "file-edited", folder: root, files }];
  } catch (error) {
    failed(error);
    return [];
  } finally {
    try {
      if (temporary !== undefined) rmSync(temporary, { force: true });
      if (held) rmSync(lock, { recursive: true, force: true });
    } catch { /* Cleanup must not discard the hook's ordinary lines either. */ }
  }
}

interface Observation { head: string | undefined; files: Map<string, string>; untracked?: Set<string> | undefined; reflog?: number | undefined }

function readSnapshot(file: string): Observation | undefined {
  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    // A baseline written before HEAD was recorded is a bare entry list; it still compares files.
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

/** HEAD's log is worktree-specific, including in a linked worktree. Older baselines lack its offset. */
function headLog(root: string, git: Git): Buffer | undefined {
  try { return readFileSync(path.resolve(root, git(["rev-parse", "--git-path", "logs/HEAD"]).trim())); } catch { return undefined; }
}

/**
 * The changed files Git brought in and the session left as committed. Discarding earlier dirt
 * is not another edit by the agent. A commit of a shell write still counts, even beside a merge.
 * HEAD's log says how HEAD moved; when it cannot (another tool moved HEAD unlogged, or the log was
 * rewritten since), a file left as the new HEAD has it was brought in when that HEAD is already on
 * a remote, so the session's unpushed commits still count. A Git read that fails throws: the
 * observation fails rather than counting a doubtful file as the session's edit.
 */
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

/** HEAD's moves from `from` to `to`, oldest first, as its log records them; undefined when the log cannot account for them. */
function movesOf(git: Git, previous: Observation, reflog: Buffer | undefined, from: string, to: string): { from: string; to: string; subject: string }[] | undefined {
  let moves: { from: string; to: string; subject: string }[];
  if (previous.reflog !== undefined && reflog !== undefined) {
    if (previous.reflog > reflog.length) return undefined; // expired or rewritten log
    moves = reflog.subarray(previous.reflog).toString("utf8").split("\n").filter(Boolean).map((entry) => {
      const [from = "", to = ""] = entry.split(" ");
      return { from, to, subject: entry.slice(entry.indexOf("\t") + 1) };
    });
  } else {
    // Upgrade a baseline written before offsets were kept; same-HEAD operations need a new one.
    if (from === to) return undefined;
    const entries = git(["log", "--walk-reflogs", "-n", "200", "--format=%H %gs", "HEAD"]).split("\n").filter(Boolean)
      .map((entry) => ({ hash: entry.slice(0, entry.indexOf(" ")), subject: entry.slice(entry.indexOf(" ") + 1) }));
    const start = entries.findIndex((entry) => entry.hash === from);
    if (start <= 0) return undefined;
    moves = entries.slice(0, start).map((entry, step) => ({ from: entries[step + 1]!.hash, to: entry.hash, subject: entry.subject })).reverse();
  }
  return moves[0]?.from !== from || moves.at(-1)?.to !== to || moves.some((move, index) => index > 0 && moves[index - 1]!.to !== move.from) ? undefined : moves;
}

/** For a move HEAD's log cannot account for: the changed files left as `to` has them, when `to` is already on a remote; else none. */
function published(git: Git, previous: Observation, current: Observation, changed: string[], from: string, to: string): Set<string> {
  if (git(["rev-list", "-n", "1", to, "--not", "--remotes"]).trim() !== "") return new Set();
  // A commit pruned since cannot be compared with: any changed file may then have come with the move.
  const moved = hasCommit(git, from) ? new Set(changedBetween(git, from, to)) : undefined;
  return leftAsCommitted(git, previous, current, to, changed.filter((name) => moved === undefined || moved.has(name)));
}

/** Of `candidates`, those whose contents are what commit `to` has. */
function leftAsCommitted(git: Git, previous: Observation, current: Observation, to: string, candidates: string[]): Set<string> {
  if (candidates.length === 0) return new Set();
  const after = blobs(git, to, candidates);
  // A reset can discard staged additions, but an unrelated untracked file's deletion is the
  // shell's own write. Both are absent from HEAD; keep their earlier index status to tell them apart.
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

/** Local reads in `root`, with no shell, all done by `deadline`. A failed or oversized reading never replaces the baseline. */
function reader(root: string, deadline: number): Git {
  return (args, input) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error(`the Git reads took longer than ${OBSERVE_MS} ms`);
    return execFileSync("git", args, {
      cwd: root, input, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
    });
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
      // Hash the link itself; never read a target outside this checkout.
      const target = readlinkSync(full, { encoding: "buffer" });
      files.set(name, git(["hash-object", "--stdin", "--no-filters"], target).trim());
    } else if (stat.isFile()) regular.push(name);
    // Directories (submodules and nested repositories) are not files of this worktree.
  }
  if (regular.length > 0) {
    // Git's quoted-path syntax accepts these escapes and keeps spaces, quotes and newlines intact.
    const hashes = git(["hash-object", "--stdin-paths"], regular.map((name) => JSON.stringify(name)).join("\n") + "\n").trim().split("\n");
    if (hashes.length !== regular.length) throw new Error("incomplete file hashes");
    regular.forEach((name, index) => files.set(name, hashes[index]!));
  }
  return { files, untracked };
}
