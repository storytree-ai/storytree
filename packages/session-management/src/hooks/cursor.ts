// Capability 3 · Hooks
import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";

const TOOL_SERVER = "storytree";

export function cursorSession(input: Record<string, unknown>): { session: string; folder: string } | undefined {
  const session = isText(input.session_id) ? input.session_id : input.conversation_id;
  const [root] = Array.isArray(input.workspace_roots) ? (input.workspace_roots as unknown[]) : [];
  const folder = isText(input.cwd) ? input.cwd : isText(root) ? fromUriPath(root) : undefined;
  return isText(session) && folder !== undefined ? { session, folder } : undefined;
}

export function cursorLines(input: Record<string, unknown>): HookLines | undefined {
  const about = cursorSession(input);
  const event = input.hook_event_name;
  if (about === undefined || !isText(event)) return undefined;
  const { session, folder } = about;
  const common = { session, harness: "cursor", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });

  switch (event) {
    case "sessionStart":
      return line({ ...common, kind: "session-started" });
    case "sessionEnd":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "beforeSubmitPrompt":
      return line({ ...common, kind: "prompt-submitted" });
    case "beforeMCPExecution":
      return line(toolRequestedLine(common, input));
    case "preToolUse": {
      const run = commandIn(input);
      return line(run?.call === undefined ? undefined : { ...common, kind: "command-started", command: run.command, call: run.call });
    }
    case "postToolUse":
    case "postToolUseFailure": {
      const run = commandIn(input);
      return line(run === undefined ? undefined : { ...common, kind: "command-run", command: run.command, ...(run.call === undefined ? {} : { call: run.call }) });
    }
    case "afterFileEdit":
      return line(isText(input.file_path) ? { ...common, kind: "file-edited", files: [input.file_path] } : undefined);
    case "subagentStart":
      return line(isText(input.subagent_id) ? { ...common, kind: "subagent-started", subagent: input.subagent_id, ...(isText(input.subagent_type) ? { type: input.subagent_type } : {}), ...(isText(input.task) ? { task: input.task } : {}) } : undefined);
    case "stop":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

function toolRequestedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  if (input.mcp_server_name !== TOOL_SERVER || !isText(input.tool_name)) return undefined;
  const tool = input.tool_name.replace(/^MCP:/, "");
  const call = isText(input.tool_use_id) ? input.tool_use_id : isText(input.generation_id) ? `${input.generation_id}:${tool}` : undefined;
  return call === undefined ? undefined : { ...common, kind: "tool-requested", tool, call, agent: "orchestrator" };
}

function commandIn(input: Record<string, unknown>): { command: string; call?: string } | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (tool !== "Shell" || typeof toolInput !== "object" || toolInput === null) return undefined;
  const { command } = toolInput as Record<string, unknown>;
  return typeof command !== "string" ? undefined : { command, ...(isText(call) ? { call } : {}) };
}

function fromUriPath(folder: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(folder) ? folder.slice(1) : folder;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
