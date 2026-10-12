/**
 * Capability 3 · Hooks. Antigravity CLI's hook inputs (`agy`, Google's successor to Gemini CLI). NOT recorded
 * from a live session: built against the hook documentation Antigravity CLI 1.3.3 ships inside itself (its
 * builtin agy-customizations skill, docs/hooks.md) and the tool and argument names its binary holds, on the
 * Mint box on 2026-10-12, where agy runs no prompt without a Google sign-in. Every input is camelCase JSON
 * naming the conversation (`conversationId`, the session), its folders (`workspacePaths`, the first the
 * session's), its transcript (`transcriptPath`) and its model; none names the event, so storytree's
 * registration names it with `--event=<name>` and the hook command adds it as `hook_event_name`.
 *
 * - PreToolUse and PostToolUse (`toolCall.name`, `toolCall.args`, `stepIdx`; PostToolUse `error` when the
 *   tool failed). `run_command` runs `args.CommandLine`; `write_to_file` writes `args.TargetFile` whole with
 *   `args.CodeContent`, and `replace_file_content` and `multi_replace_file_content` edit it. A tool server's
 *   tool is `mcp_tool` naming `args.ServerName` and `args.ToolName`, or `mcp_<server>_<tool>`. A call has
 *   no id of its own: storytree names it by its conversation and step.
 * - Stop (`executionNum`, `terminationReason`, `fullyIdle`): the end of a run, the turn's end.
 * - PreInvocation and PostInvocation fire around every model call, not once a turn: no line.
 *
 * Antigravity has no session start or end event. A session's row opens on its first line, and no end is
 * ever written: once it stops sending, its row goes quiet. Every answer is JSON (hooks.ts prints `{}` for
 * nothing to say).
 */
import path from "node:path";

import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";

/** The name storytree's tool server is registered under in Antigravity's mcp_config.json. */
const TOOL_SERVER = "storytree";
/** Antigravity's tools that write one named file, and the one that runs a command. */
const EDITS_FILE = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content"]);
const RUNS_COMMAND = "run_command";

/** The session and folder an Antigravity hook input is about, or undefined when it names either none. */
export function antigravitySession(input: Record<string, unknown>): { session: string; folder: string } | undefined {
  const { conversationId: session, workspacePaths: folders } = input;
  const [folder] = Array.isArray(folders) ? (folders as unknown[]) : [];
  return isText(session) && isText(folder) ? { session, folder } : undefined;
}

export function antigravityLines(input: Record<string, unknown>): HookLines | undefined {
  const about = antigravitySession(input);
  const event = input.hook_event_name;
  if (about === undefined || !isText(event)) return undefined;
  const { session, folder } = about;
  const common = { session, harness: "antigravity", source: "hook", folder, ...(isText(input.transcriptPath) ? { transcript: input.transcriptPath } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });
  const call = typeof input.stepIdx === "number" ? `${session}:${input.stepIdx}` : undefined;

  switch (event) {
    case "PreToolUse": {
      const tool = storytreeTool(input);
      if (tool !== undefined && call !== undefined) return line({ ...common, kind: "tool-requested", tool, call, agent: "orchestrator" });
      const command = commandIn(input);
      return line(command === undefined || call === undefined ? undefined : { ...common, kind: "command-started", command, call });
    }
    case "PostToolUse": {
      const command = commandIn(input);
      if (command !== undefined) return line({ ...common, kind: "command-run", command, ...(call === undefined ? {} : { call }) });
      // A write Antigravity refused or that failed changed nothing.
      const file = isText(input.error) ? undefined : antigravityEdit(input, folder)?.path;
      return line(file === undefined ? undefined : { ...common, kind: "file-edited", files: [file] });
    }
    case "Stop":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

/** The file an Antigravity write or edit names, at its place in `folder`, with a write's whole new text. */
export function antigravityEdit(input: Record<string, unknown>, folder: string): { path: string; text?: string } | undefined {
  const { name, args } = toolCallOf(input);
  if (name === undefined || !EDITS_FILE.has(name) || !isText(args.TargetFile)) return undefined;
  return { path: path.resolve(folder, args.TargetFile), ...(name === "write_to_file" && typeof args.CodeContent === "string" ? { text: args.CodeContent } : {}) };
}

/** Which of storytree's own tools a call is, by either name Antigravity may give a tool server's tool. */
function storytreeTool(input: Record<string, unknown>): string | undefined {
  const { name, args } = toolCallOf(input);
  if (name === "mcp_tool") return args.ServerName === TOOL_SERVER && isText(args.ToolName) ? args.ToolName : undefined;
  const prefix = `mcp_${TOOL_SERVER}_`;
  return name?.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : undefined;
}

/** The command a run_command call runs. */
function commandIn(input: Record<string, unknown>): string | undefined {
  const { name, args } = toolCallOf(input);
  return name === RUNS_COMMAND && typeof args.CommandLine === "string" ? args.CommandLine : undefined;
}

function toolCallOf(input: Record<string, unknown>): { name?: string; args: Record<string, unknown> } {
  const call = isRecord(input.toolCall) ? input.toolCall : {};
  return { ...(isText(call.name) ? { name: call.name } : {}), args: isRecord(call.args) ? call.args : {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
