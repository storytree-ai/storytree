/**
 * Capability 3 · Hooks. The hook after each shell command that the harness waits for (`--shell-guard`, ADR-1015): a
 * command that changed or deleted files in a folder the project imports, which no yes of the user's covers, is told to
 * the agent at once, and recorded as an edit there where the user sees it. A shell command cannot be read reliably
 * before it runs, so it is caught after: each imported folder keeps a baseline of its files per session (shell-edits.ts,
 * under its own home so it never shares one with the worktree's), which the ordinary hooks set at the session's start,
 * before a command and after an edit tool, and which the guard compares after the command.
 *
 * The guard does not read the library to find the imported folders: the ordinary hooks remember them on this machine
 * once the checkout's approval is known. It reaches storytree only when something changed there, to ask which changes
 * the user's yes covers; when it cannot in time, it tells the agent of them all. It tells the agent to ask the user,
 * never to restore: the user may have changed their own project themselves between two commands (ADR-1015 D4).
 *
 * Given the map's rule for which capability a file declares, it also compares the session's own worktree with a baseline
 * of its own, and tells the agent of each changed file the hook before an edit tool would have refused: in a capability
 * its increment does not list, or another live session holds (ADR-0949 D3), unless the file is back as the branch's base
 * has it. That needs storytree; unreached in time, it says nothing of them, as the gate lets an edit go ahead.
 * Like every hook it never breaks the agent: on any failure it says nothing.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine, Storytree } from "@storytree/library";

import { worktreeRoot } from "../activity/branch.js";
import { filtersOff, runGit, type Git } from "../activity/git.js";
import type { DeclaredCapabilities, ImportedFolderPlace } from "../claims/edit-gate.js";
import { approvedHere, importsOf, machineOf, route, type LocateOptions } from "@storytree/project-and-caller";
import { gated } from "./edit-gate.js";
import type { HookFailure } from "./failures.js";
import type { HookLines } from "./hooks.js";
import { limitOf, withinLimit, type Step } from "./learned-limits.js";
import { enqueue } from "./queue.js";
import { shellEdits } from "./shell-edits.js";

/** The flag of the hook after each shell command that the harness waits for. */
export const SHELL_GUARD = "--shell-guard";

/**
 * How long the guard may take to ask which changes a yes covers, and each Git read comparing the worktree with its
 * base: the harness waits on it. Learned on each machine (ADR-1163 D2), never under the 3 s it was fixed at, nor over
 * 6 s, so the guard and the observations before it stay inside the hook's 9 s (GUARDED_DEADLINE_MS).
 */
export const SHELL_GUARD_STEP: Step = { name: "shell-guard", floorMs: 3_000, ceilingMs: 6_000 };

/** The most changed files a notice names one by one. */
const NAMED = 20;

/** The folders `project` imports on this machine, as the ordinary hooks last remembered them; none when they never did. */
export function rememberedImports(home: string, project: string): ImportedFolderPlace[] {
  try {
    const stored: unknown = JSON.parse(readFileSync(importsFile(home, project), "utf8"));
    return Array.isArray(stored) ? stored.filter((place): place is ImportedFolderPlace => typeof (place as ImportedFolderPlace)?.folder === "string") : [];
  } catch {
    return [];
  }
}

/**
 * After an ordinary hook reached storytree in an approved checkout of `project`: remember the folders it imports on this
 * machine, and set their baselines for `line`'s session (at its start, before a command, after an edit tool, so an edit
 * the gate let through is not blamed on the next command). Never throws; `failed` keeps why.
 */
