/**
 * Capability 8 · Setup check: contract 8.25. Codex keeps a tool server's instructions and tools out
 * of the agent's first view (it finds them by searching), so a fresh Codex session never reads the
 * habits card; what it does read is the AGENTS.md in its home. Measured on the owner's Windows laptop
 * (packages/app-setup/evidence/codex-first-session): without this section 0 of 3 first sessions
 * called check_setup; with it, 3 of 3 did before their first change.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "../testing/folders.js";
import { removeCodexInstructions, writeCodexInstructions } from "./index.js";

test("8.25 Codex's AGENTS.md gets one storytree section telling the agent to call check_setup first in a storytree project; again changes nothing, the user's own text is kept, and removing takes out exactly that section", async () => {
  await withTempDir(async (codexHome) => {
    const file = path.join(codexHome, "AGENTS.md");
    assert.equal(writeCodexInstructions(codexHome), "written");
    const section = readFileSync(file, "utf8");
    assert.match(section, /\.storytree\.json/, "it names how a storytree project is recognised");
    assert.match(section, /`check_setup`/, "and the check to run first");
    assert.match(section, /any other folder, ignore storytree/i, "and keeps sessions elsewhere silent (ADR-0752 D3)");
    assert.equal(writeCodexInstructions(codexHome), "already written");
    assert.equal(readFileSync(file, "utf8"), section, "not a byte changed");
    assert.equal(removeCodexInstructions(codexHome), "removed");
    assert.equal(existsSync(file), false, "a file that held only storytree's section goes with it");
    assert.equal(removeCodexInstructions(codexHome), "none");

    const own = "# My rules\n\nAlways answer in French.\n";
    writeFileSync(file, own);
    writeCodexInstructions(codexHome);
    const both = readFileSync(file, "utf8");
    assert.ok(both.startsWith(own), "the user's own text stays first, as it was");
    assert.match(both, /`check_setup`/);
    // An older wording is replaced, not doubled.
    writeFileSync(file, both.replace("check_setup", "check_setup_old"));
    assert.equal(writeCodexInstructions(codexHome), "written");
    assert.equal(readFileSync(file, "utf8"), both);
    removeCodexInstructions(codexHome);
    assert.equal(readFileSync(file, "utf8"), own, "removing leaves the user's text exactly as it was");
  });
});

test("8.25 no Codex home here: nothing is written", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "no-codex");
    assert.equal(writeCodexInstructions(missing), "not here");
    assert.equal(existsSync(missing), false);
  });
});
