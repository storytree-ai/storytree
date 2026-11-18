// Capability 2 · Connect an agent
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { AFTER_TOOL, ANTIGRAVITY_HOOKS, ASK_SETUP, BACKGROUND, CLOSE_OUT_REMINDER, CODEX_DELIVERS_FROM, codexDelivers, codexToolArguments, defaultHomes, EDIT_GATE, EVENT, MOD_TOOLS, PI_EXTENSION, piExtensionScript, registeredHookScripts, scriptsIn, SHELL_GUARD, STORYTREE_TOOLS, type Homes } from "@storytree/session-management";
import { HARNESS_IDS } from "@storytree/project-and-caller/caller";

import { read, save } from "../connect/harness.js";
import { installBuilderAgents, removeBuilderAgents } from "./builder-agents.js";
import type { HookCommand } from "./built-from-main.js";
import { piExtension } from "./pi-extension.js";

export { defaultHomes, registeredHookScripts, type HookCommand, type Homes };

export type HookRegistration = "registered" | "already registered" | "would register" | "not here" | "disconnected" | "not connected";

import type { Harness } from "@storytree/project-and-caller/caller";
export type { Harness };

export type StatusLineInstall = "installed" | "already installed" | "would install" | "the user's own kept" | "not here";

export interface HooksReport {
  readonly "claude-code": HookRegistration;
  readonly codex: HookRegistration;
  readonly cursor: HookRegistration;
  readonly pi: HookRegistration;
  readonly antigravity: HookRegistration;
  readonly statusLine: StatusLineInstall;
  readonly replaced?: { readonly [harness in Harness]?: readonly string[] };
}

export interface RemovalReport {
  readonly "claude-code": "removed" | "none";
  readonly codex: "removed" | "none";
  readonly cursor: "removed" | "none";
  readonly pi: "removed" | "none";
  readonly antigravity: "removed" | "none";
  readonly statusLine: "removed" | "none";
}

const SCRIPT_NAME = "storytree-hook.mjs";

