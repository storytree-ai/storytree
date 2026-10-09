/**
 * Capability 3 · Hooks. Codex's hook inputs, as recorded from Codex (codex-cli 0.155; hooks are on by default from 0.124,
 * and SessionEnd exists from 0.145): every event names the session (`session_id`), its working
 * folder (`cwd`) and itself (`hook_event_name`).
 *
 * - SessionStart carries `source`: startup, resume, clear or compact. A resumed session keeps its id.
 * - PostToolUse carries `tool_name` and `tool_input`. Codex edits files with `apply_patch`, whose
 *   `tool_input.command` is the patch text: the files are the ones its `*** Add File:`,
 *   `*** Update File:`, `*** Delete File:` and `*** Move to:` lines name. A shell command is `Bash`,
 *   its `tool_input.command` one string; a patch run through the shell (`apply_patch <<'EOF'`)
 *   arrives that way too, and is read as the patch it applies. `spawn_agent` starts a subagent: its
 *   `tool_input` gives the type (`agent_type`) and the task (`message`), and its `tool_response` is
 *   a JSON text holding the subagent's id (`agent_id`).
 * - PreToolUse, registered for storytree's own tools, names the agent asking (requests.ts). Also
 *   registered for Bash: its line says the command started, under the call's `tool_use_id`, which
 *   the line after it carries too (ADR-0636 D2). A command Codex's sandbox refuses fires only this
 *   one, never PostToolUse (seen 2026-09-27 in Codex 0.155).
 * - UserPromptSubmit carries the `prompt`: its line says the session's turn began, without the words.
 * - Stop fires when the agent finishes its turn, which closes a refused command.
 * - SessionEnd carries `reason`. Codex sends it only when a session shuts down, so a session whose
 *   end never comes goes idle instead (capability 4).
 */
import type { NewLine } from "../activity/index.js";
import type { HookLines } from "./hooks.js";
import { toolRequestedLine } from "./requests.js";

/** A line of a patch that names a file: the one it adds, updates or deletes, or where it moves one to. */
const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+?)\s*$/;

export function codexLines(input: Record<string, unknown>): HookLines | undefined {
  const { session_id: session, cwd: folder, hook_event_name: event } = input;
  if (!isText(session) || !isText(folder) || !isText(event)) return undefined;
  // The transcript the harness named, on every line: where the session's context is read from (capability 9).
  const common = { session, harness: "codex", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });

  switch (event) {
    case "SessionStart":
      return line({ ...common, kind: "session-started", ...(isText(input.source) ? { how: input.source } : {}) });
    case "SessionEnd":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "PreToolUse":
      return line(toolRequestedLine(common, input) ?? commandStartedLine(common, input));
    case "PostToolUse":
      return line(toolLine(common, input.tool_name, input.tool_input, input.tool_use_id) ?? subagentLine(common, input.tool_name, input.tool_input, input.tool_response));
    case "UserPromptSubmit":
      return line({ ...common, kind: "prompt-submitted" });
    case "Stop":
      return line({ ...common, kind: "turn-ended" });
    default:
      return undefined;
  }
}

function subagentLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, tool: unknown, toolInput: unknown, toolResponse: unknown): NewLine | undefined {
  if (tool !== "spawn_agent" || typeof toolInput !== "object" || toolInput === null) return undefined;
  const subagent = agentIdIn(toolResponse);
  if (subagent === undefined) return undefined;
  const { agent_type: type, message: task } = toolInput as Record<string, unknown>;
  return { ...common, kind: "subagent-started", subagent, ...(isText(type) ? { type } : {}), ...(isText(task) ? { task } : {}) };
}

/** The subagent's id in spawn_agent's answer: a JSON text, or already an object. */
function agentIdIn(response: unknown): string | undefined {
  let answer = response;
  if (typeof response === "string") {
    try {
      answer = JSON.parse(response);
    } catch {
      return undefined;
    }
  }
  const id = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>).agent_id : undefined;
  return isText(id) ? id : undefined;
}

function toolLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, tool: unknown, toolInput: unknown, call: unknown): NewLine | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const { command } = toolInput as Record<string, unknown>;
  if (typeof command !== "string") return undefined;
  const isPatch = tool === "apply_patch" || (tool === "Bash" && command.includes("*** Begin Patch"));
  if (isPatch) {
    const files = patchFiles(command);
    return files.length === 0 ? undefined : { ...common, kind: "file-edited", files };
  }
  return tool === "Bash" ? { ...common, kind: "command-run", command, ...(isText(call) ? { call } : {}) } : undefined;
}

function commandStartedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  const { tool_name: tool, tool_input: toolInput, tool_use_id: call } = input;
  if (tool !== "Bash" || typeof toolInput !== "object" || toolInput === null || !isText(call)) return undefined;
  const { command } = toolInput as Record<string, unknown>;
  // A patch run through the shell makes an edit line, not a command's finish line, so it starts no command.
  return typeof command === "string" && !command.includes("*** Begin Patch") ? { ...common, kind: "command-started", command, call } : undefined;
}

/** The files a patch names, each once, in the order it names them, with the whole text of each file it adds. */
export function patchEdits(patch: string): { path: string; text?: string }[] {
  const edits: { path: string; text?: string }[] = [];
  let adding: { path: string; text: string } | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("***")) adding = undefined;
    else if (adding !== undefined && line.startsWith("+")) adding.text += `${line.slice(1)}\n`;
    const file = PATCH_FILE.exec(line)?.[1];
    if (file === undefined || edits.some((edit) => edit.path === file)) continue;
    if (line.startsWith("*** Add File:")) edits.push((adding = { path: file, text: "" }));
    else edits.push({ path: file });
  }
  return edits;
}

/** The files a patch names, each once, in the order it names them. */
function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const file = PATCH_FILE.exec(line)?.[1];
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
