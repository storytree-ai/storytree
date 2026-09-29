/**
 * Contract 9.10 · a session's window, read from its transcript (ADR-0746 D1): what is in it now, the
 * call that brought each piece, and for each note or file it opened, the earlier results already
 * in view that held its id. Written in the shapes Claude Code 2.1.283 and Codex 0.155 write.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeCodeWindow, codexWindow } from "./index.js";

const jsonl = (...records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
let uuid = 0;
const line = (record: Record<string, unknown>) => ({ uuid: `u${++uuid}`, isSidechain: false, ...record });
const calls = (...blocks: unknown[]) => line({ type: "assistant", message: { role: "assistant", content: blocks } });
const call = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const results = (...blocks: unknown[]) => line({ type: "user", message: { role: "user", content: blocks } });
const result = (id: string, content: unknown) => ({ type: "tool_result", tool_use_id: id, content });

test("9.10 a Claude Code window holds what came after the last compaction and its kept segment, leaves out side chains, joins each result to its call, and says which earlier results in view held each opened id", () => {
  const kept = results(result("kept", "a note kept through the compaction"));
  const text = jsonl(
    calls(call("gone", "mcp__storytree__search_notes", { query: "claims" })),
    results(result("gone", "decision_000000000001 Claims by write-ownership")),
    calls(call("kept", "Read", { file_path: "/repo/notes.md" })),
    kept,
    line({ type: "system", subtype: "compact_boundary", compactMetadata: { preservedSegment: { headUuid: kept.uuid, tailUuid: kept.uuid } } }),
    calls(call("search", "mcp__storytree__search_notes", { query: "claims" })),
    results(result("search", [{ type: "text", text: "decision_000000000002 Release on merge\ndecision_000000000001 Claims" }])),
    calls(call("open-2", "mcp__storytree__open", { id: "decision_000000000002" })),
    results(result("open-2", "Release on merge. Links to decision_000000000001 and src/claims/merges.ts")),
    // A subagent's window is another window's: its calls and results are never this one's.
    { ...calls(call("side", "Read", { file_path: "src/claims/merges.ts" })), isSidechain: true },
    { ...results(result("side", "decision_000000000003")), isSidechain: true },
    calls(call("open-1", "Bash", { command: "pnpm storytree library read decision_000000000001 | head -40" }), call("file", "Read", { file_path: "src/claims/merges.ts" })),
    results(result("open-1", "Claims by write-ownership"), result("file", "export function merges() {}")),
  );

  const window = claudeCodeWindow(text);
  assert.deepEqual(window.inView.map(({ call }) => call), ["kept", "search", "open-2", "open-1", "file"]);
  assert.deepEqual(window.inView.find(({ call }) => call === "open-2"), { call: "open-2", tool: "mcp__storytree__open", opened: [{ kind: "note", id: "decision_000000000002" }] });
  assert.equal(window.compactions, 1);
  assert.deepEqual(window.opens.map(({ kind, id, call, resident, inViewFrom }) => ({ kind, id, call, resident, from: inViewFrom.map(({ call }) => call) })), [
    { kind: "file", id: "/repo/notes.md", call: "kept", resident: true, from: [] },
    { kind: "note", id: "decision_000000000002", call: "open-2", resident: true, from: ["search"] },
    // The search before the compaction held this id too, but it was no longer in view.
    { kind: "note", id: "decision_000000000001", call: "open-1", resident: true, from: ["search", "open-2"] },
    { kind: "file", id: "src/claims/merges.ts", call: "file", resident: true, from: ["open-2"] },
  ]);
});

test("9.10 a Codex window drops what a compaction replaced, joins outputs by call id, and reads opens from shell commands and exec cells", () => {
  const item = (payload: Record<string, unknown>) => ({ type: "response_item", payload });
  const text = jsonl(
    item({ type: "function_call", call_id: "old", name: "exec_command", arguments: JSON.stringify({ cmd: "storytree library search claims" }) }),
    item({ type: "function_call_output", call_id: "old", output: "decision_000000000001" }),
    { type: "compacted", payload: { message: "", replacement_history: [] } },
    item({ type: "function_call", call_id: "find", name: "exec_command", arguments: JSON.stringify({ cmd: "storytree library search claims" }) }),
    item({ type: "function_call_output", call_id: "find", output: "decision_000000000001 Claims" }),
    item({ type: "custom_tool_call", call_id: "cell", name: "exec", input: 'text(await tools.exec_command({cmd:"pnpm storytree library read decision_000000000001"}))' }),
    item({ type: "custom_tool_call_output", call_id: "cell", output: "Claims by write-ownership" }),
  );

  const window = codexWindow(text);
  assert.deepEqual(window.inView.map(({ call }) => call), ["find", "cell"]);
  assert.equal(window.compactions, 1);
  assert.deepEqual(window.opens, [
    { kind: "note", id: "decision_000000000001", call: "cell", tool: "exec", resident: true, inViewFrom: [{ call: "find", tool: "exec_command", opened: [] }] },
  ]);
});

test("9.10 a note named in a result still in the window but never opened is glimpsed, once, in the order first named; an opened note and one named only in a compacted result are not", () => {
  const text = jsonl(
    calls(call("old", "mcp__storytree__search_notes", { query: "claims" })),
    results(result("old", "decision_000000000009 Gone with the compaction")),
    line({ type: "system", subtype: "compact_boundary" }),
    calls(call("find", "mcp__storytree__search_notes", { query: "claims" })),
    results(result("find", "decision_000000000002 Release\ndecision_000000000001 Claims\ndecision_000000000002 again")),
    calls(call("open", "mcp__storytree__open", { id: "decision_000000000001" })),
    results(result("open", "Claims. Links to principle_000000000003")),
  );

  assert.deepEqual(claudeCodeWindow(text).glimpses, ["decision_000000000002", "principle_000000000003"]);
});
