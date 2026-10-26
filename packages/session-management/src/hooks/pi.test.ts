/**
 * Capability 3 · Hooks: Pi (contract 3.32).
 *
 * Each input is what storytree's Pi extension forwards: Pi's own event, in the shapes a real Pi 1.1.0
 * logged on the Mint box on 2026-10-12 (its `type`, and a tool call's `toolName`, `toolCallId` and
 * `input`), with the session's id, folder and transcript the extension reads from Pi's context added.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { editIn, refusalAnswer } from "./edit-gate.js";
import { hookLines, promptAnswer } from "./hooks.js";

const SESSION = "01a12d5d-50ac-77b1-b29b-7123c4ef9c18";
const FOLDER = path.resolve("/work/site");
const TRANSCRIPT = path.join("/home/dev/.pi/agent/sessions/--work-site--", `2026-10-11T23-47-32-653Z_${SESSION}.jsonl`);

/** What the extension adds to every event it forwards. */
const forwarded = (event: Record<string, unknown> & { type: string }) => ({ ...event, hook_event_name: event.type, session_id: SESSION, cwd: FOLDER, transcript_path: TRANSCRIPT });

const common = { session: SESSION, harness: "pi", source: "hook", folder: FOLDER, transcript: TRANSCRIPT };
const one = (line: Record<string, unknown>) => ({ folder: FOLDER, lines: [{ ...common, ...line }] });
const made = (event: Record<string, unknown> & { type: string }) => hookLines("pi", forwarded(event));

test("3.32 Pi's events, as storytree's extension forwards them, make the session's lines under the harness pi: a start, a prompt, a storytree tool call, a command started and finished, a file written or edited (at its path in the session's folder), a turn's end and an end", () => {
  assert.deepEqual(made({ type: "session_start", reason: "startup" }), one({ kind: "session-started", how: "startup" }));
  assert.deepEqual(made({ type: "before_agent_start", prompt: "add a sign-up form" }), one({ kind: "prompt-submitted" }), "without the prompt's words");
  assert.deepEqual(made({ type: "tool_call", toolName: "mcp__storytree__check_setup", toolCallId: "call_mcp_1", input: {} }), one({ kind: "tool-requested", tool: "check_setup", call: "call_mcp_1", agent: "orchestrator" }));
  assert.equal(made({ type: "tool_call", toolName: "mcp__github__open", toolCallId: "call_2", input: {} }), undefined, "another server's tool is not storytree's");
  const bash = { toolName: "bash", toolCallId: "call_bash_1", input: { command: "echo storytree-check" } };
  assert.deepEqual(made({ type: "tool_call", ...bash }), one({ kind: "command-started", command: "echo storytree-check", call: "call_bash_1" }));
  assert.deepEqual(made({ type: "tool_result", ...bash, content: [], isError: true }), one({ kind: "command-run", command: "echo storytree-check", call: "call_bash_1" }), "a command that failed still ran");
  assert.deepEqual(made({ type: "tool_result", toolName: "write", toolCallId: "call_w", input: { path: "notes.txt", content: "x" }, content: [], isError: false }), one({ kind: "file-edited", files: [path.join(FOLDER, "notes.txt")] }));
  assert.deepEqual(made({ type: "tool_result", toolName: "edit", toolCallId: "call_e", input: { path: path.join(FOLDER, "a.ts"), edits: [] }, content: [], isError: false }), one({ kind: "file-edited", files: [path.join(FOLDER, "a.ts")] }));
  assert.equal(made({ type: "tool_result", toolName: "write", toolCallId: "call_w2", input: { path: "notes.txt", content: "x" }, content: [], isError: true }), undefined, "a write that failed (or was refused) edited nothing");
  assert.equal(made({ type: "tool_result", toolName: "read", toolCallId: "call_r", input: { path: "a.ts" }, content: [], isError: false }), undefined, "a tool the log does not record");
  assert.deepEqual(made({ type: "agent_end", messages: [] }), one({ kind: "turn-ended" }));
  assert.deepEqual(made({ type: "session_shutdown", reason: "quit" }), one({ kind: "session-ended", reason: "quit" }));
  assert.equal(hookLines("pi", { type: "agent_end", hook_event_name: "agent_end", cwd: FOLDER }), undefined, "an event naming no session makes none");
});

test("3.32 in Pi the hook answers in Pi's own shape: the edit gate's refusal as a blocked tool call whose reason the model reads, the prompt hook's added context as a message the model sees and the user does not", () => {
  const write = forwarded({ type: "tool_call", toolName: "write", toolCallId: "call_w", input: { path: "src/new.ts", content: "// Capability 3 · Hooks" } });
  assert.deepEqual(editIn("pi", write), { session: SESSION, folder: FOLDER, files: [{ path: path.join(FOLDER, "src/new.ts"), text: "// Capability 3 · Hooks" }] });
  const edit = forwarded({ type: "tool_call", toolName: "edit", toolCallId: "call_e", input: { path: "src/old.ts", edits: [{ oldText: "a", newText: "b" }] } });
  assert.deepEqual(editIn("pi", edit), { session: SESSION, folder: FOLDER, files: [{ path: path.join(FOLDER, "src/old.ts") }] });
  assert.equal(editIn("pi", forwarded({ type: "tool_call", toolName: "bash", toolCallId: "c", input: { command: "ls" } })), undefined);

  assert.deepEqual(JSON.parse(refusalAnswer("pi", "held by another session")), { block: true, reason: "held by another session" });
  const prompt = forwarded({ type: "before_agent_start", prompt: "what is a capability?" });
  assert.deepEqual(JSON.parse(promptAnswer("pi", ["Capability: a part that makes a story work."], prompt) ?? "null"), {
    message: { customType: "storytree", content: "Capability: a part that makes a story work.", display: false },
  });
  assert.equal(promptAnswer("pi", [], prompt), undefined, "nothing to add prints nothing");
});
