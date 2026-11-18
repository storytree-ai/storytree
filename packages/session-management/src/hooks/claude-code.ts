// Capability 3 · Hooks
import type { NewLine } from "@storytree/library";
import type { HookLines } from "./hooks.js";
import { outsideTextLine } from "./outside-text.js";
import { toolRequestedLine } from "./requests.js";

const EDITS_FILE = new Set(["Write", "Edit", "MultiEdit"]);
const STARTS_SUBAGENT = new Set(["Agent", "Task"]);
const RUNS_COMMAND = new Set(["Bash", "PowerShell"]);

export function claudeCodeLines(input: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): HookLines | undefined {
  const { session_id: session, cwd: folder, hook_event_name: event } = input;
  if (!isText(session) || !isText(folder) || !isText(event)) return undefined;
  const common = { session, harness: "claude-code", source: "hook", folder, ...(isText(input.transcript_path) ? { transcript: input.transcript_path } : {}) } as const;
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
      return lines(toolLine(common, input) ?? subagentLine(common, input.tool_name, input.tool_input, input.tool_response), outsideTextLine(common, input.tool_name, input.tool_input));
    case "PostToolUseFailure":
      return line(isText(input.tool_name) && RUNS_COMMAND.has(input.tool_name) ? toolLine(common, input) : undefined);
    case "SubagentStop":
      return line(isText(input.agent_id) ? { ...common, kind: "subagent-ended", subagent: input.agent_id } : undefined);
    case "UserPromptSubmit":
      return line({ ...common, kind: "prompt-submitted" });
    case "Stop":
      return line({ ...common, kind: "turn-ended", ...(Array.isArray(input.background_tasks) ? { background: input.background_tasks.length } : {}),
        ...(env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli" ? { exits: true } : {}) });
    case "UsageMeasured":
    case "TurnComplete": {
      const usage = usageOf(input.usage);
      const failed = event === "TurnComplete" && (input.reason === "error" || input.reason === "refusal") ? input.reason : undefined;
      const { transcript: _none, ...plain } = common;
      const lines: NewLine[] = [];
      if (usage !== undefined) lines.push({ ...plain, kind: "usage-measured", ...usage });
      if (failed !== undefined) {
        const limits = (usage?.rateLimits ?? []).filter((window) => window.percentUsed >= 100).map((window) => window.kind);
        lines.push({ ...plain, kind: "turn-failed", reason: failed, ...(limits.length === 0 ? {} : { limits }) });
      }
      return lines.length === 0 ? undefined : { folder, lines };
    }
    default:
      return undefined;
  }
}

type UsageFields = Pick<Extract<NewLine, { kind: "usage-measured" }>, "context" | "rateLimits" | "cost">;

function usageOf(usage: unknown): UsageFields | undefined {
  if (!isRecord(usage) || !isRecord(usage.context) || !isCount(usage.context.window) || usage.context.window === 0) return undefined;
  const { tokens, window, percent } = usage.context;
  const context = { window, ...(isCount(tokens) ? { tokens } : {}), ...(typeof percent === "number" && percent >= 0 && percent <= 100 ? { percent } : {}) };
  const rateLimits = (Array.isArray(usage.rateLimits) ? usage.rateLimits : []).filter(isRecord)
    .filter((one) => isText(one.kind) && typeof one.percentUsed === "number" && one.percentUsed >= 0)
    .map((one) => ({ kind: one.kind as string, percentUsed: one.percentUsed as number, ...(isText(one.resetsAt) ? { resetsAt: one.resetsAt } : {}) }))
    .slice(0, 20);
  const cost = isRecord(usage.cost) && typeof usage.cost.usd === "number" && usage.cost.usd >= 0 ? { cost: { usd: usage.cost.usd } } : {};
  return { context, rateLimits, ...cost };
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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
  const limitMs = Number(process.env.BASH_MAX_TIMEOUT_MS);
  return { ...common, kind: "command-started", command: toolInput.command, call, ...(Number.isSafeInteger(limitMs) && limitMs > 0 ? { limitMs } : {}) };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
