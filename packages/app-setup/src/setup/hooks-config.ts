/**
 * Capability 8 · Setup check. Registering storytree's hooks in each harness's own user-level settings, and taking them out
 * again: only ever storytree's entries, recognised by the hook script they run
 * (`storytree-hook.mjs`), so every other setting is left exactly as it was.
 *
 * - Claude Code: `<config folder>/settings.json` (CLAUDE_CONFIG_DIR, else ~/.claude). Each hook is a
 *   program with arguments, run with no shell in between, so it works on Windows without a Unix
 *   shell. The start, edit and end-of-turn hooks, and the one before each shell command, run in the
 *   background (`async`); the end hook runs before Claude Code exits, which stops it after 1.5 s, so
 *   it passes `--background` and hands its line to a copy of itself that outlives it; the hook before storytree's
 *   own tools before the call is made, so its line is there when the call reaches the tool server
 *   (ADR-0629 D2), and the prompt hook before the prompt reaches the agent, since what it prints is
 *   added for the agent (ADR-0636 D1). Without Git for Windows, Claude Code has no Bash tool and
 *   runs commands with its PowerShell tool, so each hook that listens for Bash listens for it too.
 * - Codex: `<CODEX_HOME>/hooks.json` (else ~/.codex). Codex runs a hook as one command line through
 *   its shell (PowerShell on Windows, sh elsewhere), so the line is written for the shell of this
 *   machine. Codex has no background hooks, so the ones before each shell command and at the end of
 *   each turn pass `--background`: the hook hands its writing to a copy of itself and exits (hooks.ts).
 *   A second end-of-turn hook runs in the foreground, since Codex reads a Stop hook's block as
 *   Claude Code does: it may ask the agent to close out (ADR-0758 D4).
 *   Codex runs a newly added hook only after the user approves it once (ADR-0626 D4).
 *   From Codex 0.148 (`codexVersion`, as `codex --version` says it), each event the tool server takes
 *   (Session management's codex-delivery.ts) is handed to it by an `mcp_tool` handler, with no process
 *   started (ADR-1056 D2), and the command hook beside it stays as the fallback, `async` and standing
 *   down when the tool recorded the event; the hooks that passed `--background` are `async` instead.
 *   A Codex older than that, or one whose version cannot be read, keeps the shape above.
 * - Cursor: `~/.cursor/hooks.json`, which no variable moves. From Cursor's documentation and installed code,
 *   not a live session (hooks/cursor.ts in Session management says which). Its file names a `version`, and
 *   lists each event's hooks flat: an entry is itself one command line, which Cursor runs through a shell
 *   from ~/.cursor (on Windows after PowerShell's `&`), so each path is absolute and quoted. Cursor waits
 *   for every hook, so the ones before each shell command and at the end of each turn pass `--background`.
 *   Anything a hook before a tool prints that is not JSON blocks the tool: the hook script prints JSON or nothing.
 * - Pi: no hook command at all, only extensions. Storytree's registration is one generated extension,
 *   `<PI_CODING_AGENT_DIR or ~/.pi/agent>/extensions/storytree.ts` (pi-extension.ts), written whole and
 *   deleted whole: a file of storytree's alone, so no other setting of Pi's is ever touched.
 * - Antigravity CLI: `~/.gemini/config/hooks.json`, whose top-level keys each name a hook (its own
 *   documentation, shipped inside agy 1.3.3; not a live session, since agy runs no prompt without a sign-in).
 *   Storytree's registration is the one named `storytree`, written whole and taken out whole, so every other
 *   named hook is left as it was. Antigravity runs each command line through `sh -c` (cmd /c on Windows) and
 *   waits for it; its input names no event, so each command names its own (`--event=`), and the hooks before
 *   a command and at the end of a run pass `--background`.
 * - In all five, the hook before each file-edit tool runs in the foreground, since its answer may refuse
 *   the edit (ADR-0949 D3). In Claude Code and Codex, a guard after each shell command runs in the foreground
 *   too, since what it prints tells the agent of the command's changes to imported code (ADR-1015).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { AFTER_TOOL, ANTIGRAVITY_HOOKS, ASK_SETUP, BACKGROUND, CLOSE_OUT_REMINDER, CODEX_DELIVERS_FROM, codexDelivers, codexToolArguments, defaultHomes, EDIT_GATE, EVENT, MOD_TOOLS, PI_EXTENSION, piExtensionScript, registeredHookScripts, scriptsIn, SHELL_GUARD, STORYTREE_TOOLS, type Homes } from "@storytree/session-management";
import { HARNESS_IDS } from "@storytree/project-and-caller/caller";

import { read, save } from "../connect/harness.js";
import { piExtension } from "./pi-extension.js";

export { defaultHomes, registeredHookScripts, type Homes };

/** The command a harness runs as storytree's hook: a Node and the built hook script. */
export interface HookCommand {
  readonly node: string;
  readonly script: string;
}

