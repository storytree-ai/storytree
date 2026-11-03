/**
 * Capability 8 · Setup check, contract 8.38: registering Claude Code's hooks writes storytree's red and green builder
 * agents into Claude Code's user-level agents folder, each fenced by the test guard (Hooks 3.50) its frontmatter runs
 * with this build's Node and hook script; removing storytree takes them out, and a file of the user's own is never touched.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { registerHooks, removeHooks, type HookCommand } from "./index.js";

const HOOK: HookCommand = { node: path.resolve("/opt/storytree/node"), script: path.resolve("/opt/storytree/build-1/storytree-hook.mjs") };

/** The command line an agent file's frontmatter hook runs, read back from its YAML single-quoted scalar. */
function guardCommand(file: string): string {
  const match = /^\s+command: '((?:[^']|'')*)'$/m.exec(readFileSync(file, "utf8"));
  assert.ok(match, `no hook command in ${file}`);
  return match[1]!.replaceAll("''", "'");
}

test("8.38 registering Claude Code's hooks writes storytree-red and storytree-green, each running this build's test guard before an edit; another build rewrites them, a look or a disconnected Claude Code writes none, a user's own file of that name is kept, and removing storytree deletes only its own", async () => {
  await withTempDir(async (dir) => {
    const claude = path.join(dir, ".claude");
    mkdirSync(claude);
    const homes = { claude };
    const red = path.join(claude, "agents", "storytree-red.md");
    const green = path.join(claude, "agents", "storytree-green.md");

    registerHooks(homes, HOOK, new Set(), undefined, true);
    assert.ok(!existsSync(red), "a look writes nothing");
    registerHooks(homes, HOOK, new Set(["claude-code"]));
    assert.ok(!existsSync(red), "a disconnected Claude Code gets no agents");

    registerHooks(homes, HOOK);
    for (const [file, mode] of [[red, "red"], [green, "green"]] as const) {
      const text = readFileSync(file, "utf8");
      assert.match(text, new RegExp(`^---\\nname: storytree-${mode}\\n`), `${mode} names itself`);
      assert.match(text, /matcher: "Edit\|Write\|MultiEdit\|NotebookEdit"/);
      const command = guardCommand(file);
      assert.ok(command.includes(HOOK.node) && command.includes(HOOK.script), command);
      assert.ok(command.endsWith(`claude-code --test-guard ${mode}`), command);
    }

    const next: HookCommand = { node: HOOK.node, script: path.resolve("/opt/storytree/build-2/storytree-hook.mjs") };
    registerHooks(homes, next);
    assert.ok(guardCommand(red).includes(next.script), "another build's registration rewrites the agent");

    writeFileSync(green, "---\nname: storytree-green\ndescription: mine\n---\nThe user's own.\n");
    registerHooks(homes, next);
    assert.equal(readFileSync(green, "utf8"), "---\nname: storytree-green\ndescription: mine\n---\nThe user's own.\n", "a user's own file is kept");

    removeHooks(homes);
    assert.ok(!existsSync(red), "removing storytree deletes its agent");
    assert.ok(existsSync(green), "and leaves the user's own");

    registerHooks(homes, HOOK);
    removeHooks(homes, { harness: "claude-code", hook: HOOK });
    assert.ok(!existsSync(red), "removing this build's Claude Code hooks deletes its agent too");
  });
});

test("8.38 the green builder agent runs the project's whole test command itself and lists no storytree tool, since base storytree serves no test runner", async () => {
  await withTempDir(async (dir) => {
    const claude = path.join(dir, ".claude");
    mkdirSync(claude);
    registerHooks({ claude }, HOOK);
    const text = readFileSync(path.join(claude, "agents", "storytree-green.md"), "utf8");
    const tools = /^tools: (.*)$/m.exec(text)?.[1]?.split(", ") ?? [];
    assert.ok(!tools.some((tool) => tool.startsWith("mcp__storytree__")), `green's tools: ${tools.join(", ")}`);
    assert.ok(tools.includes("Edit"), "it keeps its building tools");
    const workflow = text.slice(text.indexOf("Workflow:"));
    assert.match(workflow, /the project's whole test command, exactly as the project gives it/, "its workflow runs the whole suite");
    assert.doesNotMatch(workflow, /run_tests/, "its workflow names no test-running tool");
  });
});

test("8.38 both builder agents carry the shell Claude Code gives them, Bash or, on Windows, PowerShell, so each can run the project's tests", async () => {
  await withTempDir(async (dir) => {
    const claude = path.join(dir, ".claude");
    mkdirSync(claude);
    registerHooks({ claude }, HOOK);
    for (const mode of ["red", "green"]) {
      const text = readFileSync(path.join(claude, "agents", `storytree-${mode}.md`), "utf8");
      const tools = /^tools: (.*)$/m.exec(text)?.[1]?.split(", ") ?? [];
      assert.ok(tools.includes("Bash") && tools.includes("PowerShell"), `${mode}'s tools: ${tools.join(", ")}`);
    }
  });
});
