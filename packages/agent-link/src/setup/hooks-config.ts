/**
 * Registering storytree's hooks in each harness's own user-level settings, and taking them out
 * again: only ever storytree's entries, recognised by the hook script they run
 * (`storytree-hook.mjs`), so every other setting is left exactly as it was.
 *
 * - Claude Code: `<config folder>/settings.json` (CLAUDE_CONFIG_DIR, else ~/.claude). Each hook is a
 *   program with arguments, run with no shell in between, so it works on Windows without a Unix
 *   shell. The start, edit and end-of-turn hooks, and the one before each shell command, run in the
 *   background (`async`); the end hook runs before Claude Code exits, the hook before storytree's
 *   own tools before the call is made, so its line is there when the call reaches the tool server
 *   (ADR-0629 D2), and the prompt hook before the prompt reaches the agent, since what it prints is
 *   added for the agent (ADR-0636 D1). Without Git for Windows, Claude Code has no Bash tool and
 *   runs commands with its PowerShell tool, so each hook that listens for Bash listens for it too.
 * - Codex: `<CODEX_HOME>/hooks.json` (else ~/.codex). Codex runs a hook as one command line through
 *   its shell (PowerShell on Windows, sh elsewhere), so the line is written for the shell of this
 *   machine. Codex has no background hooks, so the ones before each shell command and at the end of
 *   each turn pass `--background`: the hook hands its writing to a copy of itself and exits (hooks.ts).
 *   Codex runs a newly added hook only after the user approves it once (ADR-0626 D4).
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { BACKGROUND, STORYTREE_TOOLS } from "../hooks/index.js";

/** The command a harness runs as storytree's hook: a Node and the built hook script. */
export interface HookCommand {
  readonly node: string;
  readonly script: string;
}

/** Where each harness keeps its settings: Claude Code's config folder (~/.claude) and Codex's home (~/.codex). */
export interface Homes {
  readonly claude?: string;
  readonly codex?: string;
}

/** What registering found: storytree's hooks added now, already there, or no such harness on this machine. */
export type HookRegistration = "registered" | "already registered" | "not here";

/**
 * What installing Claude Code's status line found (ADR-0636 D1, b3): storytree's installed now or
 * already there, a status line of the user's own left as it is, or no Claude Code on this machine.
 */
export type StatusLineInstall = "installed" | "already installed" | "the user's own kept" | "not here";

export interface HooksReport {
  readonly "claude-code": HookRegistration;
  readonly codex: HookRegistration;
  readonly statusLine: StatusLineInstall;
}

export interface RemovalReport {
  readonly "claude-code": "removed" | "none";
  readonly codex: "removed" | "none";
  /** Whether storytree's status line was taken out: a status line of the user's own is never touched. */
  readonly statusLine: "removed" | "none";
}

/** The hook script's file name: what marks a hook entry as storytree's. */
const SCRIPT_NAME = "storytree-hook.mjs";

interface HookEntry {
  matcher?: string;
  hooks?: Record<string, unknown>[];
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

/** The harnesses' homes on this machine: CLAUDE_CONFIG_DIR or ~/.claude, and CODEX_HOME or ~/.codex. */
export function defaultHomes(env: Readonly<Record<string, string | undefined>> = process.env): Required<Homes> {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
    codex: env.CODEX_HOME || path.join(homedir(), ".codex"),
  };
}

/**
 * Register storytree's hooks for each harness whose home is here, replacing any older registration
 * of them, and install storytree's status line in Claude Code where the user has none of their own.
 */
export function registerHooks(homes: Homes, hook: HookCommand): HooksReport {
  return {
    "claude-code": register(homes.claude, "settings.json", claudeEntries(hook)),
    codex: register(homes.codex, "hooks.json", codexEntries(hook)),
    statusLine: installStatusLine(homes.claude, hook),
  };
}

/** Take storytree's hooks, and its status line, out of each harness's settings, leaving everything else as it was. */
export function removeHooks(homes: Homes, scope?: { readonly harness: "claude-code" | "codex"; readonly hook: HookCommand }): RemovalReport {
  if (scope !== undefined) return removeHarnessHooks(homes, scope.harness, scope.hook);
  const statusLine = removeStatusLine(homes.claude);
  return {
    "claude-code": remove(homes.claude, "settings.json"),
    codex: remove(homes.codex, "hooks.json"),
    statusLine,
  };
}