/**
 * What registering found: storytree's hooks added now, already there, no such harness on this
 * machine, or a harness the user disconnected from storytree, whose hooks stay out. A look that
 * writes nothing says "would register" where registering would have changed the harness's file.
 */
export type HookRegistration = "registered" | "already registered" | "would register" | "not here" | "disconnected";

/** A harness storytree connects to: one Session management describes (decision_057bc7ad0a8c D1). */
import type { Harness } from "@storytree/project-and-caller/caller";
export type { Harness };

/**
 * What installing Claude Code's status line found (ADR-0636 D1, b3): storytree's installed now or
 * already there, a status line of the user's own left as it is, or no Claude Code on this machine.
 */
export type StatusLineInstall = "installed" | "already installed" | "would install" | "the user's own kept" | "not here";

export interface HooksReport {
  readonly "claude-code": HookRegistration;
  readonly codex: HookRegistration;
  readonly cursor: HookRegistration;
  readonly pi: HookRegistration;
  readonly antigravity: HookRegistration;
  readonly statusLine: StatusLineInstall;
  /** The hook scripts of another build that registering replaced, by harness: present only when it replaced one. */
  readonly replaced?: { readonly [harness in Harness]?: readonly string[] };
}

export interface RemovalReport {
  readonly "claude-code": "removed" | "none";
  readonly codex: "removed" | "none";
  readonly cursor: "removed" | "none";
  readonly pi: "removed" | "none";
  readonly antigravity: "removed" | "none";
  /** Whether storytree's status line was taken out: a status line of the user's own is never touched. */
  readonly statusLine: "removed" | "none";
}

/** The hook script's file name: what marks a hook entry as storytree's. */
const SCRIPT_NAME = "storytree-hook.mjs";

