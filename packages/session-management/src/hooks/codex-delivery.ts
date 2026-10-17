/**
 * Capability 3 · Hooks. Codex delivers its hook events through the tool server (ADR-1056 D2), its command hooks kept as
 * the fallback. From Codex 0.148 (read from its source at rust-v0.153.4, codex-rs/hooks/src/engine) a hook may be an
 * `mcp_tool` handler, which calls a tool on the session's already-connected tool server instead of starting a process,
 * and a command hook may be `async`, which the agent never waits for:
 *
 * - An `mcp_tool` handler's arguments are a template: each `${field}` that fills a whole string is that field of the
 *   event's input, as it is; there is no placeholder for the whole input, and a field the input lacks fails the hook.
 *   So each event the tool server takes names the fields it is sent ({@link CODEX_TOOL_EVENTS}): only fields every
 *   input of that event carries. A storytree tool's PreToolUse is not among them (a subagent's alone names its agent),
 *   nor SessionEnd (Codex runs no `mcp_tool` hook there), nor UserPromptSubmit (its command hook reaches the library
 *   anyway, for the definitions it adds).
 * - Handlers of one event run at once, and one that fails (the server not connected, an error, its timeout) blocks
 *   nothing and stops no other: Codex has no fallback of its own. So the command hook stays registered beside the
 *   tool's, `async` and with {@link AFTER_TOOL}: it waits a moment for the tool server's note that it recorded the
 *   event, and finding it, stands down without reaching the library (hooks.ts). The log keeps an event once whichever
 *   way it came, keyed by the same fields both ways (hooks.ts eventKey).
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The first Codex whose hooks run `mcp_tool` handlers and `async` command hooks (both from openai/codex 0.148.0). */
export const CODEX_DELIVERS_FROM = "0.148.0";

/** The flag of a command hook registered beside a tool server's handler for the same event: it stands down when the tool recorded it. */
export const AFTER_TOOL = "--after-tool";

/** Every input's fields that make its lines (codex.ts), shared by every event. */
const COMMON = ["session_id", "cwd", "hook_event_name", "transcript_path"] as const;

/** The events Codex hands the tool server, and the fields of each that it sends: every input of that event carries them. */
export const CODEX_TOOL_EVENTS: Readonly<Record<string, readonly string[]>> = {
  SessionStart: [...COMMON, "source"],
  PreToolUse: [...COMMON, "tool_name", "tool_input", "tool_use_id"],
  PostToolUse: [...COMMON, "tool_name", "tool_input", "tool_response", "tool_use_id"],
  Stop: [...COMMON],
};

/** Whether the Codex of `version` (as `codex --version` says it) runs `mcp_tool` handlers and `async` hooks. */
export function codexDelivers(version: string | undefined): boolean {
  const found = version === undefined ? null : /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (found === null) return false;
  const [major, minor, patch] = found.slice(1).map(Number) as [number, number, number];
  const [fromMajor, fromMinor, fromPatch] = CODEX_DELIVERS_FROM.split(".").map(Number) as [number, number, number];
  return major !== fromMajor ? major > fromMajor : minor !== fromMinor ? minor > fromMinor : patch >= fromPatch;
}

/** The arguments Codex's `mcp_tool` handler for `event` gives the tool server's hook_event tool: the harness, and the event's fields as templates. */
export function codexToolArguments(event: string): { harness: "codex"; input: Record<string, string> } | undefined {
  const fields = CODEX_TOOL_EVENTS[event];
  return fields === undefined ? undefined : { harness: "codex", input: Object.fromEntries(fields.map((field) => [field, `\${${field}}`])) };
}

/**
 * The fields that name a Claude Code event both ways, by event: Claude Code's mod (packages/claude-code-mod) sends a
 * PreToolUse rebuilt from the tool call's envelope, without the stdin's `prompt_id`, `permission_mode` or transcript,
 * and with the session's folder; the call's id names a tool call alone. Every other event's input it sends whole.
 */
const CLAUDE_CODE_TOOL_CALL = ["session_id", "hook_event_name", "tool_name", "tool_use_id"] as const;
export const CLAUDE_CODE_EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  SessionStart: ["session_id", "cwd", "hook_event_name", "source"],
  SessionEnd: ["session_id", "cwd", "hook_event_name", "reason"],
  UserPromptSubmit: ["session_id", "cwd", "hook_event_name", "prompt"],
  PreToolUse: CLAUDE_CODE_TOOL_CALL,
  PostToolUse: CLAUDE_CODE_TOOL_CALL,
  PostToolUseFailure: CLAUDE_CODE_TOOL_CALL,
  Stop: ["session_id", "cwd", "hook_event_name"],
};

/** `input` as both ways deliver it: for Codex, only the fields its tool handler sends for the event; for Claude Code, the fields that name it; for any other harness, as it is. */
export function deliveredInput(harness: string, input: unknown): unknown {
  const named = harness === "codex" ? CODEX_TOOL_EVENTS : harness === "claude-code" ? CLAUDE_CODE_EVENT_FIELDS : undefined;
  if (named === undefined || typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const fields = named[String((input as Record<string, unknown>).hook_event_name)];
  return fields === undefined ? input : Object.fromEntries(fields.filter((field) => field in input).map((field) => [field, (input as Record<string, unknown>)[field]]));
}

/** Where the tool server notes the events it recorded, under the storytree home `home`. */
function notes(home: string): string {
  return path.join(home, "tool-delivered");
}

/** How long a note waits for its command hook: one never read (a Codex older than its registration, a harness with none) goes after it. */
const NOTE_KEPT_MS = 5 * 60_000;

/** Note that the tool server recorded the event `key`, so its command hook stands down; older notes no hook read go. Never throws. */
export function noteDelivered(home: string, key: string): void {
  try {
    const folder = notes(home);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, key), "");
    const now = Date.now();
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name);
      const written = statSync(file, { throwIfNoEntry: false })?.mtimeMs;
      if (written !== undefined && now - written > NOTE_KEPT_MS) rmSync(file, { force: true });
    }
  } catch {
    // Without its note the command hook records the event too, which the log keeps once.
  }
}

/** How long a background command hook waits for the tool server's note of its event: the agent waits for neither, since the hook is `async`. */
export const TOOL_GRACE_MS = 3_000;

/** Whether the tool server noted the event `key` within `graceMs`, taking the note if so. */
export async function deliveredByTool(home: string, key: string, graceMs = TOOL_GRACE_MS): Promise<boolean> {
  const file = path.join(notes(home), key);
  const until = Date.now() + graceMs;
  for (;;) {
    try {
      rmSync(file);
      return true;
    } catch {
      if (Date.now() >= until) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