/**
 * Claude Code's status line: one command line, which Claude Code runs through a shell. On Windows
 * each path is in double quotes, which bash, cmd and Git Bash all read as one word.
 */
function statusLineCommand({ node, script }: HookCommand): string {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  return `${quoted(node)} ${quoted(script)} statusline`;
}

/** Install storytree's status line in Claude Code's settings, unless the user has one of their own. */
function installStatusLine(home: string | undefined, hook: HookCommand): StatusLineInstall {
  if (home === undefined || !isFolder(home)) return "not here";
  const settingsFile = path.join(home, "settings.json");
  const settings = readSettings(settingsFile);
  const wanted = { type: "command", command: statusLineCommand(hook) };
  const current = settings.statusLine;
  if (current !== undefined && !isStorytreesStatusLine(current)) return "the user's own kept";
  if (isDeepStrictEqual(current, wanted)) return "already installed";
  writeSettings(settingsFile, { ...readSettings(settingsFile), statusLine: wanted });
  return "installed";
}

function removeStatusLine(home: string | undefined): "removed" | "none" {
  if (home === undefined) return "none";
  const settingsFile = path.join(home, "settings.json");
  if (!existsSync(settingsFile)) return "none";
  const { statusLine, ...rest } = readSettings(settingsFile);
  if (statusLine === undefined || !isStorytreesStatusLine(statusLine)) return "none";
  writeSettings(settingsFile, rest);
  return "removed";
}

/** Whether a status line setting runs storytree's hook script. */
function isStorytreesStatusLine(statusLine: unknown): boolean {
  const command = typeof statusLine === "object" && statusLine !== null ? (statusLine as Record<string, unknown>).command : undefined;
  return typeof command === "string" && command.includes(SCRIPT_NAME);
}

/** Claude Code's entries: the hook script run with arguments, no shell. */
function claudeEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  const run = (background: boolean) => ({ type: "command", command: node, args: [script, "claude-code"], ...(background ? { async: true } : {}) });
  return {
    SessionStart: [{ hooks: [run(true)] }],
    PreToolUse: [
      { matcher: `${STORYTREE_TOOLS}.*`, hooks: [run(false)] },
      { matcher: "Bash|PowerShell", hooks: [run(true)] },
    ],
    PostToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent|Task", hooks: [run(true)] }],
    PostToolUseFailure: [{ matcher: "Bash|PowerShell", hooks: [run(true)] }],
    Stop: [{ hooks: [run(true)] }],
    UserPromptSubmit: [{ hooks: [run(false)] }],
    SessionEnd: [{ hooks: [run(false)] }],
  };
}

/** Codex's entries: one command line for this machine's shell. */
function codexEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  const line =
    process.platform === "win32"
      ? `& ${powerShellQuoted(node)} ${powerShellQuoted(script)} codex`
      : `${shQuoted(node)} ${shQuoted(script)} codex`;
  const run = (timeout: number, background = false) => ({ type: "command", command: background ? `${line} ${BACKGROUND}` : line, timeout });
  return {
    SessionStart: [{ hooks: [run(10)] }],
    PreToolUse: [
      { matcher: `^${STORYTREE_TOOLS}`, hooks: [run(10)] },
      { matcher: "^Bash$", hooks: [run(10, true)] },
    ],
    PostToolUse: [{ matcher: "^(apply_patch|Bash|spawn_agent)$", hooks: [run(10)] }],
    Stop: [{ hooks: [run(10, true)] }],
    UserPromptSubmit: [{ hooks: [run(10)] }],
    SessionEnd: [{ hooks: [run(3)] }],
  };
}

