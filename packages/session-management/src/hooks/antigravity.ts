// Capability 3 · Hooks
import path from "node:path";

import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";

const TOOL_SERVER = "storytree";
const EDITS_FILE = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content"]);
const RUNS_COMMAND = "run_command";

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
      const file = isText(input.error) ? undefined : antigravityEdit(input, folder)?.path;
      return line(file === undefined ? undefined : { ...common, kind: "file-edited", files: [file] });
    }
    case "Stop":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

export function antigravityEdit(input: Record<string, unknown>, folder: string): { path: string; text?: string } | undefined {
  const { name, args } = toolCallOf(input);
  if (name === undefined || !EDITS_FILE.has(name) || !isText(args.TargetFile)) return undefined;
  return { path: path.resolve(folder, args.TargetFile), ...(name === "write_to_file" && typeof args.CodeContent === "string" ? { text: args.CodeContent } : {}) };
}

function storytreeTool(input: Record<string, unknown>): string | undefined {
  const { name, args } = toolCallOf(input);
  if (name === "mcp_tool") return args.ServerName === TOOL_SERVER && isText(args.ToolName) ? args.ToolName : undefined;
  const prefix = `mcp_${TOOL_SERVER}_`;
  return name?.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : undefined;
}

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
