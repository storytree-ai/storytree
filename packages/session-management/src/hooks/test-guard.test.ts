/**
 * Capability 3 · Hooks, contract 3.50: the guard storytree's red and green builder agents run before each file edit.
 * The red agent may edit only test files, the green agent never one; the hook answers Claude Code's deny for the
 * edit it must not make, and nothing otherwise.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { runHook, TEST_GUARD } from "./index.js";

const folder = path.resolve("/work/tests-of-mine/shop");

function edit(mode: "red" | "green", file: string, tool = "Edit"): Promise<string | undefined> {
  const toolInput = tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file, old_string: "a", new_string: "b" };
  return runHook({ argv: ["claude-code", TEST_GUARD, mode], input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, tool_name: tool, tool_input: toolInput }) });
}

function denied(answer: string | undefined): string {
  assert.ok(answer !== undefined, "expected a refusal, got none");
  const parsed = JSON.parse(answer) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

test("3.50 with --test-guard red a Claude Code edit of a source file is refused, naming it, and an edit of a test file goes through; with --test-guard green the reverse; an unreadable input is let through", async () => {
  const source = path.join(folder, "shop", "cart.py");
  assert.match(denied(await edit("red", source)), /cart\.py/);
  assert.match(denied(await edit("red", path.join(folder, "src", "cart.ts"), "Write")), /cart\.ts/);
  assert.match(denied(await edit("red", path.join(folder, "notes.ipynb"), "NotebookEdit")), /notes\.ipynb/);

  // Test files, judged by the path inside the session's folder: the folder's own "tests-of-mine" parent counts for nothing.
  for (const file of ["tests/test_cart.py", "test/cart.py", "shop/test_cart.py", "shop/cart_test.py", "conftest.py", "pkg/cart_test.go", "src/cart.test.ts", "src/cart.spec.js", "src/__tests__/cart.ts"]) {
    assert.equal(await edit("red", path.join(folder, file)), undefined, `red may edit ${file}`);
    assert.match(denied(await edit("green", path.join(folder, file))), new RegExp(path.basename(file).replace(".", "\\.")), `green may not edit ${file}`);
  }
  assert.equal(await edit("green", source), undefined);

  assert.equal(await runHook({ argv: ["claude-code", TEST_GUARD, "red"], input: "not json" }), undefined);
  assert.equal(await runHook({ argv: ["claude-code", TEST_GUARD, "red"], input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, tool_name: "Bash", tool_input: { command: "ls" } }) }), undefined);
});
