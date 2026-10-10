// Capability 6 · Agent tools (the MCP server). @storytree/mcp-server: the second front door (ADR-0969 D1). The MCP
// server an agent's harness starts: the wrapper every tool call passes through, whose tools are served, and the habits
// card that names them. It depends on every story it serves, and no story depends on it.
export { createAgentTools, NOT_A_PROJECT_ANSWER, NOT_RUNNING_ANSWER } from "./tools/index.js";
export type { AgentToolOptions, AgentTools, ToolExtension, ToolCall, DefineTool, ToolAnswer } from "./tools/index.js";
export { habitsCard } from "./instructions/habits.js";
