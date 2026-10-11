/**
 * Capability 3 · Hooks. Cursor's hook inputs. NOT recorded from a live session: read from the hook code of the
 * installed Cursor command line (2026.07.09) and editor (3.10.20) on 2026-10-12, when the laptop's Cursor
 * sign-in had lapsed and no agent prompt could be run (definition_04d2ef2dd305 says which findings were
 * measured). Every event names itself in camelCase (`hook_event_name`), the session (`session_id`, which is
 * the `conversation_id`), Cursor's version (`cursor_version`), the workspace (`workspace_roots`) and, once
 * its file exists, the transcript (`transcript_path`, null before). Only tool events name a working folder
 * (`cwd`); for the rest the session's folder is its first workspace root.
 *
 * - sessionStart, sessionEnd (`reason`), beforeSubmitPrompt (`prompt`) and stop: the session's start and
 *   end, and each turn's. Cursor fires the prompt and stop hooks only where its own hooks file registers
 *   them, never for hooks it loaded from Claude Code's settings.
 * - beforeMCPExecution names the tool server (`mcp_server_name`) and the tool; preToolUse names an MCP tool
 *   as `MCP:<tool>` with no server, so storytree's own tools are heard here.
 * - preToolUse, postToolUse and postToolUseFailure carry `tool_name`, `tool_input` and `tool_use_id`. The
 *   shell tool is `Shell`, its `tool_input.command` the command.
 * - afterFileEdit names the file an edit tool wrote (`file_path`), whichever tool it was.
 * - subagentStart names the subagent (`subagent_id`), its type and its task.
 */
import type { NewLine } from "../activity/index.js";
import type { HookLines } from "./hooks.js";

/** The name storytree's tool server is registered under, as Cursor's hook before an MCP call gives it. */
const TOOL_SERVER = "storytree";

/** The session and folder a Cursor hook input is about, or undefined when it names either none. */
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

/** A call to one of storytree's own tools. A call Cursor gives no id is named by its turn and tool, so it still has one. */
function toolRequestedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  if (input.mcp_server_name !== TOOL_SERVER || !isText(input.tool_name)) return undefined;
  const tool = input.tool_name.replace(/^MCP:/, "");
  const call = isText(input.tool_use_id) ? input.tool_use_id : isText(input.generation_id) ? `${input.generation_id}:${tool}` : undefined;
  return call === undefined ? undefined : { ...common, kind: "tool-requested", tool, call, agent: "orchestrator" };
}

/** The command a shell tool event runs, with the call's id where Cursor gives one. */
function commandIn(input: Record<string, unknown>): { command: string; call?: string } | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (tool !== "Shell" || typeof toolInput !== "object" || toolInput === null) return undefined;
  const { command } = toolInput as Record<string, unknown>;
  return typeof command !== "string" ? undefined : { command, ...(isText(call) ? { call } : {}) };
}

/** A Windows folder written as a file URI's path (`/c:/site`) is the folder (`c:/site`). */
function fromUriPath(folder: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(folder) ? folder.slice(1) : folder;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
