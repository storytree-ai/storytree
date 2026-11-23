// Capability 3 · Hooks
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine, Storytree } from "@storytree/library";

import { worktreeRoot } from "../activity/branch.js";
import { filtersOff, runGit, type Git } from "../activity/git.js";
import type { DeclaredCapabilities, ImportedFolderPlace, ReadsCode } from "../claims/edit-gate.js";
import { approvedHere, importsOf, machineOf, route, type LocateOptions } from "@storytree/project-and-caller";
import { gated, refusalAnswer } from "./edit-gate.js";
import type { HookFailure } from "./failures.js";
import type { HookLines } from "./hooks.js";
import { limitOf, withinLimit, type Step } from "./learned-limits.js";
import { enqueue } from "./queue.js";
import { shellEdits } from "./shell-edits.js";

export const SHELL_GUARD = "--shell-guard";

export const SHELL_GUARD_STEP: Step = { name: "shell-guard", floorMs: 3_000, ceilingMs: 6_000 };

const NAMED = 20;

const KILL_FROM_SEARCH = [
  /(?:(?:^|[|;&(]|\$\()\s*|\n[^\S\n]*)(?:sudo\s+)?(?:ps|pgrep)\b(?:(?!&&)[^;\n])*\|\s*(?:sudo\s+)?(?:xargs\b[^|;&\n]*?\s)?kill\b/,
  /(?:^|[|;&(\s])kill\b[^|;&\n]*(?:\$\(|`)\s*(?:sudo\s+)?(?:ps|pgrep)\b/,
  /(?:(?:^|[|;&(])\s*|\n[^\S\n]*)(?:sudo\s+)?pkill\b[^|;&\n]*\s-[a-zA-Z]*f/,
];

export function killsFromSearch(command: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "''");
  return KILL_FROM_SEARCH.some((shape) => shape.test(unquoted));
}

function beforeCommand(harness: string, input: unknown, made: HookLines | undefined, locate: LocateOptions | undefined): string | undefined {
  const command = ((input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined)?.command;
  if (made === undefined || typeof command !== "string" || !killsFromSearch(command)) return undefined;
  if (route(made.folder, locate).status === "not-a-project") return undefined;
  return refusalAnswer(
    harness,
    "[storytree] Refused: this command kills what a search of the process list found, and that search also matches your own agent's process, whose command line carries the same words, so it would end you mid-work. Stop your own runs by their records instead: `storytree processes` lists them and `storytree processes stop <run>` (or the stop_own_run tool) stops one. For a process storytree did not start, kill it by the process id you have read, never by a search piped into kill.",
  );
}

export function rememberedImports(home: string, project: string): ImportedFolderPlace[] {
  try {
    const stored: unknown = JSON.parse(readFileSync(importsFile(home, project), "utf8"));
    return Array.isArray(stored) ? stored.filter((place): place is ImportedFolderPlace => typeof (place as ImportedFolderPlace)?.folder === "string") : [];
  } catch {
    return [];
  }
}

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

export async function shellGuard(harness: string, input: unknown, made: HookLines | undefined, locate: LocateOptions | undefined, machineHome: string, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void, declared?: DeclaredCapabilities, guardMs?: number, git: Git = runGit, isCode?: ReadsCode): Promise<string | undefined> {
  try {
    if (typeof input === "object" && input !== null && (input as Record<string, unknown>).hook_event_name === "PreToolUse") return beforeCommand(harness, input, made, locate);
    const limit = guardMs ?? limitOf(home, SHELL_GUARD_STEP);
    const line = made?.lines[0];
    if (made === undefined || line?.kind !== "command-run") return undefined;
    const where = route(made.folder, locate);
    if (where.status === "not-a-project" || !approvedHere(where.project, made.folder, machineHome)) return undefined;
    const imports = rememberedImports(home, where.project);
    const edits = imports.flatMap(({ folder }) => shellEdits(baselines(home), folder, line, (error) => failed("observe", error), git));
    const root = declared === undefined ? undefined : worktreeRoot(made.folder);
    const touched = root === undefined ? [] : shellEdits(worktreeBaselines(home), root, line, (error) => failed("observe", error), git).flatMap((edit) => (edit.kind === "file-edited" ? edit.files : []));
    const own = touched.length === 0 ? touched : offBase(root!, touched, git, limit);
    if (edits.length === 0 && own.length === 0) return undefined;
    if (edits.length > 0) enqueue(home, where.project, edits);
    const changed = edits.flatMap((edit) => (edit.kind === "file-edited" ? edit.files.map((file) => ({ folder: edit.folder!, file })) : []));
    const result = await withinLimit(SHELL_GUARD_STEP, limit, guardMs === undefined ? home : undefined, (limitMs) => gated(harness, { session: line.session, folder: made.folder, files: [] }, locate, machineHome, async (context, checkout, known) => {
      const { shellEditRefusals, unallowedImportEdits } = await import("../claims/edit-gate.js");
      const unallowed = new Set(changed.length === 0 ? [] : (await unallowedImportEdits(context, checkout, changed.map(({ folder, file }) => ({ path: path.join(folder, file) })), known, isCode)).map(({ path: file }) => file));
      const refused = own.length === 0 ? [] : await shellEditRefusals(context, checkout, own.map((file) => ({ path: file })), declared!);
      return { told: changed.filter(({ folder, file }) => unallowed.has(path.join(folder, file))), refused };
    }, limitMs).catch((error: unknown) => {
      failed("hook", error);
      return undefined;
    }));
    const answer = result.late ? undefined : result.answer;
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

function notice(changed: readonly { folder: string; file: string }[]): string {
  const folders = [...new Set(changed.map(({ folder }) => folder))];
  const where = folders.map((folder) => {
    const files = changed.filter((edit) => edit.folder === folder).map(({ file }) => file);
    const named = files.slice(0, NAMED).join(", ") + (files.length > NAMED ? ` and ${files.length - NAMED} more` : "");
    return `${named} in ${folder}`;
  }).join("; ");
  return `[storytree] Your last shell command changed ${where}: the user's original project, imported into storytree, which is changed only on the user's explicit permission (ADR-1015), and no yes of theirs covers these files. Do not restore them on your own, since the user may have changed their project themselves: tell the user what changed, and ask the user whether to keep it or restore it (git checkout or git clean there).`;
}

export function watchWorktree(home: string, root: string, line: NewLine, failed: (stage: HookFailure["stage"], error: unknown) => void, git: Git = runGit): void {
  if (["session-started", "command-started", "file-edited"].includes(line.kind)) shellEdits(worktreeBaselines(home), root, line, (error) => failed("observe", error), git);
}

function offBase(root: string, files: readonly string[], run: Git, limitMs: number): string[] {
  try {
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

function baselines(home: string): string {
  return path.join(home, "imported-edits");
}

function worktreeBaselines(home: string): string {
  return path.join(home, "guarded-edits");
}

function importsFile(home: string, project: string): string {
  return path.join(home, "imported-folders", `${encodeURIComponent(project)}.json`);
}
