// Summarise a codex exec --json transcript: tool calls in order (storytree ones named), messages, usage.
import { readFileSync } from "node:fs";
const raw = readFileSync(process.argv[2]);
const s = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8");
for (const l of s.split(/\r?\n/).filter(Boolean)) {
  let j; try { j = JSON.parse(l); } catch { console.log("  (raw)", l.slice(0, 160)); continue; }
  const it = j.item;
  if (j.type === "item.completed" && it) {
    if (it.type === "mcp_tool_call") console.log("  - st:" + it.tool, JSON.stringify(it.arguments ?? {}).slice(0, 130), it.status ?? "", it.error ? "ERROR " + JSON.stringify(it.error).slice(0, 200) : "");
    else if (it.type === "command_execution") console.log("  - cmd", String(it.command).replace(/\s+/g, " ").slice(0, 120), "exit", it.exit_code);
    else if (it.type === "file_change") console.log("  - file", (it.changes ?? []).map((c) => c.kind + " " + String(c.path).split(/[\/]/).slice(-2).join("/")).join(", "));
    else if (it.type === "web_search") console.log("  - web_search", it.query ?? "");
    else if (it.type === "agent_message") console.log("MSG:", it.text);
    else console.log("  -", it.type);
  }
  if (j.type === "turn.completed") console.log("USAGE", JSON.stringify(j.usage));
  if (j.type === "turn.failed" || j.type === "error") console.log("FAIL", JSON.stringify(j).slice(0, 400));
}
