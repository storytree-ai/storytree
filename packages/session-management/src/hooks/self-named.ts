// Capability 3 · Hooks
import type { NewLine } from "@storytree/library";
import { HARNESS_IDS } from "@storytree/project-and-caller/caller";
import type { HookLines } from "./hooks.js";
import { toolRequestedLine } from "./requests.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const NOT_NAMES = new Set(["statusline"]);

const EDITS_FILE = new Set(["Edit", "Write"]);
const RUNS_COMMAND = "Bash";

export function isSelfNamed(harness: string): boolean {
  return NAME.test(harness) && !NOT_NAMES.has(harness) && !(HARNESS_IDS as readonly string[]).includes(harness);
}

export function selfNamedLines(harness: string, input: Record<string, unknown>): HookLines | undefined {
  const { session_id: session, cwd: folder, hook_event_name: event } = input;
  if (!isText(session) || !isText(folder) || !isText(event)) return undefined;
  const common = { session, harness, source: "hook", folder } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });

  switch (event) {
    case "SessionStart":
      return line({ ...common, kind: "session-started", ...(isText(input.source) ? { how: input.source } : {}) });
    case "SessionEnd":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "PreToolUse": {
      const run = commandIn(input);
      return line(toolRequestedLine(common, input) ?? (run?.call === undefined ? undefined : { ...common, kind: "command-started", command: run.command, call: run.call }));
    }
    case "PostToolUse": {
      const run = commandIn(input);
      if (run !== undefined) return line({ ...common, kind: "command-run", command: run.command, ...(run.call === undefined ? {} : { call: run.call }) });
      const file = selfNamedEdit(input)?.path;
      return line(file === undefined ? undefined : { ...common, kind: "file-edited", files: [file] });
    }
    case "UserPromptSubmit":
      return line({ ...common, kind: "prompt-submitted" });
    case "Stop":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

export function selfNamedEdit(input: Record<string, unknown>): { path: string; text?: string } | undefined {
  const { tool_name: tool, tool_input: toolInput } = input;
  if (!isText(tool) || !EDITS_FILE.has(tool) || !isRecord(toolInput) || !isText(toolInput.file_path)) return undefined;
  return { path: toolInput.file_path, ...(tool === "Write" && typeof toolInput.content === "string" ? { text: toolInput.content } : {}) };
}

function commandIn(input: Record<string, unknown>): { command: string; call?: string } | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (tool !== RUNS_COMMAND || !isRecord(toolInput) || typeof toolInput.command !== "string") return undefined;
  return { command: toolInput.command, ...(isText(call) ? { call } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
