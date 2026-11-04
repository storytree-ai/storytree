// What one model-driven user turn did and cost, from its Claude Code stream-json transcript.
// Usage: node sum.mjs <turn-N.jsonl>  →  JSON on stdout: seconds, cost, tokens, tools used, refusals, its last reply.
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2]);
// cmd's redirection keeps Claude Code's UTF-8; a transcript written by PowerShell's `>` would be UTF-16.
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");
const events = text.split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const tools = {};
const written = [];
for (const e of events) {
  if (e.type !== "assistant") continue;
  for (const c of e.message?.content ?? []) {
    if (c.type !== "tool_use") continue;
    tools[c.name] = (tools[c.name] ?? 0) + 1;
    if (["Write", "Edit", "MultiEdit"].includes(c.name) && typeof c.input?.file_path === "string") written.push(c.input.file_path);
  }
}
// The project is the folder the turn's writes went to, which need not be the folder the turn ran in: on 2026-11-02 a
// turn ran in C:\Windows\System32 and built in Documents\tip-calculator, and the run's evidence looked in neither. A
// write into a dot folder (the agent's own settings, as .claude\) is not the project's, nor one into a temp folder: on
// 2026-11-04 the connected agent wrote check_setup's connection check into AppData\Local\Temp, and the project read as
// the whole profile folder.
function project(all) {
  const paths = all.filter((p) => !p.split(/[\\/]/).some((part) => part.startsWith(".") || /^te?mp$/i.test(part)));
  if (!paths.length) return "";
  const sep = paths[0].includes("\\") ? "\\" : "/";
  const folders = paths.map((p) => p.split(/[\\/]/).slice(0, -1));
  const common = folders.reduce((a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++;
    return a.slice(0, n);
  });
  return common.join(sep);
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
  project: project(written),
  storytreeCalls: Object.entries(tools).filter(([n]) => n.startsWith("mcp__storytree")).reduce((a, [, n]) => a + n, 0),
  refusals: result?.permission_denials ?? [],
  reply: result?.result ?? "",
}, null, 2));
