/**
 * Capability 19 · Worktree setup. A workspace storytree makes in a user's project is set up from the
 * project's own local file, `.storytree/worktree.local.json` in its main checkout, right after git
 * makes it (founding decision_4fa20493e9a7; behaviour borrowed from Orca's orca.yaml and
 * .worktreeinclude, rebuilt). The file is the user's, so it runs without asking, but only while git
 * does not track it. A team's checked-in `.storytree/worktree.json`, with the same keys, is read
 * beside it, the local file winning key by key; a clone must not make storytree run a command the
 * user never saw, so the checked-in file's commands run only once the user has approved that exact
 * set (`storytree workspace approve-setup <fingerprint>`, kept in their settings), and are asked
 * again when they change (Orca's trust gate, 19.6-19.8). Until then the rest of its setup runs, and
 * its answer says how to approve, or, when an agent runs alone, that no one is here to.
 *
 *   { "copy": [".env"], "share": [".cache/models"], "setup": ["pnpm install"], "teardown": ["docker compose down"] }
 *
 * - `copy`: gitignored files or folders, copied from the main checkout into the same place in the worktree.
 * - `share`: gitignored folders the worktree reaches in the main checkout: a junction on Windows (no
 *   developer mode needed), a symlink elsewhere.
 * - `setup`: commands, run in the worktree in order, after the copies and shares.
 * - `teardown`: commands, run in the worktree in order when the reaper is about to remove it (19.4).
 *
 * A worktree set up here is marked in its own git folder, which git prunes with it, so it is set up
 * once however often it is attached, and the marker carries the teardown the file named at setup:
 * those are the commands that undo this setup, whatever the file says by the time it is reaped.
 * The reaper runs in a hook with seconds to spare, so teardown runs in a detached process of its
 * own, started when the reaper would remove the worktree; the reaper keeps the worktree until that
 * process has finished, then removes it on a later pass, a failed command included. Teardown never
 * keeps a worktree for good: its cleanliness was judged before teardown began.
 *
 * Every path stays inside the repository: no `..`, no absolute path, no link leading out. Copies are
 * capped by size and entry count. A step that fails is reported with why, and the rest still run;
 * nothing here ever undoes the claim or the worktree.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readSetupApproval, setSetupApproval } from "@storytree/project-and-caller";

/** Where the local file sits, from the repository's root. */
export const LOCAL_SETUP_FILE = ".storytree/worktree.local.json";
/** Where a team's checked-in file sits, from the repository's root: its commands wait for the user's approval. */
export const CHECKED_IN_SETUP_FILE = ".storytree/worktree.json";

/** One step of a worktree's setup, and how it went. */
export interface SetupStep {
  readonly kind: "file" | "copy" | "share" | "run" | "approve";
  /** The path or command the file named, or the local file itself. */
  readonly what: string;
  readonly ok: boolean;
  /** Why it failed. */
  readonly why?: string;
}

/** What setting a worktree up did: the files it read and each step it took. */
export interface WorktreeSetup {
  readonly file: string;
  readonly steps: readonly SetupStep[];
}

export interface SetupLimits {
  /** Bytes copied across every `copy`, at most. By default, 100 MB. */
  readonly copyBytes?: number;
  /** Files and folders copied across every `copy`, at most. By default, 10,000. */
  readonly copyEntries?: number;
  /** How long one setup command may run. By default, 20 minutes. */
  readonly commandMs?: number;
  /** Whether a person attends the session, who could approve a checked-in setup. By default, unless the harness says no one does (CLAUDE_CODE_SESSION_ATTENDED=0). */
  readonly attended?: boolean;
  /** The storytree home whose settings hold the user's approvals. By default, this computer's. */
  readonly home?: string;
}

const COPY_BYTES = 100 * 1024 * 1024;
const COPY_ENTRIES = 10_000;
const COMMAND_MS = 20 * 60_000;
const KEYS = ["copy", "share", "setup", "teardown"] as const;
/** The marker of a worktree set up here, in its own git folder. */
const MARK = "storytree-setup.json";
/** How long a teardown that has not yet written its pid is taken to be starting. */
const STARTING_MS = 60_000;

/**
 * Set the new worktree `worktree` up from the local file in the main checkout `repository`, and the
 * checked-in one beside it. Undefined when the project has neither: nothing is run, copied or shared. Never throws.
 */
