/**
 * Capability 3 · Hooks: Cursor (contracts 3.27 to 3.29).
 *
 * These inputs are NOT recordings. No live Cursor session could be run when this was built (the
 * laptop's Cursor sign-in had lapsed, 2026-10-12), so each is the shape the hook code of the installed
 * Cursor command line (2026.07.09) builds: its field names, with made-up values. A recording from a
 * real session replaces them when one can be made.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { editIn, refusalAnswer } from "./edit-gate.js";
import { hookLines, promptAnswer } from "./hooks.js";

const SESSION = "5f0c6c1e-3a52-4d0e-9a6f-2f6a1c0d9b11";
const FOLDER = "C:\\Users\\dev\\projects\\site";
const TRANSCRIPT = "C:\\Users\\dev\\.cursor\\projects\\C-Users-dev-projects-site\\agent-transcripts\\" + SESSION + "\\" + SESSION + ".jsonl";

/** What Cursor puts on every hook's input. */
const every = (event: string) => ({
  session_id: SESSION,
  conversation_id: SESSION,
  generation_id: "gen-1",
  hook_event_name: event,
  cursor_version: "3.10.20",
  workspace_roots: [FOLDER],
  user_email: "dev@example.com",
  transcript_path: TRANSCRIPT,
});

const common = { session: SESSION, harness: "cursor", source: "hook", folder: FOLDER, transcript: TRANSCRIPT };

test("3.27 Cursor's hook inputs make the session's lines under the harness cursor: a start, a prompt, a storytree tool call, a command started and finished, a file edit, a subagent, a turn's end and an end, in the workspace folder where the input names no working folder", () => {
  const made = (input: Record<string, unknown>) => hookLines("cursor", input);
  const one = (line: Record<string, unknown>) => ({ folder: FOLDER, lines: [{ ...common, ...line }] });

  assert.deepEqual(made({ ...every("sessionStart"), is_background_agent: false, composer_mode: "agent" }), one({ kind: "session-started" }));
  assert.deepEqual(made({ ...every("beforeSubmitPrompt"), prompt: "add a sign-up form", attachments: [] }), one({ kind: "prompt-submitted" }), "without the prompt's words");
  assert.deepEqual(
    made({ ...every("beforeMCPExecution"), mcp_server_name: "storytree", tool_name: "MCP:check_setup", tool_input: "{}", tool_use_id: "call-1", command: "node" }),
    one({ kind: "tool-requested", tool: "check_setup", call: "call-1", agent: "orchestrator" }),
  );
  assert.equal(made({ ...every("beforeMCPExecution"), mcp_server_name: "github", tool_name: "MCP:open", tool_input: "{}", tool_use_id: "call-2" }), undefined, "another server's tool is not storytree's");
  assert.deepEqual(
    made({ ...every("beforeMCPExecution"), mcp_server_name: "storytree", tool_name: "show_plan", tool_input: "{}" }),
    one({ kind: "tool-requested", tool: "show_plan", call: "gen-1:show_plan", agent: "orchestrator" }),
    "a call Cursor gives no id is named by its turn and tool",
  );
  const shell = { tool_name: "Shell", tool_input: { command: "echo storytree-check", cwd: FOLDER }, tool_use_id: "call-3", cwd: FOLDER };
  assert.deepEqual(made({ ...every("preToolUse"), ...shell }), one({ kind: "command-started", command: "echo storytree-check", call: "call-3" }));
  assert.deepEqual(made({ ...every("postToolUse"), ...shell, tool_output: "{}", duration: 12 }), one({ kind: "command-run", command: "echo storytree-check", call: "call-3" }));
  assert.deepEqual(made({ ...every("postToolUseFailure"), ...shell, error_message: "exit 1", failure_type: "error" }), one({ kind: "command-run", command: "echo storytree-check", call: "call-3" }));
  assert.equal(made({ ...every("postToolUse"), tool_name: "Read", tool_input: { path: "a.ts" }, tool_use_id: "call-4", cwd: FOLDER }), undefined, "a tool the log does not record");
  assert.deepEqual(made({ ...every("afterFileEdit"), file_path: `${FOLDER}\\.storytree-check`, edits: [{ old_string: "", new_string: "x" }] }), one({ kind: "file-edited", files: [`${FOLDER}\\.storytree-check`] }));
  assert.deepEqual(
    made({ ...every("subagentStart"), subagent_id: "sub-1", subagent_type: "explore", task: "find the form", parent_conversation_id: SESSION }),
    one({ kind: "subagent-started", subagent: "sub-1", type: "explore", task: "find the form" }),
  );
  assert.deepEqual(made({ ...every("stop"), status: "completed", loop_count: 0 }), one({ kind: "turn-ended" }));
  assert.deepEqual(made({ ...every("sessionEnd"), reason: "user_close", duration_ms: 5 }), one({ kind: "session-ended", reason: "user_close" }));

  // A session id alone, a root written as a file URI's path, and no transcript yet (Cursor sends null until the file exists).
  const { session_id: _none, ...unnamed } = every("stop");
  assert.deepEqual(hookLines("cursor", { ...unnamed, workspace_roots: ["/c:/Users/dev/projects/site"], transcript_path: null }), {
    folder: "c:/Users/dev/projects/site",
    lines: [{ session: SESSION, harness: "cursor", source: "hook", folder: "c:/Users/dev/projects/site", kind: "turn-ended" }],
  });
  assert.equal(hookLines("cursor", { ...every("stop"), workspace_roots: [] }), undefined, "no folder, no line");
  assert.equal(hookLines("cursor", { session_id: SESSION, cwd: FOLDER, hook_event_name: "Stop" }), undefined, "Claude Code's event names are not Cursor's");
});

