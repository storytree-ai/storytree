// Capability 3 · Hooks
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import * as hookStart from "./at-once.js";

type UnloadedRefusal = (argv: readonly string[], input: string, error: unknown) => string | undefined;

const folder = path.resolve("/work/tests-of-mine/shop");

const missingLibrary = Object.assign(new Error("Cannot find module '/x/packages/library/src/index.ts' imported from /x/packages/plugin-loader/src/factory/factory.ts"), { code: "ERR_MODULE_NOT_FOUND" });
const missingExport = new SyntaxError("The requested module '@storytree/project-and-caller' does not provide an export named 'readPartsOff'");

function unloadedRefusal(): UnloadedRefusal {
  const found = (hookStart as Record<string, unknown>).unloadedRefusal;
  assert.equal(typeof found, "function", "@storytree/session-management/hook-start exports unloadedRefusal");
  return found as UnloadedRefusal;
}

function call(harness: "claude-code" | "codex", tool: string, toolInput: Record<string, unknown>, agent?: string): string {
  const who = agent === undefined ? {} : { agent_id: "a1", agent_type: agent };
  return JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: folder, ...who, tool_name: tool, tool_input: toolInput });
}

const claudeEdits: readonly [string, Record<string, unknown>][] = [
  ["Edit", { file_path: path.join(folder, "src", "cart.ts"), old_string: "a", new_string: "b" }],
  ["Write", { file_path: path.join(folder, "src", "cart.test.ts"), content: "x" }],
  ["MultiEdit", { file_path: path.join(folder, "src", "cart.ts"), edits: [{ old_string: "a", new_string: "b" }] }],
  ["NotebookEdit", { notebook_path: path.join(folder, "notes.ipynb"), new_source: "x" }],
];

const patch = { command: ["*** Begin Patch", "*** Update File: src/cart.ts", "@@", "-a", "+b", "*** End Patch"].join("\n") };

function refusedFor(reason: string | undefined, error: Error, what: string): void {
  assert.ok(reason !== undefined, `${what}: expected a refusal, got none`);
  assert.ok(reason.includes(error.message), `${what}: the reason names the failed import: ${reason}`);
  assert.match(reason, /test guard/i, what);
  assert.match(reason, /could not load/i, what);
}

test("3.66 with --test-guard and an import that failed, an edit (Claude Code's Edit, Write, MultiEdit or NotebookEdit, Codex's apply_patch, or a test-writer's Bash) is refused with a reason naming the failed import and that the test guard could not load", () => {
  const refuse = unloadedRefusal();
  for (const error of [missingLibrary, missingExport]) {
    for (const mode of ["by-agent", "red", "green"]) {
      for (const [tool, toolInput] of claudeEdits) {
        for (const agent of [undefined, "builder", "test-writer"]) {
          refusedFor(refuse(["claude-code", "--test-guard", mode], call("claude-code", tool, toolInput, agent), error), error, `claude-code ${mode} ${tool} by ${agent ?? "the session"}`);
        }
      }
      for (const agent of [undefined, "builder", "test-writer"]) {
        refusedFor(refuse(["codex", "--test-guard", mode], call("codex", "apply_patch", patch, agent), error), error, `codex ${mode} apply_patch by ${agent ?? "the session"}`);
      }
      for (const harness of ["claude-code", "codex"] as const) {
        refusedFor(refuse([harness, "--test-guard", mode], call(harness, "Bash", { command: "ls" }, "test-writer"), error), error, `${harness} ${mode} test-writer Bash`);
      }
    }
  }
});

test("3.66 an unloaded hook refuses nothing without --test-guard, nor a Read, nor another agent's or the session's Bash, nor an unreadable input", () => {
  const refuse = unloadedRefusal();
  const edit = call("claude-code", "Edit", { file_path: path.join(folder, "src", "cart.ts"), old_string: "a", new_string: "b" }, "builder");
  assert.equal(refuse(["claude-code"], edit, missingLibrary), undefined, "no flag");
  assert.equal(refuse(["claude-code", "--after-tool"], edit, missingLibrary), undefined, "another flag");
  assert.equal(refuse(["codex"], call("codex", "apply_patch", patch, "builder"), missingLibrary), undefined, "codex, no flag");
  assert.equal(refuse(["claude-code", "--background"], call("claude-code", "Bash", { command: "ls" }, "test-writer"), missingLibrary), undefined, "test-writer Bash, no flag");

  for (const harness of ["claude-code", "codex"] as const) {
    const argv = [harness, "--test-guard", "by-agent"];
    assert.equal(refuse(argv, call(harness, "Read", { file_path: path.join(folder, "src", "cart.ts") }, "test-writer"), missingLibrary), undefined, `${harness}: Read`);
    assert.equal(refuse(argv, call(harness, "Grep", { pattern: "cart" }), missingLibrary), undefined, `${harness}: Grep`);
    for (const agent of [undefined, "builder", "explorer"]) {
      assert.equal(refuse(argv, call(harness, "Bash", { command: "echo x > src/cart.ts" }, agent), missingLibrary), undefined, `${harness}: Bash by ${agent ?? "the session"}`);
    }
    assert.equal(refuse(argv, "not json", missingLibrary), undefined, `${harness}: unreadable input`);
    assert.equal(refuse(argv, "", missingLibrary), undefined, `${harness}: empty input`);
  }
});

function hookExit(argv: readonly string[], input: string): { status: number | null; stderr: string } {
  const script = `const { refuseUnloaded } = await import(${JSON.stringify(new URL("./at-once.ts", import.meta.url).href)}); await refuseUnloaded(Object.assign(new Error(${JSON.stringify(missingLibrary.message)}), { code: "ERR_MODULE_NOT_FOUND" }));`;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, "storytree-hook.ts", ...argv], { cwd: path.dirname(fileURLToPath(import.meta.url)), input, encoding: "utf8", timeout: 60_000 });
  return { status: run.status, stderr: run.stderr };
}

test("3.66 a hook process that cannot load exits 2 with the reason on stderr for an edit under --test-guard, and exits 1 on the failed import for a Read or without the flag", () => {
  const edit = call("claude-code", "Edit", { file_path: path.join(folder, "src", "cart.ts"), old_string: "a", new_string: "b" }, "builder");
  const refused = hookExit(["claude-code", "--test-guard", "by-agent"], edit);
  assert.equal(refused.status, 2, refused.stderr);
  assert.ok(refused.stderr.includes(missingLibrary.message), refused.stderr);
  assert.match(refused.stderr, /test guard could not load/i);

  const codex = hookExit(["codex", "--test-guard", "by-agent"], call("codex", "apply_patch", patch, "builder"));
  assert.equal(codex.status, 2, codex.stderr);
  assert.ok(codex.stderr.includes(missingLibrary.message), codex.stderr);

  for (const [what, argv, input] of [
    ["a Read", ["claude-code", "--test-guard", "by-agent"], call("claude-code", "Read", { file_path: path.join(folder, "src", "cart.ts") }, "builder")],
    ["no flag", ["claude-code"], edit],
  ] as const) {
    const through = hookExit(argv, input);
    assert.equal(through.status, 1, `${what}: ${through.stderr}`);
    assert.ok(through.stderr.includes(missingLibrary.message), `${what}: the failed import is rethrown: ${through.stderr}`);
    assert.doesNotMatch(through.stderr, /test guard could not load/i, what);
  }
});
