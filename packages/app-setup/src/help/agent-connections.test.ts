import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { noteCodexHookRan } from "@storytree/session-management";

import type { RunHarness } from "../connect/index.js";
import { registerHooks } from "../setup/index.js";
import { setupHelpActions } from "../index.js";

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

test("3.13 the guide's agents are the ones this computer runs, connected only when one is chosen, to the tools the installer recorded or else the app's own", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const user = path.join(dir, "user");
  const storytreeHome = path.join(user, ".storytree", "0.3");
  const node = process.platform === "win32" ? "node.exe" : "node";
  const tools = (folder: string) => {
    mkdirSync(folder, { recursive: true });
    for (const file of [node, "storytree-mcp.mjs"]) writeFileSync(path.join(folder, file), "");
    return folder;
  };
  const own = tools(path.join(dir, "app", "agent-tools"));
  // Claude Code runs here; no other agent does.
  const run: RunHarness = async (executable, args) => {
    if (executable === "claude" && args[0] === "--version") return "2.0.0";
    throw new Error("not installed");
  };
  const unused = async () => { throw new Error("not used here"); };
  const help = setupHelpActions({ licenseFile: "", storytreeHome, chooseFolder: unused, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); }, agentTools: own, connections: { home: user, env: {}, run } });
  const listed = async () => {
    const offered = await help.agentsToConnect();
    assert.ok(Array.isArray(offered), "an installed copy is offered its agents");
    return offered;
  };

  assert.deepEqual(await help.agentsToConnect(), [{ harness: "claude-code", agent: "Claude Code", connected: false }]);
  assert.equal(existsSync(path.join(user, ".claude.json")), false, "reading the agents connects nothing");
  const done = await help.connectAgent("claude-code");
  assert.deepEqual([done.agent, done.connected], ["Claude Code", true]);
  assert.match(done.next, /check_setup/);
  assert.equal(JSON.parse(readFileSync(path.join(user, ".claude.json"), "utf8")).mcpServers.storytree.command, path.join(own, node), "the app's own tools, with no delivery record");
  assert.deepEqual((await listed()).map((found) => found.connected), [true]);
  await assert.rejects(help.connectAgent("nobody"), /Choose an agent this computer runs/);
  assert.equal((await help.connectAgent("codex")).connected, false, "an agent not installed here is not connected");

  // The installer's record names its tools: those are the ones an agent is connected to.
  const recorded = tools(path.join(dir, "installed", "agent-tools"));
  mkdirSync(storytreeHome, { recursive: true });
  writeFileSync(path.join(storytreeHome, "delivery.json"), JSON.stringify({ schema: 1, installDir: path.join(dir, "installed"), tools: { node: path.join(recorded, node), mcp: path.join(recorded, "storytree-mcp.mjs") } }));
  assert.deepEqual((await listed()).map((found) => found.connected), [false], "Claude Code holds the app's tools, not the recorded ones");
});

test("3.13 a copy the installer did not deliver (no delivery record, no agent tools of its own) is told plainly that connecting is for installed copies, with no error", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-connect-dev-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const user = path.join(dir, "user");
  const unused = async () => { throw new Error("not used here"); };
  const help = setupHelpActions({ licenseFile: "", storytreeHome: path.join(user, ".storytree", "0.3"), chooseFolder: unused, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); }, agentTools: path.join(dir, "app", "agent-tools"), connections: { home: user, env: {}, run: unused } });

  const offered = await help.agentsToConnect();
  assert.ok(!Array.isArray(offered), "no list of agents to connect to tools that are not there");
  assert.match(offered.notInstalled, /installed cop/);
  assert.match(offered.notInstalled, /dev-home/);
});