interface HookEntry {
  matcher?: string;
  hooks?: Record<string, unknown>[];
  command?: unknown;
  timeout?: number;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

export function registerHooks(homes: Homes, hook: HookCommand, disconnected: ReadonlySet<Harness> = new Set(), codexVersion?: string, look = false, unconnected: ReadonlySet<Harness> = new Set()): HooksReport {
  const home = { "claude-code": homes.claude, codex: homes.codex, cursor: homes.cursor, pi: homes.pi, antigravity: homes.antigravity } as const;
  const left = (harness: Harness): { registration: HookRegistration; replaced: string[] } | undefined =>
    disconnected.has(harness) ? { registration: "disconnected", replaced: [] }
      : unconnected.has(harness) ? { registration: isFolder(home[harness]) ? "not connected" : "not here", replaced: [] }
        : undefined;
  const claude = left("claude-code") ?? register(homes.claude, "settings.json", claudeEntries(hook), hook.script, {}, look);
  if (left("claude-code") === undefined) installBuilderAgents(homes.claude, hook, look);
  const codex = left("codex") ?? register(homes.codex, "hooks.json", codexEntries(hook, codexVersion), hook.script, {}, look);
  const cursor = left("cursor") ?? register(homes.cursor, "hooks.json", cursorEntries(hook), hook.script, { version: 1 }, look);
  const pi = left("pi") ?? registerPi(homes.pi, hook, look);
  const antigravity = left("antigravity") ?? registerAntigravity(homes.antigravity, hook, look);
  const replaced = { ...(claude.replaced.length > 0 ? { "claude-code": claude.replaced } : {}), ...(codex.replaced.length > 0 ? { codex: codex.replaced } : {}), ...(cursor.replaced.length > 0 ? { cursor: cursor.replaced } : {}), ...(pi.replaced.length > 0 ? { pi: pi.replaced } : {}), ...(antigravity.replaced.length > 0 ? { antigravity: antigravity.replaced } : {}) };
  return {
    "claude-code": claude.registration,
    codex: codex.registration,
    cursor: cursor.registration,
    pi: pi.registration,
    antigravity: antigravity.registration,
    statusLine: left("claude-code") === undefined ? installStatusLine(homes.claude, hook, look) : "not here",
    ...(Object.keys(replaced).length > 0 ? { replaced } : {}),
  };
}

export function connectedHarnesses(homes: Homes): Set<Harness> {
  const carries = (harness: Harness): boolean => {
    try {
      if (harness === "pi") return homes.pi !== undefined && existsSync(path.join(homes.pi, PI_EXTENSION)) && piExtensionScript(readFileSync(path.join(homes.pi, PI_EXTENSION), "utf8")) !== undefined;
      if (harness === "antigravity") return homes.antigravity !== undefined && scriptsIn(stringsIn(readSettings(path.join(homes.antigravity, ANTIGRAVITY_HOOKS))[ANTIGRAVITY_NAME])).length > 0;
      const file = harness === "claude-code" ? homes.claude && path.join(homes.claude, "settings.json") : harness === "codex" ? homes.codex && path.join(homes.codex, "hooks.json") : homes.cursor && path.join(homes.cursor, "hooks.json");
      return file !== undefined && Object.values(readSettings(file).hooks ?? {}).some((entries) => Array.isArray(entries) && entries.some(isStorytrees));
    } catch {
      return false;
    }
  };
  return new Set(HARNESS_IDS.filter(carries));
}

const DISCONNECTED_FILE = "disconnected-harnesses.json";

export function disconnectedHarnesses(storytreeHome: string): Set<Harness> {
  try {
    const named: unknown = JSON.parse(readFileSync(path.join(storytreeHome, DISCONNECTED_FILE), "utf8"));
    return new Set((Array.isArray(named) ? named : []).filter((harness): harness is Harness => HARNESS_IDS.includes(harness)));
  } catch {
    return new Set();
  }
}

export function markDisconnected(storytreeHome: string, harness: Harness, disconnected: boolean): void {
  const named = disconnectedHarnesses(storytreeHome);
  if (named.has(harness) === disconnected) return;
  if (disconnected) named.add(harness);
  else named.delete(harness);
  const file = path.join(storytreeHome, DISCONNECTED_FILE);
  if (named.size === 0) rmSync(file, { force: true });
  else {
    mkdirSync(storytreeHome, { recursive: true });
    writeFileSync(file, `${JSON.stringify([...named])}\n`);
  }
}

export function removeHooks(homes: Homes, scope?: { readonly harness: Harness; readonly hook: HookCommand }): RemovalReport {
  if (scope !== undefined) return removeHarnessHooks(homes, scope.harness, scope.hook);
  const statusLine = removeStatusLine(homes.claude);
  removeBuilderAgents(homes.claude);
  return {
    "claude-code": remove(homes.claude, "settings.json"),
    codex: remove(homes.codex, "hooks.json"),
    cursor: remove(homes.cursor, "hooks.json", true),
    pi: removePi(homes.pi),
    antigravity: removeAntigravity(homes.antigravity),
    statusLine,
  };
}

function statusLineCommand({ node, script }: HookCommand): string {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  return `${quoted(node)} ${quoted(script)} statusline`;
}

function installStatusLine(home: string | undefined, hook: HookCommand, look: boolean): StatusLineInstall {
  if (home === undefined || !isFolder(home)) return "not here";
  const settingsFile = path.join(home, "settings.json");
  const settings = readSettings(settingsFile);
  const wanted = { type: "command", command: statusLineCommand(hook) };
  const current = settings.statusLine;
  if (current !== undefined && !isStorytreesStatusLine(current)) return "the user's own kept";
  if (isDeepStrictEqual(current, wanted)) return "already installed";
  if (look) return "would install";
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

function isStorytreesStatusLine(statusLine: unknown): boolean {
  const command = typeof statusLine === "object" && statusLine !== null ? (statusLine as Record<string, unknown>).command : undefined;
  return typeof command === "string" && command.includes(SCRIPT_NAME);
}

function claudeEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  const run = (background: boolean) => ({ type: "command", command: node, args: [script, "claude-code", ...(background ? [AFTER_TOOL] : [])], ...(background ? { async: true } : {}) });
  const guard = { type: "command", command: node, args: [script, "claude-code", SHELL_GUARD] };
  return {
    SessionStart: [{ hooks: [run(true)] }],
    PreToolUse: [
      { matcher: `${STORYTREE_TOOLS}(?!(?:${MOD_TOOLS.map((tool) => tool.slice(STORYTREE_TOOLS.length)).join("|")})$).*`, hooks: [run(false)] },
      { matcher: "Bash|PowerShell", hooks: [run(true)] },
      { matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: node, args: [script, "claude-code", EDIT_GATE] }] },
      { matcher: "Bash|PowerShell", hooks: [guard] },
    ],
    PostToolUse: [
      { matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent|Task|WebFetch|WebSearch|mcp__.*([Gg]it[Hh]ub|[Gg]mail).*", hooks: [run(true)] },
      { matcher: "Bash|PowerShell", hooks: [guard] },
    ],
    PostToolUseFailure: [{ matcher: "Bash|PowerShell", hooks: [run(true)] }, { matcher: "Bash|PowerShell", hooks: [guard] }],
    Stop: [{ hooks: [run(true)] }, { hooks: [{ type: "command", command: node, args: [script, "claude-code", CLOSE_OUT_REMINDER] }] }],
    SubagentStop: [{ hooks: [run(true)] }],
    UserPromptSubmit: [{ hooks: [run(false)] }],
    SessionEnd: [{ hooks: [{ type: "command", command: node, args: [script, "claude-code", BACKGROUND] }] }],
  };
}

