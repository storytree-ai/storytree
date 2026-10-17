/**
 * Capability 1 · Forwards hook events through the tool server (the Claude Code mod, ADR-1056 D3). Claude Code runs
 * this module in a worker of its own for each session that loads the mod: no Node, no database, everything reached
 * through the engine's `$`. For each hook event storytree's command hooks record, it hands the event to the session's
 * already-connected tool server (`$.mcp`, its hook_event tool) and then lets the chain go on (`next(e)`).
 *
 * The chain of a classic hook event is [managed settings hooks, hooks modules, the other settings hooks]: storytree's
 * command hooks run beneath this module, after the tool server noted that it recorded the event, so they find the
 * note and stand down (session-management's hooks.ts); a delivery that fails or is slow leaves no note, and they
 * record the event as before. A hook here never fails the chain: a throw is skipped by the engine, and the hooks
 * beneath run in its place.
 *
 * The API is early access and moves between releases (read from Claude Code 2.1.284's own declarations), so this
 * module declares the little of `$` it uses rather than importing the build's types file.
 */

/** The part of the engine interface this module uses. */
export interface Engine {
  readonly mcp: { call(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown> };
  readonly session: { id(): Promise<string>; cwd(): Promise<string> };
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void } };
}

/** A classic hook event's input: its stdin as a command hook reads it, or for PreToolUse the tool call's envelope. */
export type Input = Record<string, unknown>;

/** How the module adds a hook: `on(event, hook)`, each hook `($, e, next)`. */
export type On = (event: string, hook: (engine: Engine, e: Input, next: (e: Input) => Promise<unknown>) => Promise<unknown>) => unknown;

/** The tool server, as the repository's .mcp.json names it, and its tool that takes a hook event (ADR-1056 D2). */
export const SERVER = "storytree";
export const HOOK_EVENT = "hook_event";

/** How long a delivery may hold the chain before the hooks beneath run anyway, and record the event themselves. */
export const DELIVERY_WAIT_MS = 2_000;

/** The tools whose calls storytree's command hooks record, by event (as setup registers them, app-setup hooks-config.ts). */
const SHELL = ["Bash", "PowerShell"];
const RECORDED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  // Before a shell command, its start; a storytree tool's own PreToolUse is left to its command hook, whose input alone names the subagent asking.
  PreToolUse: SHELL,
  PostToolUse: ["Write", "Edit", "MultiEdit", "NotebookEdit", ...SHELL, "Agent", "Task"],
  PostToolUseFailure: SHELL,
};

/** The events this module forwards: every one storytree's command hooks record a line for. */
export const FORWARDED = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"] as const;

/** The events whose delivery the chain waits for before the hooks beneath run. */
const AWAITED: ReadonlySet<string> = new Set(["UserPromptSubmit", "SessionEnd"]);

export function register(on: On): void {
  // The newest folder and transcript a classic event's own input named: classic.PreToolUse gives neither.
  const seen: Seen = {};
  // Each event is named as a literal: the engine reads which events a module hooks from its source.
  on("classic.SessionStart", ($, e, next) => forward("SessionStart", $, e, next, seen));
  on("classic.SessionEnd", ($, e, next) => forward("SessionEnd", $, e, next, seen));
  on("classic.UserPromptSubmit", ($, e, next) => forward("UserPromptSubmit", $, e, next, seen));
  on("classic.PreToolUse", ($, e, next) => forward("PreToolUse", $, e, next, seen));
  on("classic.PostToolUse", ($, e, next) => forward("PostToolUse", $, e, next, seen));
  on("classic.PostToolUseFailure", ($, e, next) => forward("PostToolUseFailure", $, e, next, seen));
  on("classic.Stop", ($, e, next) => forward("Stop", $, e, next, seen));
}

/** The newest folder and transcript the session's events named. */
interface Seen {
  cwd?: string;
  transcript_path?: string;
}

/** One event's hook: hand it to the tool server when storytree records it, then let the hooks beneath run. */
async function forward(event: (typeof FORWARDED)[number], $: Engine, e: Input, next: (e: Input) => Promise<unknown>, seen: Seen): Promise<unknown> {
  if (typeof e.cwd === "string") seen.cwd = e.cwd;
  if (typeof e.transcript_path === "string") seen.transcript_path = e.transcript_path;
  const input = event === "PreToolUse" ? await preToolUse($, e, seen) : recorded(event, e) ? e : undefined;
  if (input === undefined) return next(e);
  const delivering = deliver($, input);
  // The prompt's command hook runs in the foreground, and the end's is cut short: each looks for the tool's note at once, so it is
  // waited for. Every other event's command hook runs in the background and waits a moment for the note itself, so the agent never waits.
  if (AWAITED.has(event)) await delivering;
  return next(e);
}

/** Whether `e`, an event's whole input, is one storytree's command hooks record. */
function recorded(event: string, e: Input): boolean {
  const tools = RECORDED_TOOLS[event];
  return tools === undefined || (typeof e.tool_name === "string" && tools.includes(e.tool_name));
}

/** A PreToolUse's input as its command hook reads it, rebuilt from the tool call's envelope; undefined for a call storytree does not record here. */
async function preToolUse($: Engine, e: Input, seen: Seen): Promise<Input | undefined> {
  const { tool, tool_use_id: call, agentId: _loop, ...toolInput } = e;
  if (typeof tool !== "string" || typeof call !== "string" || !(RECORDED_TOOLS.PreToolUse ?? []).includes(tool)) return undefined;
  const [session, cwd] = await Promise.all([$.session.id(), seen.cwd === undefined ? $.session.cwd() : seen.cwd]);
  return {
    session_id: session,
    ...(seen.transcript_path === undefined ? {} : { transcript_path: seen.transcript_path }),
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: call,
  };
}

/** Hand `input` to the tool server, waiting at most DELIVERY_WAIT_MS; never throws. */
async function deliver($: Engine, input: Input): Promise<void> {
  let timer: { cancel(): void } | undefined;
  const late = new Promise<void>((resolve) => {
    timer = $.clock.after(DELIVERY_WAIT_MS, resolve);
  });
  try {
    await Promise.race([$.mcp.call(SERVER, HOOK_EVENT, { harness: "claude-code", input }).catch(() => undefined), late]);
  } catch {
    // The hooks beneath record the event: no note was written for them.
  } finally {
    timer?.cancel();
  }
}
