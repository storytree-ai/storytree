/**
 * Capability 19 · Worktree setup. A workspace storytree makes in a user's project is set up from the
 * project's own local file, `.storytree/worktree.local.json` in its main checkout, right after git
 * makes it (founding decision_4fa20493e9a7; behaviour borrowed from Orca's orca.yaml and
 * .worktreeinclude, rebuilt). The file is the user's, so it runs without asking, but only while git
 * does not track it: one that came with a clone waits for the user's approval (the next increment).
 *
 *   { "copy": [".env"], "share": [".cache/models"], "setup": ["pnpm install"] }
 *
 * - `copy`: gitignored files or folders, copied from the main checkout into the same place in the worktree.
 * - `share`: gitignored folders the worktree reaches in the main checkout: a junction on Windows (no
 *   developer mode needed), a symlink elsewhere.
 * - `setup`: commands, run in the worktree in order, after the copies and shares.
 *
 * Every path stays inside the repository: no `..`, no absolute path, no link leading out. Copies are
 * capped by size and entry count. A step that fails is reported with why, and the rest still run;
 * nothing here ever undoes the claim or the worktree.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

/** Where the local file sits, from the repository's root. */
export const LOCAL_SETUP_FILE = ".storytree/worktree.local.json";

/** One step of a worktree's setup, and how it went. */
export interface SetupStep {
  readonly kind: "file" | "copy" | "share" | "run";
  /** The path or command the file named, or the local file itself. */
  readonly what: string;
  readonly ok: boolean;
  /** Why it failed. */
  readonly why?: string;
}

/** What setting a worktree up did: the local file it read and each step it took. */
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
}

const COPY_BYTES = 100 * 1024 * 1024;
const COPY_ENTRIES = 10_000;
const COMMAND_MS = 20 * 60_000;
const KEYS = ["copy", "share", "setup"] as const;

/**
 * Set the new worktree `worktree` up from the local file in the main checkout `repository`.
 * Undefined when the project has no local file: nothing is run, copied or shared. Never throws.
 */
export function setUpWorktree(repository: string, worktree: string, limits: SetupLimits = {}): WorktreeSetup | undefined {
  const file = path.join(repository, ...LOCAL_SETUP_FILE.split("/"));
  if (!existsSync(file)) return undefined;
  const failed = (why: string): WorktreeSetup => ({ file: LOCAL_SETUP_FILE, steps: [{ kind: "file", what: LOCAL_SETUP_FILE, ok: false, why }] });
  if (tracked(repository, LOCAL_SETUP_FILE)) return failed("git tracks it, so it is not this computer's own; a checked-in setup runs only once you approve it, so nothing was run");
  let named: Record<(typeof KEYS)[number], string[]>;
  try {
    named = parse(readFileSync(file, "utf8"));
  } catch (error) {
    return failed(`it cannot be read as the setup file: ${error instanceof Error ? error.message : String(error)}`);
  }
  const steps: SetupStep[] = [];
  const budget = { bytes: limits.copyBytes ?? COPY_BYTES, entries: limits.copyEntries ?? COPY_ENTRIES };
  for (const what of named.copy) steps.push(attempt("copy", what, () => copyInto(repository, worktree, what, budget)));
  for (const what of named.share) steps.push(attempt("share", what, () => share(repository, worktree, what)));
  for (const what of named.setup) steps.push(attempt("run", what, () => runIn(worktree, what, limits.commandMs ?? COMMAND_MS)));
  return { file: LOCAL_SETUP_FILE, steps };
}

/** What a setup did, a line for each step, for an agent to read. */
export function setupText(setup: WorktreeSetup): string {
  const verb = { file: "read", copy: "copied", share: "shared", run: "ran" } as const;
  const lines = setup.steps.map((step) => step.ok ? `  ${verb[step.kind]} ${step.what}` : `  FAILED ${step.kind === "file" ? "to read" : step.kind} ${step.what}: ${step.why}`);
  const failures = setup.steps.filter((step) => !step.ok).length;
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

function parse(text: string): Record<(typeof KEYS)[number], string[]> {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("it must be a JSON object");
  const unknown = Object.keys(value).filter((key) => !(KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`it names ${unknown.join(", ")}, which is not one of ${KEYS.join(", ")}`);
  const list = (key: (typeof KEYS)[number]): string[] => {
    const entries = (value as Record<string, unknown>)[key] ?? [];
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || entry.trim() === "")) throw new Error(`${key} must be a list of non-empty strings`);
    return entries as string[];
  };
  return { copy: list("copy"), share: list("share"), setup: list("setup") };
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