/** One entry under an event: Claude Code's and Codex's hold their hooks in `hooks`; Cursor's is itself the hook, with its `command`. */
interface HookEntry {
  matcher?: string;
  hooks?: Record<string, unknown>[];
  command?: unknown;
  timeout?: number;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

/**
 * Register storytree's hooks for each harness whose home is here, replacing any older registration
 * of them, and install storytree's status line in Claude Code where the user has none of their own.
 */
/**
 * Register storytree's hooks in each harness's settings; with `look`, write nothing and say what registering would
 * change ("would register", with the other build's hook scripts it would replace).
 */
export function registerHooks(homes: Homes, hook: HookCommand, disconnected: ReadonlySet<Harness> = new Set(), codexVersion?: string, look = false): HooksReport {
  const claude = disconnected.has("claude-code") ? { registration: "disconnected" as const, replaced: [] } : register(homes.claude, "settings.json", claudeEntries(hook), hook.script, {}, look);
  const codex = disconnected.has("codex") ? { registration: "disconnected" as const, replaced: [] } : register(homes.codex, "hooks.json", codexEntries(hook, codexVersion), hook.script, {}, look);
  // Cursor's hooks file must name its version: a new file gets 1, and one the user wrote keeps its own.
  const cursor = disconnected.has("cursor") ? { registration: "disconnected" as const, replaced: [] } : register(homes.cursor, "hooks.json", cursorEntries(hook), hook.script, { version: 1 }, look);
  const pi = disconnected.has("pi") ? { registration: "disconnected" as const, replaced: [] } : registerPi(homes.pi, hook, look);
  const antigravity = disconnected.has("antigravity") ? { registration: "disconnected" as const, replaced: [] } : registerAntigravity(homes.antigravity, hook, look);
  const replaced = { ...(claude.replaced.length > 0 ? { "claude-code": claude.replaced } : {}), ...(codex.replaced.length > 0 ? { codex: codex.replaced } : {}), ...(cursor.replaced.length > 0 ? { cursor: cursor.replaced } : {}), ...(pi.replaced.length > 0 ? { pi: pi.replaced } : {}), ...(antigravity.replaced.length > 0 ? { antigravity: antigravity.replaced } : {}) };
  return {
    "claude-code": claude.registration,
    codex: codex.registration,
    cursor: cursor.registration,
    pi: pi.registration,
    antigravity: antigravity.registration,
    statusLine: disconnected.has("claude-code") ? "not here" : installStatusLine(homes.claude, hook, look),
    ...(Object.keys(replaced).length > 0 ? { replaced } : {}),
  };
}

/**
 * The file in the storytree home naming the harnesses the user disconnected: the setup check, run
 * from another harness's session, registers no hooks for them until they are connected again.
 */
const DISCONNECTED_FILE = "disconnected-harnesses.json";

/** The harnesses the user disconnected from storytree, as the storytree home at `storytreeHome` records them. */
export function disconnectedHarnesses(storytreeHome: string): Set<Harness> {
  try {
    const named: unknown = JSON.parse(readFileSync(path.join(storytreeHome, DISCONNECTED_FILE), "utf8"));
    return new Set((Array.isArray(named) ? named : []).filter((harness): harness is Harness => HARNESS_IDS.includes(harness)));
  } catch {
    return new Set();
  }
}

/** Record in the storytree home that `harness` is disconnected from storytree, or connected again. */
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

/** Take storytree's hooks, and its status line, out of each harness's settings, leaving everything else as it was. */
export function removeHooks(homes: Homes, scope?: { readonly harness: Harness; readonly hook: HookCommand }): RemovalReport {
  if (scope !== undefined) return removeHarnessHooks(homes, scope.harness, scope.hook);
  const statusLine = removeStatusLine(homes.claude);
  return {
    "claude-code": remove(homes.claude, "settings.json"),
    codex: remove(homes.codex, "hooks.json"),
    cursor: remove(homes.cursor, "hooks.json", true),
    pi: removePi(homes.pi),
    antigravity: removeAntigravity(homes.antigravity),
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

/** Whether a status line setting runs storytree's hook script. */
function isStorytreesStatusLine(statusLine: unknown): boolean {
  const command = typeof statusLine === "object" && statusLine !== null ? (statusLine as Record<string, unknown>).command : undefined;
  return typeof command === "string" && command.includes(SCRIPT_NAME);
}

/** Claude Code's entries: the hook script run with arguments, no shell. */
function claudeEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  // A background hook waits a moment for the tool server's note that Claude Code's mod delivered its event, and finding it stands down (ADR-1056 D3).
  const run = (background: boolean) => ({ type: "command", command: node, args: [script, "claude-code", ...(background ? [AFTER_TOOL] : [])], ...(background ? { async: true } : {}) });
  const guard = { type: "command", command: node, args: [script, "claude-code", SHELL_GUARD] };
  return {
    SessionStart: [{ hooks: [run(true)] }],
    PreToolUse: [
      // Every storytree tool but those Claude Code's mod calls itself (hook_event, heartbeat): no agent asks for them.
      { matcher: `${STORYTREE_TOOLS}(?!(?:${MOD_TOOLS.map((tool) => tool.slice(STORYTREE_TOOLS.length)).join("|")})$).*`, hooks: [run(false)] },
      { matcher: "Bash|PowerShell", hooks: [run(true)] },
      // Before each file edit, in the foreground: an edit to a capability the session may not write is refused (ADR-0949 D3).
      { matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: node, args: [script, "claude-code", EDIT_GATE] }] },
    ],
    // After each shell command, finished or failed, also in the foreground: its changes to imported code are told to the agent (ADR-1015).
    PostToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent|Task", hooks: [run(true)] }, { matcher: "Bash|PowerShell", hooks: [guard] }],
    PostToolUseFailure: [{ matcher: "Bash|PowerShell", hooks: [run(true)] }, { matcher: "Bash|PowerShell", hooks: [guard] }],
    // The turn's line in the background; then, in the foreground, a check that may ask the agent to close out (ADR-0758 D4).
    Stop: [{ hooks: [run(true)] }, { hooks: [{ type: "command", command: node, args: [script, "claude-code", CLOSE_OUT_REMINDER] }] }],
    UserPromptSubmit: [{ hooks: [run(false)] }],
    // Claude Code stops its end hooks after 1.5 s, sooner than a distant store answers: the hook hands its line to a copy of itself that outlives it.
    SessionEnd: [{ hooks: [{ type: "command", command: node, args: [script, "claude-code", BACKGROUND] }] }],
  };
}

