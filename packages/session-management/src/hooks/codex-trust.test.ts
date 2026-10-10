/**
 * Capability 3 · Hooks: contract 3.18. Codex runs storytree's hooks only once the user trusts them,
 * which storytree cannot read; a Codex hook that runs is the proof, noted on this machine.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "../testing/folders.js";
import { codexHookTrust, runHook } from "./index.js";

test("3.18 Codex's hooks read as waiting once registered, as running once one of them has run, even outside a project, and as waiting again after a later registration", async () => {
  await withTempDir(async (dir) => {
    const homes = { storytreeHome: path.join(dir, ".storytree", "0.3"), codexHome: path.join(dir, ".codex") };
    mkdirSync(homes.codexHome, { recursive: true });
    assert.equal(codexHookTrust(homes), "not registered");
    // Registered as setup writes it (the app setup story's hooks-config.ts): storytree's hook script in Codex's hooks.json.
    writeFileSync(path.join(homes.codexHome, "hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node ${path.join(dir, "storytree-hook.mjs")} codex`, timeout: 10 }] }] } }));
    assert.equal(codexHookTrust(homes), "waiting", "registered, and no hook has run: the user has not trusted them yet");

    const recorded = JSON.parse(readFileSync(new URL("./fixtures/codex/session-start-startup.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const input = JSON.stringify({ ...recorded, cwd: dir });
    const saved = { STORYTREE_HOME: process.env.STORYTREE_HOME, CODEX_HOME: process.env.CODEX_HOME };
    Object.assign(process.env, { STORYTREE_HOME: homes.storytreeHome, CODEX_HOME: homes.codexHome });
    try {
      await runHook({ argv: ["claude-code"], input });
      assert.equal(codexHookTrust(homes), "waiting", "a Claude Code hook proves nothing about Codex");
      await runHook({ argv: ["codex"], input });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    assert.equal(codexHookTrust(homes), "running");

    const later = new Date(Date.now() + 60_000);
    utimesSync(path.join(homes.codexHome, "hooks.json"), later, later);
    assert.equal(codexHookTrust(homes), "waiting", "a registration written after the last hook ran is one Codex asks about again");
  });
});