function codexEntries({ node, script }: HookCommand, codexVersion?: string): Record<string, HookEntry[]> {
  const line =
    process.platform === "win32"
      ? `& ${powerShellQuoted(node)} ${powerShellQuoted(script)} codex`
      : `${shQuoted(node)} ${shQuoted(script)} codex`;
  const run = (timeout: number, background = false) => ({ type: "command", command: background ? `${line} ${BACKGROUND}` : line, timeout });
  if (codexDelivers(codexVersion)) {
    const delivered = (event: string) => [
      { type: "mcp_tool", server: "storytree", tool: "hook_event", input: codexToolArguments(event), timeout: 5 },
      { type: "command", command: `${line} ${AFTER_TOOL}`, timeout: 10, async: true },
    ];
    return {
      SessionStart: [{ hooks: delivered("SessionStart") }],
      PreToolUse: [
        { matcher: `^${STORYTREE_TOOLS}`, hooks: [run(10)] },
        { matcher: "^Bash$", hooks: delivered("PreToolUse") },
        { matcher: "^apply_patch$", hooks: [{ type: "command", command: `${line} ${EDIT_GATE}`, timeout: 10 }] },
        { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] },
      ],
      PostToolUse: [{ matcher: "^(apply_patch|Bash|spawn_agent)$", hooks: delivered("PostToolUse") }, { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] }],
      Stop: [{ hooks: delivered("Stop") }, { hooks: [{ type: "command", command: `${line} ${CLOSE_OUT_REMINDER}`, timeout: 10 }] }],
      UserPromptSubmit: [{ hooks: [run(10)] }],
      SessionEnd: [{ hooks: [run(3)] }],
    };
  }
  return {
    SessionStart: [{ hooks: [run(10)] }],
    PreToolUse: [
      { matcher: `^${STORYTREE_TOOLS}`, hooks: [run(10)] },
      { matcher: "^Bash$", hooks: [run(10, true)] },
      { matcher: "^apply_patch$", hooks: [{ type: "command", command: `${line} ${EDIT_GATE}`, timeout: 10 }] },
      { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] },
    ],
    PostToolUse: [{ matcher: "^(apply_patch|Bash|spawn_agent)$", hooks: [run(10)] }, { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] }],
    Stop: [{ hooks: [run(10, true)] }, { hooks: [{ type: "command", command: `${line} ${CLOSE_OUT_REMINDER}`, timeout: 10 }] }],
    UserPromptSubmit: [{ hooks: [run(10)] }],
    SessionEnd: [{ hooks: [run(3)] }],
  };
}

function cursorEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  const line = `${quoted(node)} ${quoted(script)} cursor`;
  const run = (timeout: number, flag?: string, matcher?: string) => ({ command: flag === undefined ? line : `${line} ${flag}`, ...(matcher === undefined ? {} : { matcher }), timeout });
  return {
    sessionStart: [run(10)],
    sessionEnd: [run(3)],
    beforeSubmitPrompt: [run(10)],
    beforeMCPExecution: [run(10)],
    preToolUse: [run(10, BACKGROUND, "^Shell$"), run(10, EDIT_GATE, "^(Write|StrReplace|ApplyPatch|Delete|MultiEdit|Edit)$")],
    postToolUse: [run(10, undefined, "^Shell$")],
    postToolUseFailure: [run(10, undefined, "^Shell$")],
    afterFileEdit: [run(10)],
    subagentStart: [run(10)],
    stop: [run(10, BACKGROUND)],
  };
}

function registerPi(home: string | undefined, hook: HookCommand, look: boolean): { registration: HookRegistration; replaced: string[] } {
  if (home === undefined || !isFolder(home)) return { registration: "not here", replaced: [] };
  const file = path.join(home, PI_EXTENSION);
  const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const wanted = piExtension(hook);
  if (current === wanted) return { registration: "already registered", replaced: [] };
  const before = current === undefined ? undefined : piExtensionScript(current);
  if (!look) save(file, current, wanted);
  return { registration: look ? "would register" : "registered", replaced: before === undefined || before === hook.script ? [] : [before] };
}

