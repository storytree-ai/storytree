// Capability 3 · Hooks
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CODEX_DELIVERS_FROM = "0.148.0";

export { AFTER_TOOL } from "./at-once.js";

const COMMON = ["session_id", "cwd", "hook_event_name", "transcript_path"] as const;

export const CODEX_TOOL_EVENTS: Readonly<Record<string, readonly string[]>> = {
  SessionStart: [...COMMON, "source"],
  PreToolUse: [...COMMON, "tool_name", "tool_input", "tool_use_id"],
  PostToolUse: [...COMMON, "tool_name", "tool_input", "tool_response", "tool_use_id"],
  Stop: [...COMMON],
};

export function codexDelivers(version: string | undefined): boolean {
  const found = version?.split(/[^\d.]+/).map((word) => /^(\d+)\.(\d+)\.(\d+)/.exec(word)).find((match) => match !== null);
  if (found === undefined) return false;
  const [major, minor, patch] = found.slice(1).map(Number) as [number, number, number];
  const [fromMajor, fromMinor, fromPatch] = CODEX_DELIVERS_FROM.split(".").map(Number) as [number, number, number];
  return major !== fromMajor ? major > fromMajor : minor !== fromMinor ? minor > fromMinor : patch >= fromPatch;
}

export function codexToolArguments(event: string): { harness: "codex"; input: Record<string, string> } | undefined {
  const fields = CODEX_TOOL_EVENTS[event];
  return fields === undefined ? undefined : { harness: "codex", input: Object.fromEntries(fields.map((field) => [field, `\${${field}}`])) };
}

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

export function deliveredInput(harness: string, input: unknown): unknown {
  const named = harness === "codex" ? CODEX_TOOL_EVENTS : harness === "claude-code" ? CLAUDE_CODE_EVENT_FIELDS : undefined;
  if (named === undefined || typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const fields = named[String((input as Record<string, unknown>).hook_event_name)];
  return fields === undefined ? input : Object.fromEntries(fields.filter((field) => field in input).map((field) => [field, (input as Record<string, unknown>)[field]]));
}

function notes(home: string): string {
  return path.join(home, "tool-delivered");
}

const NOTE_KEPT_MS = 5 * 60_000;

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
  }
}

export const TOOL_GRACE_MS = 3_000;

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