/** Codex's entries: one command line for this machine's shell, and from Codex 0.148 the tool server's handler beside it. */
function codexEntries({ node, script }: HookCommand, codexVersion?: string): Record<string, HookEntry[]> {
  const line =
    process.platform === "win32"
      ? `& ${powerShellQuoted(node)} ${powerShellQuoted(script)} codex`
      : `${shQuoted(node)} ${shQuoted(script)} codex`;
  const run = (timeout: number, background = false) => ({ type: "command", command: background ? `${line} ${BACKGROUND}` : line, timeout });
  if (codexDelivers(codexVersion)) {
    // The tool server takes the event; the command hook, which the agent never waits for, records it only if the tool did not (ADR-1056 D2).
    const delivered = (event: string) => [
      { type: "mcp_tool", server: "storytree", tool: "hook_event", input: codexToolArguments(event), timeout: 5 },
      { type: "command", command: `${line} ${AFTER_TOOL}`, timeout: 10, async: true },
    ];
    return {
      SessionStart: [{ hooks: delivered("SessionStart") }],
      PreToolUse: [
        // Before a storytree tool, as before: only a subagent's input names its agent, so no template can carry every one.
        { matcher: `^${STORYTREE_TOOLS}`, hooks: [run(10)] },
        { matcher: "^Bash$", hooks: delivered("PreToolUse") },
        { matcher: "^apply_patch$", hooks: [{ type: "command", command: `${line} ${EDIT_GATE}`, timeout: 10 }] },
      ],
      PostToolUse: [{ matcher: "^(apply_patch|Bash|spawn_agent)$", hooks: delivered("PostToolUse") }, { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] }],
      Stop: [{ hooks: delivered("Stop") }, { hooks: [{ type: "command", command: `${line} ${CLOSE_OUT_REMINDER}`, timeout: 10 }] }],
      // The prompt hook reaches the library anyway, for the definitions it adds; Codex runs no tool handler at a session's end.
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
    ],
    PostToolUse: [{ matcher: "^(apply_patch|Bash|spawn_agent)$", hooks: [run(10)] }, { matcher: "^Bash$", hooks: [{ type: "command", command: `${line} ${SHELL_GUARD}`, timeout: 10 }] }],
    // As in Claude Code: the turn's line in the background, then a foreground check whose block Codex reads (ADR-0758 D4).
    Stop: [{ hooks: [run(10, true)] }, { hooks: [{ type: "command", command: `${line} ${CLOSE_OUT_REMINDER}`, timeout: 10 }] }],
    UserPromptSubmit: [{ hooks: [run(10)] }],
    SessionEnd: [{ hooks: [run(3)] }],
  };
}