function removePi(home: string | undefined, script?: string): "removed" | "none" {
  if (home === undefined) return "none";
  const file = path.join(home, PI_EXTENSION);
  if (!existsSync(file)) return "none";
  const runs = piExtensionScript(readFileSync(file, "utf8"));
  if (runs === undefined || (script !== undefined && runs !== script)) return "none";
  rmSync(file);
  return "removed";
}

const ANTIGRAVITY_NAME = "storytree";
const ANTIGRAVITY_EDITS = "write_to_file|replace_file_content|multi_replace_file_content";

function antigravityEntries({ node, script }: HookCommand): Record<string, unknown> {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  const run = (event: string, flag?: string) => ({ type: "command", command: `${quoted(node)} ${quoted(script)} antigravity ${EVENT}${event}${flag === undefined ? "" : ` ${flag}`}`, timeout: 10 });
  return {
    PreToolUse: [
      { matcher: "mcp_.*", hooks: [run("PreToolUse")] },
      { matcher: "run_command", hooks: [run("PreToolUse", BACKGROUND)] },
      { matcher: ANTIGRAVITY_EDITS, hooks: [run("PreToolUse", EDIT_GATE)] },
    ],
    PostToolUse: [{ matcher: `run_command|${ANTIGRAVITY_EDITS}`, hooks: [run("PostToolUse")] }],
    Stop: [run("Stop", BACKGROUND)],
  };
}

function registerAntigravity(home: string | undefined, hook: HookCommand, look: boolean): { registration: HookRegistration; replaced: string[] } {
  if (home === undefined || !isFolder(home)) return { registration: "not here", replaced: [] };
  const file = path.join(home, ANTIGRAVITY_HOOKS);
  const named = readSettings(file);
  const wanted = antigravityEntries(hook);
  if (isDeepStrictEqual(named[ANTIGRAVITY_NAME], wanted)) return { registration: "already registered", replaced: [] };
  const before = scriptsIn(stringsIn(named[ANTIGRAVITY_NAME])).filter((found) => found !== hook.script);
  if (!look) writeSettings(file, { ...named, [ANTIGRAVITY_NAME]: wanted });
  return { registration: look ? "would register" : "registered", replaced: [...new Set(before)] };
}

function removeAntigravity(home: string | undefined, script?: string): "removed" | "none" {
  if (home === undefined) return "none";
  const file = path.join(home, ANTIGRAVITY_HOOKS);
  if (!existsSync(file)) return "none";
  const { [ANTIGRAVITY_NAME]: ours, ...rest } = readSettings(file);
  const runs = scriptsIn(stringsIn(ours));
  if (runs.length === 0 || (script !== undefined && !runs.includes(script))) return "none";
  if (Object.keys(rest).length === 0) rmSync(file);
  else writeSettings(file, rest);
  return "removed";
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];
}

function register(home: string | undefined, file: string, entries: Record<string, HookEntry[]>, script: string, born: Settings = {}, look = false): { registration: HookRegistration; replaced: string[] } {
  if (home === undefined || !isFolder(home)) return { registration: "not here", replaced: [] };
  const settingsFile = path.join(home, file);
  const settings = readSettings(settingsFile);
  const hooks = { ...(settings.hooks ?? {}) };
  const replaced = new Set<string>();
  let changed = false;
  for (const [event, wanted] of Object.entries(entries)) {
    const current = hooks[event] ?? [];
    if (isDeepStrictEqual(current.filter(isStorytrees), wanted)) continue;
    for (const entry of current.filter(isStorytrees)) for (const found of scriptsIn(commandWords(entry))) if (found !== script) replaced.add(found);
    hooks[event] = [...current.filter((entry) => !isStorytrees(entry)), ...wanted];
    changed = true;
  }
  if (!changed) return { registration: "already registered", replaced: [] };
  if (look) return { registration: "would register", replaced: [...replaced] };
  writeSettings(settingsFile, { ...born, ...settings, hooks });
  return { registration: "registered", replaced: [...replaced] };
}

function remove(home: string | undefined, file: string, cursor = false): "removed" | "none" {
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
  const left: Settings = Object.keys(hooks).length === 0 && !cursor ? rest : { ...settings, hooks };
  if (file === "hooks.json" && Object.keys(hooks).length === 0 && (cursor ? isDeepStrictEqual(rest, { version: 1 }) : Object.keys(rest).length === 0)) rmSync(settingsFile);
  else writeSettings(settingsFile, left);
  return "removed";
}

