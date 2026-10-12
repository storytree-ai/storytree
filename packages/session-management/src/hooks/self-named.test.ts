/**
 * Capability 3 · Hooks: a harness that names itself (contracts 3.30 and 3.31), sending the input
 * docs/custom-harness-hooks.md publishes (ADR-1007 D4). The inputs are that page's own examples.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { editIn, refusalAnswer } from "./edit-gate.js";
import { hookLines } from "./hooks.js";

const SESSION = "my-chat-42";
const FOLDER = "/home/dev/projects/site";

const every = (event: string) => ({ session_id: SESSION, cwd: FOLDER, hook_event_name: event, transcript_path: "/home/dev/.my-harness/chats/42.jsonl" });
const common = { session: SESSION, harness: "my-harness", source: "hook", folder: FOLDER };
const one = (line: Record<string, unknown>) => ({ folder: FOLDER, lines: [{ ...common, ...line }] });

test("3.30 a harness that names itself and sends the published input makes its session's lines under that name: a start, a prompt, a storytree tool call, a command started and finished, a file edit, a turn's end and an end; any other tool, a built-in harness's name or an invalid name makes none, and no transcript is read", () => {
  const made = (input: Record<string, unknown>) => hookLines("my-harness", input);
  assert.deepEqual(made({ ...every("SessionStart"), source: "startup" }), one({ kind: "session-started", how: "startup" }), "no transcript on the line: version 1 reads none");
  assert.deepEqual(made({ ...every("UserPromptSubmit"), prompt: "add a sign-up form" }), one({ kind: "prompt-submitted" }), "without the prompt's words");
  assert.deepEqual(
    made({ ...every("PreToolUse"), tool_name: "mcp__storytree__check_setup", tool_input: {}, tool_use_id: "call-1" }),
    one({ kind: "tool-requested", tool: "check_setup", call: "call-1", agent: "orchestrator" }),
  );
  const bash = { tool_name: "Bash", tool_input: { command: "echo storytree-check" }, tool_use_id: "call-2" };
  assert.deepEqual(made({ ...every("PreToolUse"), ...bash }), one({ kind: "command-started", command: "echo storytree-check", call: "call-2" }));
  assert.deepEqual(made({ ...every("PostToolUse"), ...bash }), one({ kind: "command-run", command: "echo storytree-check", call: "call-2" }));
  assert.deepEqual(made({ ...every("PostToolUse"), tool_name: "Bash", tool_input: { command: "ls" } }), one({ kind: "command-run", command: "ls" }), "a call id is optional after a command");
  for (const tool of ["Edit", "Write"]) {
    assert.deepEqual(made({ ...every("PostToolUse"), tool_name: tool, tool_input: { file_path: `${FOLDER}/.storytree-check`, content: "x" } }), one({ kind: "file-edited", files: [`${FOLDER}/.storytree-check`] }), tool);
  }
  assert.deepEqual(made(every("Stop")), one({ kind: "turn-ended" }));
  assert.deepEqual(made({ ...every("SessionEnd"), reason: "exit" }), one({ kind: "session-ended", reason: "exit" }));

  // What storytree does not guess at: the harness's own tool names, and events outside the published six.
  for (const tool of ["Read", "MultiEdit", "apply_patch", "Shell", "NotebookEdit"]) {
    assert.equal(made({ ...every("PostToolUse"), tool_name: tool, tool_input: { file_path: "a.ts", command: "ls" } }), undefined, tool);
  }
  assert.equal(made({ ...every("PostToolUseFailure"), ...bash }), undefined, "not a published event");
  assert.equal(made({ ...every("PostToolUse"), tool_name: "Agent", tool_input: {}, tool_response: { agentId: "a1" } }), undefined, "subagents are not in version 1");
  assert.equal(made({ session_id: SESSION, hook_event_name: "Stop" }), undefined, "no folder, no line");
  assert.equal(made({ cwd: FOLDER, hook_event_name: "Stop" }), undefined, "no session, no line");

  // The name is the harness's own, recorded as given; a built-in name keeps its own parser, and a name that is no name records nothing.
  assert.equal(hookLines("Zed.ai_agent", every("Stop"))?.lines[0]?.harness, "Zed.ai_agent");
  assert.equal(hookLines("codex", { ...every("PostToolUse"), tool_name: "Edit", tool_input: { file_path: "a.ts" } }), undefined, "Codex's parser, not the published one");
  for (const name of ["", "-x", "has space", "statusline", "a/b", "x".repeat(65)]) assert.equal(hookLines(name, every("Stop")), undefined, JSON.stringify(name));
});

test("3.31 the edit gate reads a self-named harness's PreToolUse Edit or Write as the edit it is about to make, and refuses it in Claude Code's shape", () => {
  const before = (tool: string, toolInput: Record<string, unknown>) => ({ ...every("PreToolUse"), tool_name: tool, tool_input: toolInput, tool_use_id: "call-3" });
  assert.deepEqual(editIn("my-harness", before("Write", { file_path: "src/form.ts", content: "/** Capability 1 · Email form */" })), { session: SESSION, folder: FOLDER, files: [{ path: "src/form.ts", text: "/** Capability 1 · Email form */" }] });
  assert.deepEqual(editIn("my-harness", before("Edit", { file_path: "src/form.ts", content: "ignored: an Edit gives no whole text" })), { session: SESSION, folder: FOLDER, files: [{ path: "src/form.ts" }] });
  assert.equal(editIn("my-harness", before("Bash", { command: "rm src/form.ts" })), undefined, "a command is not gated");
  assert.equal(editIn("my-harness", before("StrReplace", { file_path: "src/form.ts" })), undefined, "a tool name storytree does not publish");
  assert.equal(editIn("my-harness", { ...before("Edit", { file_path: "src/form.ts" }), hook_event_name: "PostToolUse" }), undefined, "only before the edit");
  assert.equal(editIn("has space", before("Edit", { file_path: "src/form.ts" })), undefined, "not a harness name");

  const refusal = JSON.parse(refusalAnswer("my-harness", "another session holds capability 1")) as Record<string, unknown>;
  assert.equal(refusal.decision, "block");
  assert.equal(refusal.reason, "another session holds capability 1");
});
