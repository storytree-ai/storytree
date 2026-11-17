/**
 * Capability 3 · Hooks, contracts 3.50, 3.62 and 3.63: the guard storytree's red and green builder agents run before
 * each file edit, and storytree's own lanes run keyed on the editing agent. The red agent may edit only test files, the
 * green agent never one; by agent, only the test writer edits test code, and only test code. The hook answers the
 * harness's deny for the edit it must not make, and nothing otherwise.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { runHook, TEST_GUARD } from "./index.js";
import { isTestCode } from "./test-guard.js";

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
    assert.match(denied(await edit("green", path.join(folder, file))), new RegExp(path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `green may not edit ${file}`);
  }
  assert.equal(await edit("green", source), undefined);

  assert.equal(await runHook({ argv: ["claude-code", TEST_GUARD, "red"], input: "not json" }), undefined);
  assert.equal(await runHook({ argv: ["claude-code", TEST_GUARD, "red"], input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, tool_name: "Bash", tool_input: { command: "ls" } }) }), undefined);
});

test("3.62 a path is test code by its file's name or a folder named exactly test, tests, __tests__, testing or fixtures on it; every other path is code", () => {
  for (const file of ["src/cart.test.ts", "src/cart.spec.js", "shop/test_cart.py", "shop/cart_test.py", "pkg/cart_test.go", "conftest.py", "test/cart.py", "tests/cart.py", "src/__tests__/cart.ts", "packages/forest/testing/world.ts", "packages/session-management/src/hooks/fixtures/codex/stop.json", "packages\\app-setup\\testing\\setup.ts"]) {
    assert.equal(isTestCode(file), true, `${file} is test code`);
  }
  for (const file of ["packages/test-waits/src/waits.ts", "src/hooks/test-guard.ts", "testdata/cart.json", "src/my-fixtures/cart.ts", "shop/cart.py", "src/contest.py", "README.md"]) {
    assert.equal(isTestCode(file), false, `${file} is code`);
  }
  // Judged inside the session's folder, so a parent folder named "tests" counts for nothing.
  assert.equal(isTestCode(path.join(folder, "..", "..", "tests", "shop", "cart.py"), path.join(folder, "..", "..", "tests", "shop")), false);
  assert.equal(isTestCode(path.join(folder, "fixtures", "cart.json"), folder), true);
});

function byAgent(harness: "claude-code" | "codex", agent: string | undefined, files: readonly string[]): Promise<string | undefined> {
  const who = agent === undefined ? {} : { agent_id: "a1", agent_type: agent };
  const tool = harness === "codex"
    ? { tool_name: "apply_patch", tool_input: { command: ["*** Begin Patch", ...files.flatMap((file) => [`*** Update File: ${file}`, "@@", "-a", "+b"]), "*** End Patch"].join("\n") } }
    : { tool_name: "Edit", tool_input: { file_path: path.join(folder, files[0] ?? ""), old_string: "a", new_string: "b" } };
  return runHook({ argv: [harness, TEST_GUARD, "by-agent"], input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, ...who, ...tool }) });
}

function refused(answer: string | undefined): string {
  assert.ok(answer !== undefined, "expected a refusal, got none");
  const parsed = JSON.parse(answer) as { decision?: string; hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

test("3.63 with --test-guard by-agent only the test-writer agent edits test code, and it edits nothing else, on Claude Code and on Codex's apply_patch; the refusal names the path and whom to hand it to", async () => {
  for (const harness of ["claude-code", "codex"] as const) {
    // The test writer: test code goes through, code is refused and handed to the builder.
    assert.equal(await byAgent(harness, "test-writer", ["src/cart.test.ts"]), undefined, `${harness}: test writer edits a test`);
    assert.equal(await byAgent(harness, "test-writer", ["src/testing/fake-shop.ts"]), undefined, `${harness}: test writer edits test support`);
    const toBuilder = refused(await byAgent(harness, "test-writer", ["src/cart.ts"]));
    assert.match(toBuilder, /src[\\/]cart\.ts/);
    assert.match(toBuilder, /\bbuilder\b/);

    // The builder, any other agent and the session itself: code goes through, test code is refused and handed to the test writer.
    for (const agent of ["builder", "explorer", undefined]) {
      assert.equal(await byAgent(harness, agent, ["src/cart.ts"]), undefined, `${harness}: ${agent ?? "the session"} edits code`);
      const toWriter = refused(await byAgent(harness, agent, ["src/cart.test.ts"]));
      assert.match(toWriter, /src[\\/]cart\.test\.ts/);
      assert.match(toWriter, /test-writer/);
    }
  }
  // A Codex patch is judged by every path it names: one test file among code is refused to the builder.
  assert.match(refused(await byAgent("codex", "builder", ["src/cart.ts", "src/fixtures/cart.json"])), /src[\\/]fixtures[\\/]cart\.json/);
  assert.match(refused(await byAgent("codex", "test-writer", ["src/cart.test.ts", "src/cart.ts"])), /src[\\/]cart\.ts/);

  // A tool that edits no file, or an input it cannot read, is let through.
  assert.equal(await runHook({ argv: ["codex", TEST_GUARD, "by-agent"], input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, agent_type: "builder", tool_name: "Bash", tool_input: { command: "ls" } }) }), undefined);
  assert.equal(await runHook({ argv: ["claude-code", TEST_GUARD, "by-agent"], input: "not json" }), undefined);
});
