// What one model-driven user turn did and cost, from its Claude Code stream-json transcript.
// Usage: node sum.mjs <turn-N.jsonl>  →  JSON on stdout: seconds, cost, tokens, tools used, refusals, its last reply.
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2]);
// cmd's redirection keeps Claude Code's UTF-8; a transcript written by PowerShell's `>` would be UTF-16.
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");
const events = text.split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const tools = {};
for (const e of events) {
  if (e.type !== "assistant") continue;
  for (const c of e.message?.content ?? []) if (c.type === "tool_use") tools[c.name] = (tools[c.name] ?? 0) + 1;
}
const result = events.findLast((e) => e.type === "result");
const usage = result?.usage ?? {};
const tokens = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 };
console.log(JSON.stringify({
  ended: result ? result.subtype : "no result: the turn did not finish",
  seconds: result ? Math.round(result.duration_ms / 1000) : null,
  costUsd: result?.total_cost_usd ?? null,
  tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
  modelTurns: result?.num_turns ?? null,
  tools,
  storytreeCalls: Object.entries(tools).filter(([n]) => n.startsWith("mcp__storytree")).reduce((a, [, n]) => a + n, 0),
  refusals: result?.permission_denials ?? [],
  reply: result?.result ?? "",
}, null, 2));
