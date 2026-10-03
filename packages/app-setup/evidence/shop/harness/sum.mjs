// Summarise a claude stream-json transcript: model, tools in order (storytree ones named), final result.
import { readFileSync } from "node:fs";
const raw = readFileSync(process.argv[2]); const lines = (raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8")).split(/\r?\n/).filter(Boolean);
const calls = []; let init, result, texts = [];
for (const l of lines) {
  let j; try { j = JSON.parse(l); } catch { continue; }
  if (j.type === "system" && j.subtype === "init") init = j;
  if (j.type === "assistant") for (const c of j.message?.content ?? []) {
    if (c.type === "tool_use") calls.push(c.name.replace("mcp__storytree__", "st:") + (c.name.startsWith("mcp__storytree__") ? " " + JSON.stringify(c.input).slice(0, 140) : c.name === "PowerShell" || c.name === "Bash" ? " " + String(c.input.command).slice(0, 100).replace(/\s+/g, " ") : c.input.file_path ? " " + c.input.file_path.split(/[\/]/).slice(-2).join("/") : ""));
    if (c.type === "text") texts.push(c.text);
  }
  if (j.type === "result") result = j;
}
if (init) console.log("model:", init.model, "| mcp:", (init.mcp_servers || []).map((s) => s.name + "=" + s.status).join(","));
console.log("calls:", calls.length);
for (const c of calls) console.log("  -", c);
if (result) console.log("RESULT", result.subtype, "turns", result.num_turns, "ms", result.duration_ms, "cost", result.total_cost_usd, "\n" + result.result);
else console.log("(no result yet) last text:", texts.slice(-1)[0]?.slice(0, 600));
