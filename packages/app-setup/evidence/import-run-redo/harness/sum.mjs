// Summarise one Claude Code stream-json transcript (UTF-16 or UTF-8): each tool call, each refusal, and the final message.
// Usage: node sum.mjs <turn.jsonl> [--text] ; --text also prints every assistant text block.
import { readFileSync } from "node:fs";
const [file, flag] = process.argv.slice(2);
const raw = readFileSync(file);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8");
const short = (s, n = 220) => (s.length > n ? s.slice(0, n) + "…" : s);
for (const line of text.split(/\r?\n/)) {
  let m; try { m = JSON.parse(line); } catch { if (line.trim()) console.log("RAW", short(line)); continue; }
  if (m.type === "assistant") for (const c of m.message.content ?? []) {
    if (c.type === "tool_use") console.log("CALL", c.name, short(JSON.stringify(c.input)));
    else if (c.type === "text" && flag === "--text") console.log("SAY", c.text);
  }
  if (m.type === "user") for (const c of m.message?.content ?? []) {
    if (c.type === "tool_result" && (c.is_error || /refused|storytree\]/.test(JSON.stringify(c.content)))) console.log("  RESULT", c.is_error ? "ERROR" : "", short(typeof c.content === "string" ? c.content : JSON.stringify(c.content), 900));
  }
  if (m.type === "result") console.log("END", m.subtype, "cost", m.total_cost_usd, "turns", m.num_turns, "\nFINAL", m.result);
}
