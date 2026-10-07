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
 * at the same HEAD and a round trip between branches from no Git operation at all.
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
    const current = { head: head(git), files: snapshot(root, git), reflog: reflog?.length };
    temporary = `${file}.${randomUUID()}.part`;
    writeFileSync(temporary, JSON.stringify({ head: current.head, files: [...current.files], reflog: current.reflog }));
    renameSync(temporary, file);
    if (line.kind !== "command-run" || previous === undefined) return [];
    const changed = [...new Set([...previous.files.keys(), ...current.files.keys()])]
      .filter((name) => previous.files.get(name) !== current.files.get(name));
    const fromGit = imported(git, previous, current, changed, reflog);
    const files = changed.filter((name) => !fromGit.has(name)).sort();
    if (files.length === 0) return [];
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

interface Observation { head: string | undefined; files: Map<string, string>; reflog?: number | undefined }

function readSnapshot(file: string): Observation | undefined {
  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    // A baseline written before HEAD was recorded is a bare entry list; it still compares files.
    const { head, files: entries, reflog } = Array.isArray(stored) ? { head: undefined, files: stored, reflog: undefined }
      : (stored ?? {}) as { head?: unknown; files?: unknown; reflog?: unknown };
    return (head === undefined || typeof head === "string") && Array.isArray(entries)
      && entries.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string"))
      ? { head, files: new Map(entries as [string, string][]), ...(Number.isSafeInteger(reflog) && (reflog as number) >= 0 ? { reflog: reflog as number } : {}) } : undefined;
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
 * Anything unreadable imports nothing, so a doubtful file is still attributed.
 */
function imported(git: Git, previous: Observation, current: Observation, changed: string[], reflog: Buffer | undefined): Set<string> {
  const from = previous.head;
  const to = current.head;
  if (from === undefined || to === undefined || changed.length === 0) return new Set();
  try {
    let moves: { from: string; to: string; subject: string }[];
    if (previous.reflog !== undefined && reflog !== undefined) {
      if (previous.reflog > reflog.length) return new Set(); // expired or rewritten log
      moves = reflog.subarray(previous.reflog).toString("utf8").split("\n").filter(Boolean).map((entry) => {
        const [from = "", to = ""] = entry.split(" ");
        return { from, to, subject: entry.slice(entry.indexOf("\t") + 1) };
      });
    } else {
      // Upgrade a baseline written before offsets were kept; same-HEAD operations need a new one.
      if (from === to) return new Set();
      const entries = git(["log", "--walk-reflogs", "-n", "200", "--format=%H %gs", "HEAD"]).split("\n").filter(Boolean)
        .map((entry) => ({ hash: entry.slice(0, entry.indexOf(" ")), subject: entry.slice(entry.indexOf(" ") + 1) }));
      const start = entries.findIndex((entry) => entry.hash === from);
      if (start <= 0) return new Set();
      moves = entries.slice(0, start).map((entry, step) => ({ from: entries[step + 1]!.hash, to: entry.hash, subject: entry.subject })).reverse();
    }
    if (moves[0]?.from !== from || moves.at(-1)?.to !== to || moves.some((move, index) => index > 0 && moves[index - 1]!.to !== move.from)) return new Set();
    const brought = new Set<string>();
    const own = new Set<string>();
    for (const move of moves) {
      const restores = /^(reset|checkout)\b/.test(move.subject);
      const names = move.from === move.to ? [] : git(["diff", "--name-only", "-z", "--no-renames", move.from, move.to]).split("\0").filter(Boolean);
      if (restores) for (const name of changed) brought.add(name);
      for (const name of names) {
        (/^(pull|merge|checkout|reset|rebase)\b/.test(move.subject) ? brought : own).add(name);
        if (restores) own.delete(name);
      }
    }
    const candidates = changed.filter((name) => brought.has(name) && !own.has(name));
    if (candidates.length === 0) return new Set();
    const after = blobs(git, to, candidates);
    return new Set(candidates.filter((name) => current.files.get(name) === after.get(name)));
  } catch {
    return new Set();
  }
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

function snapshot(root: string, git: Git): Map<string, string> {
  const files = new Map<string, string>();
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
  return files;
}
