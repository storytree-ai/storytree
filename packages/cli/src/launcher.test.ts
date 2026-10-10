/** The installed command: the agent link builds the full CLI beside its hook and setup scripts. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { buildBins } from "@storytree/app-setup/bins";
import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
const execute = promisify(execFile);
before(() => command.build(async (dir) => (await buildBins(dir)).storytree!));
after(() => command.remove());

test("8.5 setup installs the full command beside its hooks; the launcher reads the library and runs doctor", async () => {
  await inWorld(command, async (world) => {
    const profile = path.join(path.dirname(world.folder), "user with spaces");
    const bin = path.join(profile, "bin");
    const claude = path.join(profile, ".claude");
    const codex = path.join(profile, ".codex");
    for (const folder of [bin, claude, codex]) mkdirSync(folder, { recursive: true });
    const env = {
      HOME: profile,
      USERPROFILE: profile,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: codex,
      PATH: [bin, process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter),
    };
    const installed = await world.run(["setup", "install"], env);
    assert.equal(installed.code, 0, installed.stderr);
    // On Windows the launcher is a program of its own (ADR-0854), started like any other.
    const launcher = path.join(bin, process.platform === "win32" ? "storytree.exe" : "storytree");
    assert.ok(existsSync(launcher), installed.stdout);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const run = (args: string[]) => execute(launcher, args, { cwd: world.folder, env: { ...inherited, ...env, STORYTREE_HOME: world.home }, timeout: 20_000 });
    const definition = await (await world.library()).defineTerm({ term: "Installed command", meaning: "The installed command reaches the real library." });
    const read = await run(["library", "read", definition.id]);
    assert.ok(read.stdout.includes(definition.fields.meaning), read.stdout);
    const checked = await run(["doctor"]);
    assert.match(checked.stdout, /storytree is running/);
    assert.match(checked.stdout, /Hooks for Claude Code: registered/);
    // Use the bundled command to remove the launcher: removing it through itself, which Windows
    // will not delete while it runs, is the agent link's own contract (8.9). This contract proves
    // its installed target is the full command line.
    const removed = await world.run(["setup", "remove"], env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /taken off the path/);
    assert.equal(existsSync(launcher), false);
  });
});
