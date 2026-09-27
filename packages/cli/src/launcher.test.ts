/** The installed command: the agent link builds the full CLI beside its hook and setup scripts. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { buildBins } from "@storytree/agent-link/bins";
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
    const launcher = path.join(bin, process.platform === "win32" ? "storytree.cmd" : "storytree");
    assert.ok(existsSync(launcher), installed.stdout);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const run = (args: string[]) => execute(
      process.platform === "win32" ? "cmd.exe" : launcher,
      process.platform === "win32" ? ["/d", "/s", "/c", `""${launcher}" ${args.join(" ")}"`] : args,
      { cwd: world.folder, env: { ...inherited, ...env, STORYTREE_HOME: world.home }, windowsVerbatimArguments: true, timeout: 20_000 },
    );
    const memory = await (await world.library()).writeMemory({ text: "The installed command reaches the real library." });
    const read = await run(["library", "read", memory.id]);
    assert.ok(read.stdout.includes(memory.fields.text), read.stdout);
    const checked = await run(["doctor"]);
    assert.match(checked.stdout, /storytree is running/);
    assert.match(checked.stdout, /Hooks for Claude Code: registered/);
    // Use the bundled command to remove the wrapper. On Windows a running .cmd cannot remove
    // itself cleanly: cmd.exe tries to read it again (PR #83's first Windows run). That wrapper
    // is the agent link's; this contract proves its installed target is the full command line.
    const removed = await world.run(["setup", "remove"], env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /taken off the path/);
    assert.equal(existsSync(launcher), false);
  });
});
