/**
 * Capability 3 · Hooks. Pi's events. Pi runs no hook command: storytree's Pi extension (written by the app
 * setup's hooks-config.ts) forwards each of Pi's own events to `storytree-hook pi` unchanged, adding what Pi
 * gives an extension beside the event: `hook_event_name` (the event's `type`), `session_id` (Pi's session
 * id, the `PI_SESSION_ID` its shells get), `cwd` and `transcript_path` (the session's file). Measured in a
 * real Pi 1.1.0 on 2026-10-12 (the increment's residue says how): a tool event carries `toolName`,
 * `toolCallId` and `input`; `bash` runs `input.command`, `write` writes `input.path` whole with
 * `input.content`, `edit` edits `input.path`, a path relative to the session's folder; storytree's own
 * tools, registered directly exposed, are `mcp__storytree__<tool>`.
 *
 * - session_start (`reason`) and session_shutdown (`reason`): the session's start and end.
 * - before_agent_start (`prompt`): once per run, before the model; also where the prompt hook adds context.
 * - tool_call: before a tool runs; the edit gate's refusal is its `{block, reason}` answer.
 * - tool_result (`isError`): after it ran.
 * - agent_end: the end of a run, the turn's end.
 */
import path from "node:path";

import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";
import { STORYTREE_TOOLS } from "./requests.js";

/** Pi's tools that write a file, and the one that runs a command. */
const EDITS_FILE = new Set(["write", "edit"]);
const RUNS_COMMAND = "bash";

/** The session and folder a forwarded Pi event is about, or undefined when it names either none. */
export function piSession(input: Record<string, unknown>): { session: string; folder: string } | undefined {
  const { session_id: session, cwd: folder } = input;
  return isText(session) && isText(folder) ? { session, folder } : undefined;
}

export function piLines(input: Record<string, unknown>): HookLines | undefined {
  const about = piSession(input);
  const event = input.hook_event_name;
  if (about === undefined || !isText(event)) return undefined;
  const { session, folder } = about;
  const common = { session, harness: "pi", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });

  switch (event) {
    case "session_start":
      return line({ ...common, kind: "session-started", ...(isText(input.reason) ? { how: input.reason } : {}) });
    case "session_shutdown":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "before_agent_start":
      return line({ ...common, kind: "prompt-submitted" });
    case "tool_call": {
      const { toolName: tool, toolCallId: call } = input;
      if (isText(tool) && tool.startsWith(STORYTREE_TOOLS) && isText(call)) return line({ ...common, kind: "tool-requested", tool: tool.slice(STORYTREE_TOOLS.length), call, agent: "orchestrator" });
      const run = commandIn(input);
      return line(run?.call === undefined ? undefined : { ...common, kind: "command-started", command: run.command, call: run.call });
    }
    case "tool_result": {
      const run = commandIn(input);
      if (run !== undefined) return line({ ...common, kind: "command-run", command: run.command, ...(run.call === undefined ? {} : { call: run.call }) });
      // A write Pi refused or that failed changed nothing.
      const file = input.isError === true ? undefined : piEdit(input, folder)?.path;
      return line(file === undefined ? undefined : { ...common, kind: "file-edited", files: [file] });
    }
    case "agent_end":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

/** The file a Pi write or edit names, at its place in `folder`, with a write's whole new text. */
export function piEdit(input: Record<string, unknown>, folder: string): { path: string; text?: string } | undefined {
  const { toolName: tool, input: toolInput } = input;
  if (!isText(tool) || !EDITS_FILE.has(tool) || !isRecord(toolInput) || !isText(toolInput.path)) return undefined;
  return { path: path.resolve(folder, toolInput.path), ...(tool === "write" && typeof toolInput.content === "string" ? { text: toolInput.content } : {}) };
}

/** The command a bash call runs, with the call's id. */
function commandIn(input: Record<string, unknown>): { command: string; call?: string } | undefined {
  const { toolName: tool, input: toolInput, toolCallId: call } = input;
  if (tool !== RUNS_COMMAND || !isRecord(toolInput) || typeof toolInput.command !== "string") return undefined;
  return { command: toolInput.command, ...(isText(call) ? { call } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
