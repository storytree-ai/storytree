// The user's click at Claude Code's permission prompt, for headless turns (--permission-prompt-tool mcp__user__approve).
// A minimal stdio MCP server: every prompt it is shown is appended to the log named by its first argument; it says yes to
// file edits (the user has told the agent to go ahead) and no to anything else, so only storytree's "ask" reaches it.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const log = process.argv[2];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const tool = { name: "approve", description: "The user's answer to a permission prompt.", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] } };
createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "user", version: "1" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [tool] } });
  else if (m.method === "tools/call") {
    const a = m.params?.arguments ?? {};
    const yes = /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(a.tool_name);
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), answer: yes ? "allow" : "deny", ...a }) + "\n");
    const answer = yes ? { behavior: "allow", updatedInput: a.input } : { behavior: "deny", message: "The user declined this." };
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(answer) }] } });
  } else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