export function setUpWorktree(repository: string, worktree: string, limits: SetupLimits = {}): WorktreeSetup | undefined {
  const local = path.join(repository, ...LOCAL_SETUP_FILE.split("/"));
  const checkedIn = path.join(repository, ...CHECKED_IN_SETUP_FILE.split("/"));
  const files = [existsSync(local) ? LOCAL_SETUP_FILE : undefined, existsSync(checkedIn) ? CHECKED_IN_SETUP_FILE : undefined].filter((file) => file !== undefined);
  if (files.length === 0) return undefined;
  const failed = (file: string, why: string): WorktreeSetup => ({ file, steps: [{ kind: "file", what: file, ok: false, why }] });
  if (files.includes(LOCAL_SETUP_FILE) && tracked(repository, LOCAL_SETUP_FILE)) return failed(LOCAL_SETUP_FILE, `git tracks it, so it is not this computer's own; name a team's setup in ${CHECKED_IN_SETUP_FILE} instead, whose commands run once you approve them, so nothing was run`);
  const read = (file: string, where: string) => {
    try {
      return parse(readFileSync(where, "utf8"));
    } catch (error) {
      return `it cannot be read as the setup file: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const mine = files.includes(LOCAL_SETUP_FILE) ? read(LOCAL_SETUP_FILE, local) : {};
  if (typeof mine === "string") return failed(LOCAL_SETUP_FILE, mine);
  const theirs = files.includes(CHECKED_IN_SETUP_FILE) ? read(CHECKED_IN_SETUP_FILE, checkedIn) : {};
  if (typeof theirs === "string") return failed(CHECKED_IN_SETUP_FILE, theirs);
  const file = files.join(" and ");
  const steps: SetupStep[] = [];
  // The local file wins key by key; commands left to the checked-in file wait for the user's approval of that exact set.
  const named = Object.fromEntries(KEYS.map((key) => [key, mine[key] ?? theirs[key] ?? []])) as Record<(typeof KEYS)[number], string[]>;
  const gated = { setup: mine.setup === undefined ? theirs.setup ?? [] : [], teardown: mine.teardown === undefined ? theirs.teardown ?? [] : [] };
  if (gated.setup.length + gated.teardown.length > 0) {
    const asked = approvalNeeded(repository, gated, limits);
    if (asked !== undefined) {
      steps.push(asked);
      if (mine.setup === undefined) named.setup = [];
      if (mine.teardown === undefined) named.teardown = [];
    }
  }
  const budget = { bytes: limits.copyBytes ?? COPY_BYTES, entries: limits.copyEntries ?? COPY_ENTRIES };
  for (const what of named.copy) steps.push(attempt("copy", what, () => copyInto(repository, worktree, what, budget)));
  for (const what of named.share) steps.push(attempt("share", what, () => share(repository, worktree, what)));
  for (const what of named.setup) steps.push(attempt("run", what, () => runIn(worktree, what, limits.commandMs ?? COMMAND_MS)));
  const mark = markOf(worktree);
  if (mark !== undefined) {
    try {
      writeFileSync(mark, JSON.stringify({ teardown: named.teardown } satisfies Mark));
    } catch {
      // Unmarked, it may be set up again on a later attach, and its teardown does not run.
    }
  }
  return { file, steps };
}

/** The fingerprint of a checked-in setup's commands: what the user approves, and what changes when they do. */
export function setupFingerprint(commands: { readonly setup: readonly string[]; readonly teardown: readonly string[] }): string {
  return createHash("sha256").update(JSON.stringify({ setup: commands.setup, teardown: commands.teardown })).digest("hex").slice(0, 16);
}

/** The step saying the checked-in commands wait for the user's approval, or undefined when they have approved exactly these. */
function approvalNeeded(repository: string, gated: { setup: readonly string[]; teardown: readonly string[] }, limits: SetupLimits): SetupStep | undefined {
  const fingerprint = setupFingerprint(gated);
  const what = `the commands of ${CHECKED_IN_SETUP_FILE}`;
  let approved: string | undefined;
  try {
    approved = readSetupApproval(realpathSync(repository), limits.home)?.fingerprint;
  } catch (error) {
    return { kind: "approve", what, ok: false, why: `your settings cannot be read, so whether you approved them is unknown: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (approved === fingerprint) return undefined;
  const commands = [...gated.setup.map((one) => `setup: ${one}`), ...gated.teardown.map((one) => `teardown: ${one}`)].join("; ");
  const approve = `storytree workspace approve-setup ${fingerprint}`;
  const changed = approved === undefined ? "" : "they changed since you approved them, so ";
  const attended = limits.attended ?? process.env.CLAUDE_CODE_SESSION_ATTENDED !== "0";
  return {
    kind: "approve", what, ok: false,
    why: attended
      ? `${changed}setup needs approval: run \`${approve}\` at your own terminal to approve them (${commands}); workspaces made after that run them`
      : `${changed}they need the user's approval and no one is here to approve them, so they were not run (${commands}); the user may run \`${approve}\` at their own terminal`,
  };
}

/**
 * Record the user's approval of the checked-in setup commands of the repository `folder` is in, when
 * `fingerprint` is theirs now; otherwise the reason it is refused, and nothing is recorded.
 */
export function approveCheckedInSetup(folder: string, fingerprint: string, home?: string): { ok: true; commands: readonly string[] } | { ok: false; reason: string } {
  let repository: string;
  try {
    const common = path.resolve(folder, execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, encoding: "utf8", windowsHide: true }).trim());
    repository = realpathSync(path.basename(common) === ".git" ? path.dirname(common) : common);
  } catch {
    return { ok: false, reason: `${folder} is not in a git repository.` };
  }
  const read = (file: string) => {
    const where = path.join(repository, ...file.split("/"));
    return existsSync(where) ? parse(readFileSync(where, "utf8")) : {};
  };
  let gated: { setup: string[]; teardown: string[] };
  try {
    const mine = tracked(repository, LOCAL_SETUP_FILE) ? {} : read(LOCAL_SETUP_FILE);
    const theirs = read(CHECKED_IN_SETUP_FILE);
    gated = { setup: mine.setup === undefined ? theirs.setup ?? [] : [], teardown: mine.teardown === undefined ? theirs.teardown ?? [] : [] };
  } catch (error) {
    return { ok: false, reason: `The setup files cannot be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const commands = [...gated.setup, ...gated.teardown];
  if (commands.length === 0) return { ok: false, reason: `${CHECKED_IN_SETUP_FILE} names no commands that wait for your approval, so there is nothing to approve.` };
  if (setupFingerprint(gated) !== fingerprint) return { ok: false, reason: `${fingerprint} is not the fingerprint of ${CHECKED_IN_SETUP_FILE}'s commands as they are now: they may have changed since you were asked. Make a workspace again to see them and their fingerprint.` };
  setSetupApproval(repository, fingerprint, home);
  return { ok: true, commands };
}

/** Whether storytree has already set `worktree` up. */
export function wasSetUp(worktree: string): boolean {
  const mark = markOf(worktree);
  return mark !== undefined && existsSync(mark);
}

/** A set-up worktree's marker: the teardown it was set up with, and how running it has gone. */
interface Mark {
  readonly teardown: readonly string[];
  /** When the reaper started the teardown, and the pid of the process running it once that has begun. */
  readonly started?: { readonly at: number; readonly pid?: number };
  /** Each teardown command, and how it went. */
  readonly ran?: readonly SetupStep[];
}

/**
 * Where `worktree`'s teardown stands: "none" when it was never set up here or names no teardown,
 * "due" before it has started, "running" while its process runs (the worktree must stay), and
 * "done" once that process has finished or died. Never throws: a marker it cannot read is "none",
 * unless it was written in the last minute: then a write is taken to be in flight (each write
 * empties the file before filling it), and it reads "running".
 */
export function teardownState(worktree: string): "none" | "due" | "running" | "done" {
  const mark = readMark(worktree)?.mark;
  if (mark === undefined) return writtenWithin(markOf(worktree), STARTING_MS) ? "running" : "none";
  if (!Array.isArray(mark.teardown) || mark.teardown.length === 0) return "none";
  if (mark.ran !== undefined) return "done";
  if (mark.started === undefined) return "due";
  const { at, pid } = mark.started;
  return (pid === undefined ? Date.now() - at < STARTING_MS : isAlive(pid)) ? "running" : "done";
}

/** Start `worktree`'s due teardown in a detached process that outlives the caller. Never throws: one that cannot start is left "done". */
export function startTeardown(worktree: string, limits: Pick<SetupLimits, "commandMs"> = {}): void {
  const read = readMark(worktree);
  if (read === undefined) return;
  try {
    writeFileSync(read.where, JSON.stringify({ ...read.mark, started: { at: Date.now() } } satisfies Mark));
    const child = spawn(process.execPath, ["-e", TEARDOWN, read.where, worktree, String(limits.commandMs ?? COMMAND_MS)], { cwd: path.dirname(read.where), detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Started, never run: the marker reads "done" once its start is a minute old.
  }
}

function readMark(worktree: string): { where: string; mark: Mark } | undefined {
  const where = markOf(worktree);
  try {
    return where === undefined ? undefined : { where, mark: JSON.parse(readFileSync(where, "utf8")) as Mark };
  } catch {
    return undefined;
  }
}

/**
 * The script that runs a marker's teardown: it writes its pid, runs each command in the worktree,
 * a failed one not stopping the rest, and writes what each did. Its arguments: the marker, the
 * worktree, and how long one command may run.
 */
const TEARDOWN = `
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [mark, worktree, ms] = process.argv.slice(1);
const read = () => JSON.parse(fs.readFileSync(mark, "utf8"));
fs.writeFileSync(mark, JSON.stringify({ ...read(), started: { at: Date.now(), pid: process.pid } }));
const ran = read().teardown.map((what) => {
  const done = spawnSync(what, { cwd: worktree, shell: true, stdio: "ignore", timeout: Number(ms), windowsHide: true });
  return done.status === 0 ? { kind: "run", what, ok: true } : { kind: "run", what, ok: false, why: done.error ? done.error.message : "it exited " + done.status };
});
fs.writeFileSync(mark, JSON.stringify({ ...read(), ran }));
`;

/** Where `worktree`'s marker goes: its own git folder, as its `.git` file names it, which git prunes with it. Read, not asked of git, so a hook spends no process on it. */
function markOf(worktree: string): string | undefined {
  try {
    const named = /^gitdir: (.+)$/m.exec(readFileSync(path.join(worktree, ".git"), "utf8"))?.[1]?.trim();
    return named === undefined ? undefined : path.join(path.resolve(worktree, named), MARK);
  } catch {
    // The main checkout's .git is a folder, and a folder with none is no worktree: neither is marked.
    return undefined;
  }
}

function writtenWithin(file: string | undefined, ms: number): boolean {
  try {
    return file !== undefined && Date.now() - statSync(file).mtimeMs < ms;
  } catch {
    return false;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Alive, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What a setup did, a line for each step, for an agent to read. */
export function setupText(setup: WorktreeSetup): string {
  const verb = { file: "read", copy: "copied", share: "shared", run: "ran", approve: "approved" } as const;
  const lines = setup.steps.map((step) => step.ok ? `  ${verb[step.kind]} ${step.what}`
    : step.kind === "approve" ? `  SKIPPED ${step.what}: ${step.why}`
    : `  FAILED ${step.kind === "file" ? "to read" : step.kind} ${step.what}: ${step.why}`);
  const failures = setup.steps.filter((step) => !step.ok && step.kind !== "approve").length;
  const head = failures === 0 ? `Set up from ${setup.file}:` : `Set up from ${setup.file}, with ${failures} step${failures === 1 ? "" : "s"} failed (the claim and the worktree are kept; finish those by hand):`;
  return [head, ...lines].join("\n");
}

function attempt(kind: SetupStep["kind"], what: string, step: () => void): SetupStep {
  try {
    step();
    return { kind, what, ok: true };
  } catch (error) {
    return { kind, what, ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/** The keys a setup file names, each a list of non-empty strings; a key it leaves out is left out here too. */
function parse(text: string): Partial<Record<(typeof KEYS)[number], string[]>> {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("it must be a JSON object");
  const unknown = Object.keys(value).filter((key) => !(KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`it names ${unknown.join(", ")}, which is not one of ${KEYS.join(", ")}`);
  const named: Partial<Record<(typeof KEYS)[number], string[]>> = {};
  for (const key of KEYS) {
    const entries = (value as Record<string, unknown>)[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || entry.trim() === "")) throw new Error(`${key} must be a list of non-empty strings`);
    named[key] = entries as string[];
  }
  return named;
}

/** The relative path `what` names, refused when it is absolute or climbs out with `..`. */
function relative(what: string): string {
  if (path.isAbsolute(what) || path.win32.isAbsolute(what) || path.posix.isAbsolute(what)) throw new Error("an absolute path; name it from the repository's root");
  const parts = what.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) throw new Error("it climbs out with `..`; name a path inside the repository");
  if (parts.length === 0 || parts[0] === ".git") throw new Error("it names no path inside the repository");
  return parts.join("/");
}

/** The source in the main checkout for `what`: inside the repository, even through links, and gitignored. */
function sourceOf(repository: string, what: string): { rel: string; source: string } {
  const rel = relative(what);
  const source = path.join(repository, ...rel.split("/"));
  if (!existsSync(source)) throw new Error("the main checkout has nothing there");
  if (!within(realpathSync(repository), realpathSync(source))) throw new Error("a link leads it out of the repository");
  if (!ignored(repository, rel)) throw new Error("git does not ignore it, so the worktree would hold it as untracked; only gitignored paths are copied or shared");
  return { rel, source };
}

/** The place in the worktree for `rel`: free, with its folder made inside the worktree. */
function destinationOf(worktree: string, rel: string): string {
  const destination = path.join(worktree, ...rel.split("/"));
  if (existsSync(destination) || isLink(destination)) throw new Error("the worktree already has something there");
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  if (!within(realpathSync(worktree), realpathSync(parent))) throw new Error("a link leads it out of the worktree");
  return destination;
}

function copyInto(repository: string, worktree: string, what: string, budget: { bytes: number; entries: number }): void {
  const { rel, source } = sourceOf(repository, what);
  const plan = measure(source);
  if (plan.links > 0) throw new Error("it holds a link, which is not copied; share the folder instead");
  if (plan.bytes > budget.bytes || plan.entries > budget.entries) {
    throw new Error(`copying it (${plan.entries} entries, ${plan.bytes} bytes) would pass the cap of ${budget.entries} entries and ${budget.bytes} bytes still left; share it instead`);
  }
  budget.bytes -= plan.bytes;
  budget.entries -= plan.entries;
  copy(source, destinationOf(worktree, rel));
}

function share(repository: string, worktree: string, what: string): void {
  const { rel, source } = sourceOf(repository, what);
  if (!lstatSync(source).isDirectory()) throw new Error("only a folder is shared; copy a file instead");
  symlinkSync(source, destinationOf(worktree, rel), process.platform === "win32" ? "junction" : "dir");
}

function runIn(worktree: string, command: string, timeout: number): void {
  const ran = spawnSync(command, { cwd: worktree, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true });
  if (ran.error !== undefined && (ran.error as NodeJS.ErrnoException).code === "ETIMEDOUT") throw new Error(`it ran past ${Math.round(timeout / 60_000)} minutes and was stopped`);
  if (ran.error !== undefined) throw new Error(`it could not start: ${ran.error.message}`);
  if (ran.status !== 0) {
    const said = `${ran.stderr ?? ""}\n${ran.stdout ?? ""}`.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    const ended = ran.status === null ? `it was stopped (${ran.signal ?? "a signal"})` : `it exited ${ran.status}`;
    throw new Error(said.length > 0 ? `${ended}: ${said[0]}` : ended);
  }
}

function measure(source: string): { bytes: number; entries: number; links: number } {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) return { bytes: 0, entries: 1, links: 1 };
  if (!stat.isDirectory()) return { bytes: stat.size, entries: 1, links: 0 };
  const total = { bytes: 0, entries: 1, links: 0 };
  for (const name of readdirSync(source)) {
    const inner = measure(path.join(source, name));
    total.bytes += inner.bytes;
    total.entries += inner.entries;
    total.links += inner.links;
  }
  return total;
}

function copy(source: string, destination: string): void {
  if (!lstatSync(source).isDirectory()) {
    copyFileSync(source, destination);
    return;
  }
  mkdirSync(destination);
  for (const name of readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
}

function within(root: string, candidate: string): boolean {
  const between = path.relative(root, candidate);
  return between === "" || (!between.startsWith("..") && !path.isAbsolute(between));
}

function isLink(where: string): boolean {
  try {
    return lstatSync(where).isSymbolicLink();
  } catch {
    return false;
  }
}

function tracked(repository: string, rel: string): boolean {
  return git(repository, ["ls-files", "--error-unmatch", "--", rel]);
}

function ignored(repository: string, rel: string): boolean {
  return git(repository, ["check-ignore", "--quiet", "--", rel]);
}

/** Whether git, run in `cwd`, exits 0. */
function git(cwd: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore", timeout: 30_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