function register(home: string | undefined, file: string, entries: Record<string, HookEntry[]>): HookRegistration {
  if (home === undefined || !isFolder(home)) return "not here";
  const settingsFile = path.join(home, file);
  const settings = readSettings(settingsFile);
  const hooks = { ...(settings.hooks ?? {}) };
  let changed = false;
  for (const [event, wanted] of Object.entries(entries)) {
    const current = hooks[event] ?? [];
    if (isDeepStrictEqual(current.filter(isStorytrees), wanted)) continue;
    hooks[event] = [...current.filter((entry) => !isStorytrees(entry)), ...wanted];
    changed = true;
  }
  if (!changed) return "already registered";
  writeSettings(settingsFile, { ...settings, hooks });
  return "registered";
}

function remove(home: string | undefined, file: string): "removed" | "none" {
  if (home === undefined) return "none";
  const settingsFile = path.join(home, file);
  if (!existsSync(settingsFile)) return "none";
  const settings = readSettings(settingsFile);
  const hooks: Record<string, HookEntry[]> = {};
  let removed = false;
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    const kept = entries.filter((entry) => !isStorytrees(entry));
    if (kept.length !== entries.length) removed = true;
    if (kept.length > 0) hooks[event] = kept;
  }
  if (!removed) return "none";
  const { hooks: _hooks, ...rest } = settings;
  const left: Settings = Object.keys(hooks).length === 0 ? rest : { ...settings, hooks };
  // A hooks file with nothing left in it was storytree's alone: it goes with them.
  if (file === "hooks.json" && Object.keys(hooks).length === 0 && Object.keys(rest).length === 0) rmSync(settingsFile);
  else writeSettings(settingsFile, left);
  return "removed";
}

/** Whether a hook entry runs storytree's hook script. */
function isStorytrees(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((hook) =>
    [hook.command, ...(Array.isArray(hook.args) ? hook.args : [])].some((part) => typeof part === "string" && part.includes(SCRIPT_NAME)),
  );
}

function readSettings(file: string): Settings {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as Settings;
}

function writeSettings(file: string, settings: Settings): void {
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function isFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function powerShellQuoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function shQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** Remove one installation's hooks from one harness, preserving other commands in mixed groups. */
function removeHarnessHooks(homes: Homes, harness: "claude-code" | "codex", hook: HookCommand): RemovalReport {
  const report: RemovalReport = { "claude-code": "none", codex: "none", statusLine: "none" };
  const home = harness === "claude-code" ? homes.claude : homes.codex;
  if (home === undefined) return report;
  const file = path.join(home, harness === "claude-code" ? "settings.json" : "hooks.json");
  if (!existsSync(file)) return report;
  const settings = readSettings(file);
  if (settings === null || Array.isArray(settings) || typeof settings !== "object" ||
      (settings.hooks !== undefined && (settings.hooks === null || Array.isArray(settings.hooks) || typeof settings.hooks !== "object"))) throw new Error(`Repair ${file} before removing hooks.`);
  const entries = harness === "claude-code" ? claudeEntries(hook) : codexEntries(hook);
  const wanted = Object.values(entries).flatMap((groups) => groups.flatMap((group) => group.hooks ?? []));
  let removed = false;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) throw new Error(`Repair ${file} before removing hooks.`);
    hooks[event] = groups.flatMap((group) => {
      if (group === null || typeof group !== "object" || !Array.isArray(group.hooks)) throw new Error(`Repair ${file} before removing hooks.`);
      const kept = group.hooks.filter((entry) => !wanted.some((own) => entry !== null && typeof entry === "object" && entry.command === own.command && isDeepStrictEqual(entry.args, own.args)));
      if (kept.length === group.hooks.length) return [group];
      removed = true;
      return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
    });
    if (hooks[event]!.length === 0) delete hooks[event];
  }
  const statusLine = harness === "claude-code" && isDeepStrictEqual(settings.statusLine, { type: "command", command: statusLineCommand(hook) });
  if (!removed && !statusLine) return report;
  const next = { ...settings };
  if (removed) { if (Object.keys(hooks).length > 0) next.hooks = hooks; else delete next.hooks; }
  if (statusLine) delete next.statusLine;
  if (harness === "codex" && Object.keys(next).length === 0) rmSync(file);
  else writeSettings(file, next);
  return { ...report, [harness]: removed ? "removed" : "none", statusLine: statusLine ? "removed" : "none" };
}
