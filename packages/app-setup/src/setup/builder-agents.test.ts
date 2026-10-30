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