/**
 * Cursor's entries: one command line for the shell Cursor runs it through. On Windows each path is in
 * double quotes, which read as one word after the `&` Cursor's PowerShell puts before it, and in cmd.
 */
function cursorEntries({ node, script }: HookCommand): Record<string, HookEntry[]> {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  const line = `${quoted(node)} ${quoted(script)} cursor`;
  const run = (timeout: number, flag?: string, matcher?: string) => ({ command: flag === undefined ? line : `${line} ${flag}`, ...(matcher === undefined ? {} : { matcher }), timeout });
  return {
    sessionStart: [run(10)],
    sessionEnd: [run(3)],
    beforeSubmitPrompt: [run(10)],
    // Every tool server's calls: the hook script keeps only those to storytree's own.
    beforeMCPExecution: [run(10)],
    // Before each file edit, in the foreground: an edit to a capability the session may not write is refused (ADR-0949 D3).
    preToolUse: [run(10, BACKGROUND, "^Shell$"), run(10, EDIT_GATE, "^(Write|StrReplace|ApplyPatch|Delete|MultiEdit|Edit)$")],
    postToolUse: [run(10, undefined, "^Shell$")],
    postToolUseFailure: [run(10, undefined, "^Shell$")],
    afterFileEdit: [run(10)],
    subagentStart: [run(10)],
    stop: [run(10, BACKGROUND)],
  };
}

/** Write storytree's Pi extension in Pi's agent folder `home`, saying which other build's hook script the one there ran. */
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

/** Delete storytree's Pi extension from `home`; with `script`, only one that runs that hook script. A file there that is not storytree's stays. */
function removePi(home: string | undefined, script?: string): "removed" | "none" {
  if (home === undefined) return "none";
  const file = path.join(home, PI_EXTENSION);
  if (!existsSync(file)) return "none";
  const runs = piExtensionScript(readFileSync(file, "utf8"));
  if (runs === undefined || (script !== undefined && runs !== script)) return "none";
  rmSync(file);
  return "removed";
}

/** The name storytree's hooks go under in Antigravity's hooks.json, whose top-level keys each name a hook. */
const ANTIGRAVITY_NAME = "storytree";
/** Antigravity's tools that write a file, by the names its binary (1.3.3) gives them; the matcher is a regular expression. */
const ANTIGRAVITY_EDITS = "write_to_file|replace_file_content|multi_replace_file_content";

/** Antigravity's named hook: one command line per event for the shell it runs it through, naming that event. */
function antigravityEntries({ node, script }: HookCommand): Record<string, unknown> {
  const quoted = process.platform === "win32" ? (text: string) => `"${text}"` : shQuoted;
  const run = (event: string, flag?: string) => ({ type: "command", command: `${quoted(node)} ${quoted(script)} antigravity ${EVENT}${event}${flag === undefined ? "" : ` ${flag}`}`, timeout: 10 });
  return {
    PreToolUse: [
      // Every tool server's calls: the hook script keeps only those to storytree's own.
      { matcher: "mcp_.*", hooks: [run("PreToolUse")] },
      { matcher: "run_command", hooks: [run("PreToolUse", BACKGROUND)] },
      // Before each file edit, in the foreground: an edit to a capability the session may not write is refused (ADR-0949 D3).
      { matcher: ANTIGRAVITY_EDITS, hooks: [run("PreToolUse", EDIT_GATE)] },
    ],
    PostToolUse: [{ matcher: `run_command|${ANTIGRAVITY_EDITS}`, hooks: [run("PostToolUse")] }],
    // Its end-of-run hooks are a flat list of handlers.
    Stop: [run("Stop", BACKGROUND)],
  };
}

/** Write storytree's named hook into Antigravity's hooks.json in its home `home`, saying which other build's hook script the one there ran. */
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

