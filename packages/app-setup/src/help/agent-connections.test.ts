import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { noteCodexHookRan, registerHooks } from "@storytree/agent-link";
import { setupHelpActions } from "./actions.js";

test("3.5 the first-run guide says Codex waits for the user to trust storytree's hooks, with the one step, until one has run, then that they run; with no Codex hooks it says nothing of Codex", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-agents-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storytreeHome = path.join(dir, ".storytree", "0.3");
  const codexHome = path.join(dir, ".codex");
  mkdirSync(codexHome, { recursive: true });
  const unused = async () => { throw new Error("not used here"); };
  const help = setupHelpActions({ licenseFile: "", storytreeHome, codexHome, chooseFolder: unused, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); } });

  assert.deepEqual(await help.agentConnections(), []);
  registerHooks({ codex: codexHome }, { node: process.execPath, script: path.join(dir, "storytree-hook.mjs") });
  const [waiting] = await help.agentConnections();
  assert.equal(waiting?.agent, "Codex");
  assert.equal(waiting?.state, "waiting");
  assert.match(waiting?.step ?? "", /type \/hooks/);
  noteCodexHookRan({ storytreeHome, codexHome });
  const [running] = await help.agentConnections();
  assert.equal(running?.state, "running");
  assert.equal(running?.step, undefined);
});
