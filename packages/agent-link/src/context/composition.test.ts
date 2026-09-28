/**
 * Contract 9.8 · a Claude Code reading's composition in four groups (arc_895e232031b0). The
 * transcript is written in the shapes Claude Code 2.1.283 writes: `attachment` records typed by
 * `attachment.type`, message blocks typed by `type`, a tool's result naming its call's id.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeCodeComposition, CHARS_PER_TOKEN } from "./index.js";

const bytes = (...values: unknown[]): number => values.reduce<number>((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0);
const tokens = (...values: unknown[]): number => Math.round(bytes(...values) / CHARS_PER_TOKEN);
const jsonl = (...records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

const call = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const result = (id: string, size: number) => ({ type: "tool_result", tool_use_id: id, content: "x".repeat(size) });
const assistant = (content: unknown[], usage?: Record<string, number>) => ({
  type: "assistant", requestId: `req_${Math.random()}`, message: { model: "claude-opus-5-5", role: "assistant", content, ...(usage && { usage }) },
});
const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: "user", message: { role: "user", content }, ...extra });

test("9.8 a Claude Code reading splits its context into Injected, Grounding, Implementation and Other, sorting each call by what it does and each record by the harness's own label", () => {
  const guidance = { type: "nested_memory", content: "g".repeat(400) };
  const hook = { type: "hook_success", stdout: "h".repeat(300) };
  const unknown = { type: "mystery_label", body: "m".repeat(100) };
  const prompt = "Line up the bars";
  const calls = [
    call("read", "Read", { file_path: "a.ts" }),
    call("grep", "Bash", { command: "cd pkg && grep -n foo src | head -20" }),
    call("digest", "Agent", { prompt: "find it" }),
    call("test", "Bash", { command: "pnpm test" }),
    call("edit", "Edit", { file_path: "a.ts", old_string: "a", new_string: "b" }),
    call("web", "mcp__somewhere__do_thing", {}),
  ];
  const results = [result("read", 4_000), result("grep", 2_000), result("digest", 1_000), result("test", 3_000), result("edit", 500), result("web", 700)];
  const orphan = result("never-called", 900);
  const meta = { type: "text", text: "Caveat: the harness wrote this" };
  const prose = { type: "text", text: "Done: the bars line up." };
  const thinking = { type: "thinking", thinking: "t".repeat(800) };
  const text = jsonl(
    { type: "attachment", attachment: guidance },
    { type: "attachment", attachment: hook },
    { type: "attachment", attachment: unknown },
    user(prompt),
    // The first own request: 20,000 tokens resident, most of it the system prompt and tool list no line records.
    assistant([thinking, ...calls], { input_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 18_000 }),
    user(results),
    user([orphan]),
    user([meta], { isMeta: true }),
    { type: "last-prompt", lastPrompt: "bookkeeping, never counted" },
    // A subagent's own window: left out whatever it holds.
    { ...user([result("sidechain", 50_000)]), isSidechain: true },
    assistant([prose], { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0 }),
  );

  const floor = 20_000 - Math.ceil(bytes(guidance, hook, unknown, prompt) / CHARS_PER_TOKEN);
  assert.deepEqual(claudeCodeComposition(text), {
    injected: floor + tokens(guidance, hook, meta),
    grounding: tokens(results[0], results[1], results[2]),
    implementation: tokens(results[3], results[4], ...calls),
    other: tokens(unknown, prompt, thinking, results[5], orphan, prose),
    unsorted: ["attachment:mystery_label", "tool:mcp__somewhere__do_thing", "tool_result:unmatched"],
    charsPerToken: CHARS_PER_TOKEN,
  });
});