export async function watchImports(storytree: Storytree, project: string, machineHome: string, home: string, line: NewLine, failed: (stage: HookFailure["stage"], error: unknown) => void, git: Git = runGit): Promise<void> {
  if (!["session-started", "command-started", "file-edited"].includes(line.kind)) return;
  try {
    const imports = (await importsOf(storytree, project, machineOf(machineHome).id)).map(({ folder, repository }) => ({ folder, ...(repository === undefined ? {} : { repository }) }));
    const file = importsFile(home, project);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.${process.pid}.part`, JSON.stringify(imports));
    renameSync(`${file}.${process.pid}.part`, file);
    for (const { folder } of imports) shellEdits(baselines(home), folder, line, (error) => failed("observe", error), git);
  } catch (error) {
    failed("observe", error);
  }
}

/**
 * The guard's answer after a shell command, for the agent; undefined for nothing to say. Each imported folder's changes
 * are recorded (queued for the next hook to upload); those no yes covers are told. It runs no git, and says nothing, in a
 * checkout this machine does not know as approved (contract 3.46). It may take `guardMs` when given, else the time this
 * machine learned in `home`, which learns how long asking storytree took. Never throws.
 */
export async function shellGuard(harness: string, input: unknown, made: HookLines | undefined, locate: LocateOptions | undefined, machineHome: string, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void, declared?: DeclaredCapabilities, guardMs?: number, git: Git = runGit): Promise<string | undefined> {
  try {
    const limit = guardMs ?? limitOf(home, SHELL_GUARD_STEP);
    const line = made?.lines[0];
    if (made === undefined || line?.kind !== "command-run") return undefined;
    const where = route(made.folder, locate);
    if (where.status === "not-a-project" || !approvedHere(where.project, made.folder, machineHome)) return undefined;
    const imports = rememberedImports(home, where.project);
    const edits = imports.flatMap(({ folder }) => shellEdits(baselines(home), folder, line, (error) => failed("observe", error), git));
    // The session's own worktree, observed apart from the ordinary hooks' baseline, whose lines record the same edits.
    const root = declared === undefined ? undefined : worktreeRoot(made.folder);
    const touched = root === undefined ? [] : shellEdits(worktreeBaselines(home), root, line, (error) => failed("observe", error), git).flatMap((edit) => (edit.kind === "file-edited" ? edit.files : []));
    const own = touched.length === 0 ? touched : offBase(root!, touched, git, limit);
    if (edits.length === 0 && own.length === 0) return undefined;
    if (edits.length > 0) enqueue(home, where.project, edits);
    const changed = edits.flatMap((edit) => (edit.kind === "file-edited" ? edit.files.map((file) => ({ folder: edit.folder!, file })) : []));
    const result = await withinLimit(SHELL_GUARD_STEP, limit, guardMs === undefined ? home : undefined, (limitMs) => gated(harness, { session: line.session, folder: made.folder, files: [] }, locate, machineHome, async (context, checkout, known) => {
      const { shellEditRefusals, unallowedImportEdits } = await import("../claims/edit-gate.js");
      const unallowed = new Set(changed.length === 0 ? [] : (await unallowedImportEdits(context, checkout, changed.map(({ folder, file }) => ({ path: path.join(folder, file) })), known)).map(({ path: file }) => file));
      const refused = own.length === 0 ? [] : await shellEditRefusals(context, checkout, own.map((file) => ({ path: file })), declared!);
      return { told: changed.filter(({ folder, file }) => unallowed.has(path.join(folder, file))), refused };
    }, limitMs).catch((error: unknown) => {
      failed("hook", error);
      return undefined;
    }));
    const answer = result.late ? undefined : result.answer;
    // Imported changes storytree could not judge in time are all told; the worktree's, like an edit the gate could not judge, go ahead.
    const told = answer?.told ?? changed;
    const refused = answer?.refused ?? [];
    if (told.length === 0 && refused.length === 0) return undefined;
    const { refusalMessage } = await import("../claims/edit-gate.js");
    const said = [...(told.length === 0 ? [] : [notice(told)]), ...refused.map((refusal) => refusalMessage(refusal, true))].join("\n\n");
    const event = typeof input === "object" && input !== null ? (input as Record<string, unknown>).hook_event_name : undefined;
    return harness === "claude-code" || harness === "codex"
      ? JSON.stringify({ hookSpecificOutput: { hookEventName: typeof event === "string" ? event : "PostToolUse", additionalContext: said } })
      : undefined;
  } catch (error) {
    failed("hook", error);
    return undefined;
  }
}

/** What the agent reads: which files its command changed in which imported folder, and to ask the user. */
function notice(changed: readonly { folder: string; file: string }[]): string {
  const folders = [...new Set(changed.map(({ folder }) => folder))];
  const where = folders.map((folder) => {
    const files = changed.filter((edit) => edit.folder === folder).map(({ file }) => file);
    const named = files.slice(0, NAMED).join(", ") + (files.length > NAMED ? ` and ${files.length - NAMED} more` : "");
    return `${named} in ${folder}`;
  }).join("; ");
  return `[storytree] Your last shell command changed ${where}: the user's original project, imported into storytree, which is changed only on the user's explicit permission (ADR-1015), and no yes of theirs covers these files. Do not restore them on your own, since the user may have changed their project themselves: tell the user what changed, and ask the user whether to keep it or restore it (git checkout or git clean there).`;
}

/**
 * After an ordinary hook in the worktree at `root`: set the guard's own baseline there for `line`'s session (at its start,
 * before a command, after an edit tool, so an edit the gate already judged is not told again after the next command).
 */
export function watchWorktree(home: string, root: string, line: NewLine, failed: (stage: HookFailure["stage"], error: unknown) => void, git: Git = runGit): void {
  if (["session-started", "command-started", "file-edited"].includes(line.kind)) shellEdits(worktreeBaselines(home), root, line, (error) => failed("observe", error), git);
}

/**
 * Of `files` in the worktree at `root`, those whose content is not what the branch's base has: the merge base with
 * origin/main, else HEAD. A command that returns a file there, as a git checkout undoing a trespass does, changed
 * nothing the branch carries (friction_53b3f12c30aa). When Git cannot say, every file counts as changed.
 */
function offBase(root: string, files: readonly string[], run: Git, limitMs: number): string[] {
  try {
    // Hashing would start the clean filters the repository's config names on its files' content.
    const off = filtersOff(run, root, limitMs);
    const git = (args: string[], input?: string) => run([...off, "--no-optional-locks", ...args], { cwd: root, ...(input === undefined ? {} : { input }), timeout: limitMs, maxBuffer: 8 * 1024 * 1024 });
    let base: string;
    try { base = git(["merge-base", "HEAD", "origin/main"]).trim(); } catch { base = git(["rev-parse", "--verify", "HEAD^{commit}"]).trim(); }
    const was = new Map<string, string>();
    for (const entry of git(["--literal-pathspecs", "ls-tree", "-r", "-z", base, "--", ...files]).split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab > 0) was.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]!);
    }
    const present = files.filter((file) => existsSync(path.join(root, file)));
    const hashes = present.length === 0 ? [] : git(["hash-object", "--stdin-paths"], present.map((file) => JSON.stringify(file)).join("\n") + "\n").trim().split("\n");
    const now = new Map(present.map((file, index) => [file, hashes[index]] as const));
    return files.filter((file) => now.get(file) !== was.get(file));
  } catch {
    return [...files];
  }
}

/** Where the imported folders' baselines are kept: apart from the worktrees' own. */
function baselines(home: string): string {
  return path.join(home, "imported-edits");
}

/** Where the guard's baselines of the session's worktree are kept: apart from the ordinary hooks', which record its edits. */
function worktreeBaselines(home: string): string {
  return path.join(home, "guarded-edits");
}

function importsFile(home: string, project: string): string {
  return path.join(home, "imported-folders", `${encodeURIComponent(project)}.json`);
}