test("3.28 a Claude Code hook that Cursor runs writes nothing and answers nothing: a Cursor session is never recorded as Claude Code", () => {
  // As Claude Code sends it, but from Cursor, which names its version on every input.
  const fromCursor = { session_id: SESSION, cwd: FOLDER, cursor_version: "3.10.20", workspace_roots: [FOLDER] };
  assert.notEqual(hookLines("claude-code", { session_id: SESSION, cwd: FOLDER, hook_event_name: "SessionStart", source: "startup" }), undefined, "Claude Code's own start is recorded");
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"]) assert.equal(hookLines("claude-code", { ...fromCursor, hook_event_name: event }), undefined, event);
  assert.equal(hookLines("claude-code", { ...fromCursor, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "a.ts" } }), undefined);
  const edit = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "a.ts", content: "x" } };
  assert.notEqual(editIn("claude-code", { session_id: SESSION, cwd: FOLDER, ...edit }), undefined, "Claude Code's own edit is gated");
  assert.equal(editIn("claude-code", { ...fromCursor, ...edit }), undefined, "the gate leaves Cursor's edit to Cursor's own entry");
  assert.equal(promptAnswer("claude-code", ["a definition"], fromCursor), undefined);
});

test("3.29 in Cursor the hook answers in Cursor's own shape: the edit gate's refusal as a denied permission with the reason for the agent, and a prompt's definitions as added context that lets the prompt continue", () => {
  const before = (tool: string, toolInput: unknown) => ({ ...every("preToolUse"), tool_name: tool, tool_input: toolInput, tool_use_id: "call-5", cwd: FOLDER });
  // The command line's Write names `file_path` and `content`; the editor's transcripts name `path` and `contents`.
  assert.deepEqual(editIn("cursor", before("Write", { file_path: "src/form.ts", content: "/** Capability 1 · Email form */" })), { session: SESSION, folder: FOLDER, files: [{ path: "src/form.ts", text: "/** Capability 1 · Email form */" }] });
  assert.deepEqual(editIn("cursor", before("Write", { path: "src/form.ts", contents: "x" }))?.files, [{ path: "src/form.ts", text: "x" }]);
  assert.deepEqual(editIn("cursor", before("StrReplace", { path: "src/form.ts", old_string: "1", new_string: "2" }))?.files, [{ path: "src/form.ts" }]);
  assert.deepEqual(editIn("cursor", before("Delete", { path: "src/form.ts" }))?.files, [{ path: "src/form.ts" }]);
  assert.deepEqual(editIn("cursor", before("ApplyPatch", "*** Begin Patch\n*** Update File: src/form.ts\n*** End Patch\n"))?.files, [{ path: "src/form.ts" }]);
  assert.equal(editIn("cursor", before("Shell", { command: "ls" })), undefined, "not a file edit");

  assert.deepEqual(JSON.parse(refusalAnswer("cursor", "another session holds it")), { permission: "deny", user_message: "another session holds it", agent_message: "another session holds it" });
  assert.equal((JSON.parse(refusalAnswer("claude-code", "held")) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision, "deny", "Claude Code's shape is unchanged");
  assert.deepEqual(JSON.parse(promptAnswer("cursor", ["Front cover: a decision", "Arc: a goal"], every("beforeSubmitPrompt")) ?? "null"), { continue: true, additional_context: "Front cover: a decision\n\nArc: a goal" });
  assert.equal(promptAnswer("cursor", undefined, every("beforeSubmitPrompt")), undefined, "nothing to add, nothing said");
});