/** Take storytree's named hook out of Antigravity's hooks.json; with `script`, only one that runs that hook script. A file left with no hook goes. */
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

/** Every string in a JSON value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];
}

/**
 * Register `entries` in `home`'s `file`, saying which other builds' hook scripts it replaced there; `born` is what a new file
 * holds besides its hooks. With `look`, nothing is written.
 */
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
  // Cursor's file keeps its `hooks` key, empty or not, beside its version.
  const left: Settings = Object.keys(hooks).length === 0 && !cursor ? rest : { ...settings, hooks };
  // A hooks file with nothing left in it (in Cursor's, nothing but its version) was storytree's alone: it goes with them.
  if (file === "hooks.json" && Object.keys(hooks).length === 0 && (cursor ? isDeepStrictEqual(rest, { version: 1 }) : Object.keys(rest).length === 0)) rmSync(settingsFile);
  else writeSettings(settingsFile, left);
  return "removed";
}

/** Whether a hook entry runs storytree's hook script. */
function isStorytrees(entry: HookEntry): boolean {
  return commandWords(entry).some((part) => typeof part === "string" && part.includes(SCRIPT_NAME));
}

/** The command, and any arguments, of each hook an entry runs: its own in Cursor's flat shape, its `hooks`' in the others'. */
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

/** Two registrations' entries, event by event. */
function mergedEntries(one: Record<string, HookEntry[]>, other: Record<string, HookEntry[]>): Record<string, HookEntry[]> {
  const merged: Record<string, HookEntry[]> = { ...one };
  for (const [event, entries] of Object.entries(other)) merged[event] = [...(merged[event] ?? []), ...entries];
  return merged;
}

/** Remove one installation's hooks from one harness, preserving other commands in mixed groups. */
function removeHarnessHooks(homes: Homes, harness: Harness, hook: HookCommand): RemovalReport {
  const report: RemovalReport = { "claude-code": "none", codex: "none", cursor: "none", pi: "none", antigravity: "none", statusLine: "none" };
  if (harness === "pi") return { ...report, pi: removePi(homes.pi, hook.script) };
  if (harness === "antigravity") return { ...report, antigravity: removeAntigravity(homes.antigravity, hook.script) };
  const home = harness === "claude-code" ? homes.claude : homes[harness];
  if (home === undefined) return report;
  const file = path.join(home, harness === "claude-code" ? "settings.json" : "hooks.json");
  if (!existsSync(file)) return report;
  const settings = readSettings(file);
  if (settings === null || Array.isArray(settings) || typeof settings !== "object" ||
      (settings.hooks !== undefined && (settings.hooks === null || Array.isArray(settings.hooks) || typeof settings.hooks !== "object"))) throw new Error(`Repair ${file} before removing hooks.`);
  // Both of Codex's shapes, whichever Codex this machine had when they were registered.
  const entries = harness === "claude-code" ? claudeEntries(hook) : harness === "codex" ? mergedEntries(codexEntries(hook), codexEntries(hook, CODEX_DELIVERS_FROM)) : cursorEntries(hook);
  // Cursor's entries are themselves the hooks.
  const wanted: Record<string, unknown>[] = Object.values(entries).flatMap((groups) => groups.flatMap((group) => harness === "cursor" ? [{ command: group.command }] : group.hooks ?? []));
  // The asking start hook an install before ADR-0752 registered goes too.
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
      // A hook with no command (Codex's tool handler) is storytree's only when it is exactly the one storytree registers.
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
  // Cursor's file with no hook left and nothing but its version was storytree's alone, as Codex's empty one is.
  if (harness === "codex" ? Object.keys(next).length === 0 : harness === "cursor" && isDeepStrictEqual(next, { version: 1, hooks: {} })) rmSync(file);
  else writeSettings(file, next);
  return { ...report, [harness]: removed ? "removed" : "none", statusLine: statusLine ? "removed" : "none" };
}