function isStorytrees(entry: HookEntry): boolean {
  return commandWords(entry).some((part) => typeof part === "string" && part.includes(SCRIPT_NAME));
}

function commandWords(entry: HookEntry): unknown[] {
  return [entry.command, ...(entry.hooks ?? []).flatMap((hook) => [hook.command, ...(Array.isArray(hook.args) ? hook.args : [])])];
}

function readSettings(file: string): Settings {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as Settings;
}

function writeSettings(file: string, settings: Settings): void {
  save(file, read(file), `${JSON.stringify(settings, null, 2)}\n`);
}

function isFolder(folder: string | undefined): boolean {
  if (folder === undefined) return false;
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

function mergedEntries(one: Record<string, HookEntry[]>, other: Record<string, HookEntry[]>): Record<string, HookEntry[]> {
  const merged: Record<string, HookEntry[]> = { ...one };
  for (const [event, entries] of Object.entries(other)) merged[event] = [...(merged[event] ?? []), ...entries];
  return merged;
}

function removeHarnessHooks(homes: Homes, harness: Harness, hook: HookCommand): RemovalReport {
  const report: RemovalReport = { "claude-code": "none", codex: "none", cursor: "none", pi: "none", antigravity: "none", statusLine: "none" };
  if (harness === "pi") return { ...report, pi: removePi(homes.pi, hook.script) };
  if (harness === "antigravity") return { ...report, antigravity: removeAntigravity(homes.antigravity, hook.script) };
  if (harness === "claude-code") removeBuilderAgents(homes.claude, hook.script);
  const home = harness === "claude-code" ? homes.claude : homes[harness];
  if (home === undefined) return report;
  const file = path.join(home, harness === "claude-code" ? "settings.json" : "hooks.json");
  if (!existsSync(file)) return report;
  const settings = readSettings(file);
  if (settings === null || Array.isArray(settings) || typeof settings !== "object" ||
      (settings.hooks !== undefined && (settings.hooks === null || Array.isArray(settings.hooks) || typeof settings.hooks !== "object"))) throw new Error(`Repair ${file} before removing hooks.`);
  const entries = harness === "claude-code" ? claudeEntries(hook) : harness === "codex" ? mergedEntries(codexEntries(hook), codexEntries(hook, CODEX_DELIVERS_FROM)) : cursorEntries(hook);
  const wanted: Record<string, unknown>[] = Object.values(entries).flatMap((groups) => groups.flatMap((group) => harness === "cursor" ? [{ command: group.command }] : group.hooks ?? []));
  if (harness === "claude-code") wanted.push({ type: "command", command: hook.node, args: [hook.script, "claude-code", ASK_SETUP] });
  let removed = false;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) throw new Error(`Repair ${file} before removing hooks.`);
    hooks[event] = groups.flatMap((group) => {
      if (harness === "cursor" && group !== null && typeof group === "object") {
        if (!wanted.some((own) => group.command === own.command)) return [group];
        removed = true;
        return [];
      }
      if (group === null || typeof group !== "object" || !Array.isArray(group.hooks)) throw new Error(`Repair ${file} before removing hooks.`);
      const ours = (entry: unknown, own: Record<string, unknown>) => entry !== null && typeof entry === "object" &&
        (own.command === undefined ? isDeepStrictEqual(entry, own) : (entry as Record<string, unknown>).command === own.command && isDeepStrictEqual((entry as Record<string, unknown>).args, own.args));
      const kept = group.hooks.filter((entry) => !wanted.some((own) => ours(entry, own)));
      if (kept.length === group.hooks.length) return [group];
      removed = true;
      return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
    });
    if (hooks[event]!.length === 0) delete hooks[event];
  }
  const statusLine = harness === "claude-code" && isDeepStrictEqual(settings.statusLine, { type: "command", command: statusLineCommand(hook) });
  if (!removed && !statusLine) return report;
  const next = { ...settings };
  if (removed) { if (Object.keys(hooks).length > 0 || harness === "cursor") next.hooks = hooks; else delete next.hooks; }
  if (statusLine) delete next.statusLine;
  if (harness === "codex" ? Object.keys(next).length === 0 : harness === "cursor" && isDeepStrictEqual(next, { version: 1, hooks: {} })) rmSync(file);
  else writeSettings(file, next);
  return { ...report, [harness]: removed ? "removed" : "none", statusLine: statusLine ? "removed" : "none" };
}
