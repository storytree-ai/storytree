// Capability 3 · Hooks
import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";
import { outsideTextLine } from "./outside-text.js";
import { toolRequestedLine } from "./requests.js";

const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/;

export function codexLines(input: Record<string, unknown>): HookLines | undefined {
  const { session_id: session, cwd: folder, hook_event_name: event } = input;
  if (!isText(session) || !isText(folder) || !isText(event)) return undefined;
  const common = { session, harness: "codex", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
  const line = (made: NewLine | undefined): HookLines | undefined => (made === undefined ? undefined : { folder, lines: [made] });
  const lines = (...made: (NewLine | undefined)[]): HookLines | undefined => {
    const kept = made.filter((one) => one !== undefined);
    return kept.length === 0 ? undefined : { folder, lines: kept };
  };

  switch (event) {
    case "SessionStart":
      return line({ ...common, kind: "session-started", ...(isText(input.source) ? { how: input.source } : {}) });
    case "SessionEnd":
      return line({ ...common, kind: "session-ended", ...(isText(input.reason) ? { reason: input.reason } : {}) });
    case "PreToolUse":
      return line(toolRequestedLine(common, input) ?? commandStartedLine(common, input));
    case "PostToolUse":
      return lines(toolLine(common, input.tool_name, input.tool_input, input.tool_use_id) ?? subagentLine(common, input.tool_name, input.tool_input, input.tool_response),
        input.tool_name === "Bash" ? outsideTextLine(common, input.tool_name, input.tool_input) : undefined);
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
  return typeof command === "string" && !command.includes("*** Begin Patch") ? { ...common, kind: "command-started", command, call } : undefined;
}

export function patchEdits(patch: string): { path: string; text?: string }[] {
  const edits: { path: string; text?: string }[] = [];
  let adding: { path: string; text: string } | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("***")) adding = undefined;
    else if (adding !== undefined && line.startsWith("+")) adding.text += `${line.slice(1)}\n`;
    const file = PATCH_FILE.exec(line)?.[1]?.trimEnd();
    if (file === undefined || edits.some((edit) => edit.path === file)) continue;
    if (line.startsWith("*** Add File:")) edits.push((adding = { path: file, text: "" }));
    else edits.push({ path: file });
  }
  return edits;
}

function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const file = PATCH_FILE.exec(line)?.[1]?.trimEnd();
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
