/**
 * Capability 3 · Hooks. The line a hook makes just before a call to one of storytree's own tools (ADR-0629 D2): the
 * harness's id for the call, and the agent asking for it. Claude Code and Codex send the same
 * fields, as recorded from Claude Code 2.1.283 and Codex 0.155: inside a subagent `agent_id` and
 * `agent_type` name it, and the orchestrator's input names nobody. The call's `tool_use_id` is the
 * id the call then reaches the tool server with, which is how the tool server finds this line.
 */
import type { Agent, NewLine } from "@storytree/library";

/** How both harnesses name storytree's own tools: its tool server is registered under the name `storytree`. */
export const STORYTREE_TOOLS = "mcp__storytree__";

/** The tool server's tool a harness hands a hook event to (tools.ts), as both harnesses name it. */
export const HOOK_EVENT_TOOL = `${STORYTREE_TOOLS}hook_event`;

/** The tool server's tools Claude Code's mod calls itself, to deliver an event and to keep its heartbeat: no agent asks for them. */
export const MOD_TOOLS: readonly string[] = [HOOK_EVENT_TOOL, `${STORYTREE_TOOLS}heartbeat`];

export function toolRequestedLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, input: Record<string, unknown>): NewLine | undefined {
  const { tool_name: tool, tool_use_id: call, agent_id: subagent, agent_type: type } = input;
  // A call the mod makes itself (an event's delivery, its heartbeat) is the harness at work, never an agent's request.
  if (!isText(tool) || !tool.startsWith(STORYTREE_TOOLS) || MOD_TOOLS.includes(tool) || !isText(call)) return undefined;
  const agent: Agent = isText(subagent) ? { subagent, ...(isText(type) ? { type } : {}) } : "orchestrator";
  return { ...common, kind: "tool-requested", tool: tool.slice(STORYTREE_TOOLS.length), call, agent };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
