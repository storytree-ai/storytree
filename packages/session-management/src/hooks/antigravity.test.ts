/**
 * Capability 3 · Hooks: Antigravity CLI (contract 3.33).
 *
 * Each input is in the shape the hook documentation shipped inside Antigravity CLI 1.3.3 gives (its
 * builtin agy-customizations skill, docs/hooks.md): camelCase, the same common fields on every event,
 * and no field naming the event, which storytree's registration passes as `--event=<name>`. Not recorded
 * from a live session: agy runs no prompt without a Google sign-in (Mint box, 2026-10-12).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { editIn, refusalAnswer } from "./edit-gate.js";
import { hookLines, runHook } from "./hooks.js";

const SESSION = "ec33ebf9-0cba-4100-8142-c61503f6c587";
const FOLDER = path.resolve("/work/site");
const TRANSCRIPT = `/home/dev/.gemini/antigravity-cli/brain/${SESSION}/.system_generated/logs/transcript.jsonl`;

/** The common fields Antigravity sends with every event, and the event storytree's registration names. */
const sent = (event: string, fields: Record<string, unknown> = {}) => ({
  ...fields, hook_event_name: event, conversationId: SESSION, workspacePaths: [FOLDER], transcriptPath: TRANSCRIPT,
  artifactDirectoryPath: `/home/dev/.gemini/antigravity-cli/brain/${SESSION}`, modelName: "auto",
});

const common = { session: SESSION, harness: "antigravity", source: "hook", folder: FOLDER, transcript: TRANSCRIPT };
const one = (line: Record<string, unknown>) => ({ folder: FOLDER, lines: [{ ...common, ...line }] });
const made = (event: string, fields: Record<string, unknown> = {}) => hookLines("antigravity", sent(event, fields));

test("3.33 Antigravity's hook inputs make the session's lines under the harness antigravity: a storytree tool call, a command started and run, a file written or edited, and a turn's end; it has no start or end of its own", () => {
  assert.deepEqual(made("PreToolUse", { toolCall: { name: "mcp_tool", args: { ServerName: "storytree", ToolName: "check_setup" } }, stepIdx: 4 }), one({ kind: "tool-requested", tool: "check_setup", call: `${SESSION}:4`, agent: "orchestrator" }));
  assert.deepEqual(made("PreToolUse", { toolCall: { name: "mcp_storytree_show_plan", args: {} }, stepIdx: 5 }), one({ kind: "tool-requested", tool: "show_plan", call: `${SESSION}:5`, agent: "orchestrator" }));
  assert.equal(made("PreToolUse", { toolCall: { name: "mcp_tool", args: { ServerName: "github", ToolName: "open" } }, stepIdx: 6 }), undefined, "another server's tool is not storytree's");

  const command = { toolCall: { name: "run_command", args: { CommandLine: "echo storytree-check", Cwd: FOLDER } }, stepIdx: 7 };
  assert.deepEqual(made("PreToolUse", command), one({ kind: "command-started", command: "echo storytree-check", call: `${SESSION}:7` }));
  assert.deepEqual(made("PostToolUse", { ...command, error: "exit status 1" }), one({ kind: "command-run", command: "echo storytree-check", call: `${SESSION}:7` }), "a command that failed still ran");

  const written = path.join(FOLDER, ".storytree-check");
  assert.deepEqual(made("PostToolUse", { toolCall: { name: "write_to_file", args: { TargetFile: written, CodeContent: "x" } }, stepIdx: 8 }), one({ kind: "file-edited", files: [written] }));
  assert.deepEqual(made("PostToolUse", { toolCall: { name: "replace_file_content", args: { TargetFile: "src/a.ts", ReplacementChunks: [] } }, stepIdx: 9 }), one({ kind: "file-edited", files: [path.join(FOLDER, "src/a.ts")] }), "a path relative to the workspace");
  assert.equal(made("PostToolUse", { toolCall: { name: "write_to_file", args: { TargetFile: written } }, stepIdx: 10, error: "denied" }), undefined, "a write that failed or was refused edited nothing");
  assert.equal(made("PostToolUse", { stepIdx: 11 }), undefined, "a tool step that names no tool call makes no line");

  assert.deepEqual(made("Stop", { executionNum: 1, terminationReason: "model_stop", fullyIdle: true }), one({ kind: "turn-ended" }));
  assert.equal(made("PreInvocation", { invocationNum: 1, initialNumSteps: 0 }), undefined, "a model call is not a line");
  assert.equal(hookLines("antigravity", { hook_event_name: "Stop", workspacePaths: [FOLDER] }), undefined, "an input naming no conversation makes none");
});

test("3.33 in Antigravity the hook answers in Antigravity's own shape: the edit gate's refusal as a denied tool call, and JSON even when it has nothing to say", async () => {
  const write = sent("PreToolUse", { toolCall: { name: "write_to_file", args: { TargetFile: "src/new.ts", CodeContent: "// Capability 3 · Hooks" } }, stepIdx: 3 });
  assert.deepEqual(editIn("antigravity", write), { session: SESSION, folder: FOLDER, files: [{ path: path.join(FOLDER, "src/new.ts"), text: "// Capability 3 · Hooks" }] });
  const edit = sent("PreToolUse", { toolCall: { name: "multi_replace_file_content", args: { TargetFile: path.join(FOLDER, "src/old.ts") } }, stepIdx: 4 });
  assert.deepEqual(editIn("antigravity", edit), { session: SESSION, folder: FOLDER, files: [{ path: path.join(FOLDER, "src/old.ts") }] });
  assert.equal(editIn("antigravity", sent("PreToolUse", { toolCall: { name: "run_command", args: { CommandLine: "ls" } }, stepIdx: 5 })), undefined);

  assert.deepEqual(JSON.parse(refusalAnswer("antigravity", "held by another session")), { decision: "deny", reason: "held by another session" });
  // Outside any storytree project the hook writes nothing, and still answers in JSON.
  const outside = JSON.stringify({ ...sent("Stop"), hook_event_name: undefined, workspacePaths: [path.resolve("/nowhere/at/all")] });
  assert.equal(await runHook({ argv: ["antigravity", "--event=Stop"], input: outside, locate: { home: path.resolve("/nowhere/home") } }), "{}");
});
