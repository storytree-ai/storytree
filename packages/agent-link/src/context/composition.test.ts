/**
 * Contract 9.8 · a Claude Code reading's composition in four groups (arc_895e232031b0). The
 * transcript is written in the shapes Claude Code 2.1.283 writes: `attachment` records typed by
 * `attachment.type`, message blocks typed by `type`, a tool's result naming its call's id.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeCodeComposition, codexComposition, CHARS_PER_TOKEN } from "./index.js";

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

/** A Codex rollout line, in the shapes Codex 0.155 writes: a `type` and a `payload`. */
const item = (payload: Record<string, unknown>) => ({ type: "response_item", payload });
const exec = (id: string, source: string) => ({ type: "custom_tool_call", call_id: id, name: "exec", input: source });
const shell = (command: string): string => `const r = await tools.exec_command({"cmd":${JSON.stringify(command)},"workdir":"C:\\\\w"}); text(r.output);`;
const output = (id: string, text: string) => ({ type: "custom_tool_call_output", call_id: id, output: [{ type: "input_text", text }] });
const counted = (input: number) => ({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: input } } } });

test("9.8 a Codex reading splits its context into the same four groups: base instructions, developer and harness-added messages Injected, each exec call by what its commands do, each output by its call", () => {
  const base = "b".repeat(2_000);
  const developer = { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions>".repeat(40) }] };
  const agentsMd = { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions ".repeat(30) }] };
  const prompt = { type: "message", role: "user", content: [{ type: "input_text", text: "Split the bars" }] };
  const reasoning = { type: "reasoning", summary: [], encrypted_content: "e".repeat(600) };
  const calls = [
    exec("read", shell("Get-Content -Raw a.ts; rg -n foo src")),
    exec("test", shell("pnpm test")),
    exec("patch", "const r = await tools.apply_patch(\"*** Begin Patch\\n*** End Patch\"); text(r);"),
    exec("script", "text(ALL_TOOLS.length);"),
  ];
  // The test cell outlives its call and names its cell; `wait` polls that cell.
  const wait = { type: "function_call", call_id: "wait", name: "wait", arguments: "{\"cell_id\":\"4\"}" };
  const outputs = [output("read", "Script completed\n" + "r".repeat(3_000)), output("test", "Script running with cell ID 4\n"), output("patch", "p".repeat(200)), output("script", "12")];
  const waited = { type: "function_call_output", call_id: "wait", output: "Exit code: 0\n" + "t".repeat(1_500) };
  const orphan = output("never-called", "o".repeat(300));
  const answer = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done: the bars split." }] };
  const text = jsonl(
    { type: "session_meta", payload: { id: "s", cli_version: "0.155.0", base_instructions: { text: base } } },
    { type: "event_msg", payload: { type: "task_started" } },
    item(developer),
    item(agentsMd),
    { type: "world_state", payload: { full: true, state: { current_date: "2026-09-28" } } },
    { type: "turn_context", payload: { cwd: "C:\\w" } },
    item(prompt),
    { type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Split the bars" }] } } },
    item(reasoning),
    ...calls.map(item),
    // The first request: 15,000 tokens resident, part of it the tool list and world state no line records as sent.
    counted(15_000),
    { type: "token_usage_record", payload: { usage: { input_tokens: 15_000 } } },
    ...outputs.map(item),
    item(wait),
    item(waited),
    item(orphan),
    item({ type: "mystery_item", body: "m".repeat(100) }),
    item(answer),
    counted(18_000),
  );

  const floor = 15_000 - Math.ceil(bytes(base, developer, agentsMd, prompt, reasoning, ...calls) / CHARS_PER_TOKEN);
  assert.deepEqual(codexComposition(text), {
    injected: floor + tokens(base, developer, agentsMd),
    grounding: tokens(outputs[0]),
    implementation: tokens(outputs[1], waited, outputs[2], ...calls, wait),
    other: tokens(prompt, reasoning, outputs[3], orphan, { type: "mystery_item", body: "m".repeat(100) }, answer),
    unsorted: ["item:mystery_item", "tool:exec:script", "tool_result:unmatched"],
    charsPerToken: CHARS_PER_TOKEN,
  });
});

/** A PNG's first bytes, naming its size, then `size` bytes of body: base64 as the harness writes it. */
const png = (width: number, height: number, size: number): string => {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(0x89504e47, 0);
  head.writeUInt32BE(0x0d0a1a0a, 4);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(size, 7)]).toString("base64");
};

test("9.8 a screenshot a session reads counts at what the model pays for its pixels, not at its base64 length, in Claude Code and Codex readings alike", () => {
  // A 1920×1080 screenshot, about 660K characters of base64: the length alone would read as ~170K tokens.
  const shot = png(1920, 1080, 490_000);
  const claude = claudeCodeComposition(jsonl(
    user("Look at it"),
    assistant([call("shot", "Read", { file_path: "shot.png" })], { input_tokens: 5_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    user([{ type: "tool_result", tool_use_id: "shot", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: shot } }] }]),
  ));
  const codex = codexComposition(jsonl(
    counted(5_000),
    item({ type: "function_call", call_id: "shot", name: "view_image", arguments: "{\"path\":\"shot.png\"}" }),
    item({ type: "function_call_output", call_id: "shot", output: [{ type: "input_image", image_url: `data:image/png;base64,${shot}` }] }),
  ));
  for (const reading of [claude, codex]) {
    assert.ok(reading !== undefined);
    assert.ok(reading.grounding > 1_000 && reading.grounding < 6_000, `grounding ${reading.grounding}`);
  }
});
