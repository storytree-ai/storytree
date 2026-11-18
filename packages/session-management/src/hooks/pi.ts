// Capability 3 · Hooks
import path from "node:path";

import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";
import { STORYTREE_TOOLS } from "./requests.js";

const EDITS_FILE = new Set(["write", "edit"]);
const RUNS_COMMAND = "bash";

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
      const file = input.isError === true ? undefined : piEdit(input, folder)?.path;
      return line(file === undefined ? undefined : { ...common, kind: "file-edited", files: [file] });
    }
    case "agent_end":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

export function piEdit(input: Record<string, unknown>, folder: string): { path: string; text?: string } | undefined {
  const { toolName: tool, input: toolInput } = input;
  if (!isText(tool) || !EDITS_FILE.has(tool) || !isRecord(toolInput) || !isText(toolInput.path)) return undefined;
  return { path: path.resolve(folder, toolInput.path), ...(tool === "write" && typeof toolInput.content === "string" ? { text: toolInput.content } : {}) };
}

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
