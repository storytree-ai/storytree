/**
 * Claude Code's hook inputs, as recorded from Claude Code 2.1.212 (and 2.1.283 for storytree's own
 * tools and subagents): every event names the session (`session_id`), its working folder (`cwd`)
 * and itself (`hook_event_name`).
 *
 * - SessionStart carries `source`: startup, resume, clear or compact. A resumed window keeps its
 *   session id.
 * - PostToolUse carries `tool_name` and `tool_input`. Write, Edit and MultiEdit name the file as
 *   `file_path`, NotebookEdit as `notebook_path`; Bash gives its `command`, and so does PowerShell,
 *   the shell tool Claude Code has on Windows without Git for Windows (seen in 2.1.283). The Agent tool (Task
 *   before it was renamed) starts a subagent: its `tool_input` gives the type (`subagent_type`) and
 *   the task (`description`), its `tool_response` the subagent's id (`agentId`). Other tools make no
 *   line.
 * - PreToolUse, registered for storytree's own tools, names the agent asking (requests.ts). Also
 *   registered, in the background, for Bash and PowerShell: its line says the command started,
 *   under the call's `tool_use_id`, which the line after it carries too (ADR-0636 D2).
 * - A command that exits with an error fires PostToolUseFailure instead of PostToolUse (seen
 *   2026-09-27 in Claude Code 2.1.283), with the same `tool_input` and `tool_use_id`, and `error`.
 * - Stop fires when the agent finishes its turn, and lists the `background_tasks` still running.
 * - SessionEnd carries `reason`.
 */
import type { NewLine } from "../activity/index.js";
import type { HookLines } from "./hooks.js";
import { toolRequestedLine } from "./requests.js";

const EDITS_FILE = new Set(["Write", "Edit", "MultiEdit"]);
const STARTS_SUBAGENT = new Set(["Agent", "Task"]);
/** The tools that run a command line. */
const RUNS_COMMAND = new Set(["Bash", "PowerShell"]);

export function claudeCodeLines(input: Record<string, unknown>): HookLines | undefined {
  const { session_id: session, cwd: folder, hook_event_name: event } = input;
  if (!isText(session) || !isText(folder) || !isText(event)) return undefined;
  // The transcript the harness named, on every line: where the session's context is read from (capability 9).
  const common = { session, harness: "claude-code", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });

  switch (event) {
    case "SessionStart":
      return line({ ...common, kind: "session-started", ...(isText(input.source) ? { how: input.source } : {}) });
    case "SessionEnd":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "PreToolUse":
      return line(toolRequestedLine(common, input) ?? commandStartedLine(common, input));
    case "PostToolUse":
      return line(toolLine(common, input) ?? subagentLine(common, input.tool_name, input.tool_input, input.tool_response));
    case "PostToolUseFailure":
      return line(isText(input.tool_name) && RUNS_COMMAND.has(input.tool_name) ? toolLine(common, input) : undefined);
    case "Stop":
      // A turn that leaves tasks running in the background may leave a command of theirs running too.
      return Array.isArray(input.background_tasks) && input.background_tasks.length > 0 ? undefined : line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

function subagentLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, tool: unknown, toolInput: unknown, toolResponse: unknown): NewLine | undefined {
  if (!isText(tool) || !STARTS_SUBAGENT.has(tool) || !isRecord(toolInput) || !isRecord(toolResponse) || !isText(toolResponse.agentId)) return undefined;
  const { subagent_type: type, description: task } = toolInput;
  return { ...common, kind: "subagent-started", subagent: toolResponse.agentId, ...(isText(type) ? { type } : {}), ...(isText(task) ? { task } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toolLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (!isText(tool) || !isRecord(toolInput)) return undefined;
  const { file_path: filePath, notebook_path: notebookPath, command } = toolInput;
  if (EDITS_FILE.has(tool) && isText(filePath)) return { ...common, kind: "file-edited", files: [filePath] };
  if (tool === "NotebookEdit" && isText(notebookPath)) return { ...common, kind: "file-edited", files: [notebookPath] };
  if (RUNS_COMMAND.has(tool) && typeof command === "string") return { ...common, kind: "command-run", command, ...(isText(call) ? { call } : {}) };
  return undefined;
}

function commandStartedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (!isText(tool) || !RUNS_COMMAND.has(tool) || !isRecord(toolInput) || typeof toolInput.command !== "string" || !isText(call)) return undefined;
  return { ...common, kind: "command-started", command: toolInput.command, call };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
