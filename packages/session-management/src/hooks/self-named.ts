/**
 * Capability 3 · Hooks. The hook input storytree publishes for a harness of the user's own (ADR-1007 D4), version 1:
 * `storytree-hook <name>`, where the harness names itself, with input in Claude Code's hook shape. The page a
 * harness author reads is docs/custom-harness-hooks.md; a change here is a change users can feel.
 *
 * Kept to what the built-in parsers share: every event names the session (`session_id`), its working folder
 * (`cwd`) and itself (`hook_event_name`), one of SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop
 * and SessionEnd. Storytree does not guess from the harness's own tool names: the harness says what a tool call
 * is by the name it gives it, `Bash` for a command (`tool_input.command`), `Edit` or `Write` for a file edit
 * (`tool_input.file_path`, and a Write's whole new text as `tool_input.content`), and storytree's own tools as
 * `mcp__storytree__<tool>`; any other tool is not recorded. No transcript is read in version 1, so a
 * self-named harness's session has no context reading.
 */
import type { NewLine } from "@storytree/library";
import { HARNESS_IDS } from "@storytree/project-and-caller/caller";
import type { HookLines } from "./hooks.js";
import { toolRequestedLine } from "./requests.js";

/** A name a harness may give itself: letters, digits, dots, underscores and hyphens, starting with a letter or digit. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Words the hook command reads as something other than a harness. */
const NOT_NAMES = new Set(["statusline"]);

/** The published names of the tools that edit a file, and of the one that runs a command. */
const EDITS_FILE = new Set(["Edit", "Write"]);
const RUNS_COMMAND = "Bash";

/** Whether `harness` is a harness naming itself: a valid name that is no built-in harness's. */
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

/** The file an Edit or Write names, with a Write's whole new text. */
export function selfNamedEdit(input: Record<string, unknown>): { path: string; text?: string } | undefined {
  const { tool_name: tool, tool_input: toolInput } = input;
  if (!isText(tool) || !EDITS_FILE.has(tool) || !isRecord(toolInput) || !isText(toolInput.file_path)) return undefined;
  return { path: toolInput.file_path, ...(tool === "Write" && typeof toolInput.content === "string" ? { text: toolInput.content } : {}) };
}

/** The command a Bash call runs, with the call's id where the harness gives one. */
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
