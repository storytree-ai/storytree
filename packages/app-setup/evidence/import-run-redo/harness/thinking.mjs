// The agent's own words at each decision point: every thinking and text block of a Claude Code session file
// (~\.claude\projects\<folder>\<session>.jsonl), in order, each followed by the tool calls it led to.
// Usage: node thinking.mjs <session.jsonl> [from ISO time] [to ISO time]
import { readFileSync } from "node:fs";
const [file, from = "", to = "9"] = process.argv.slice(2);
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.type !== "assistant" || !(m.timestamp >= from && m.timestamp <= to)) continue;
  for (const c of m.message?.content ?? []) {
    if (c.type === "thinking" && c.thinking) console.log(`\n[${m.timestamp}] THINK ${c.thinking}`);
    else if (c.type === "tool_use") console.log(`[${m.timestamp}] CALL ${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
  }
}
