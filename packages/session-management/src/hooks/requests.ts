// Capability 3 · Hooks
import type { Agent, NewLine } from "@storytree/library";

export const STORYTREE_TOOLS = "mcp__storytree__";

export const HOOK_EVENT_TOOL = `${STORYTREE_TOOLS}hook_event`;

export const MOD_TOOLS: readonly string[] = [HOOK_EVENT_TOOL, `${STORYTREE_TOOLS}heartbeat`, `${STORYTREE_TOOLS}lane_messages`];

export function toolRequestedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  const { tool_name: tool, tool_use_id: call, agent_id: subagent, agent_type: type } = input;
  if (!isText(tool) || !tool.startsWith(STORYTREE_TOOLS) || MOD_TOOLS.includes(tool) || !isText(call)) return undefined;
  const agent: Agent = isText(subagent) ? { subagent, ...(isText(type) ? { type } : {}) } : "orchestrator";
  return { ...common, kind: "tool-requested", tool: tool.slice(STORYTREE_TOOLS.length), call, agent };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
