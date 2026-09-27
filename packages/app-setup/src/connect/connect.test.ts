import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { registerHooks, runSetupCheck, verifyHooks } from "@storytree/agent-link";
import { connectAgents, disconnectAgents, installedToolServerCommand, type RunHarness } from "./index.js";

const legacy = '# user comment\nmodel = "kept"\n[mcp_servers.legacy]\ncommand = "storytree-02"\n';

// Only the harness process is fake: registration edits real files in isolated homes.
const run: RunHarness = async (executable, args, options) => {
  if (args[0] === "--version") return "test harness";
  assert.equal(executable, "codex");
  const file = path.join(options.env.CODEX_HOME!, "config.toml");
  let source = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (source.includes("INVALID")) throw new Error("invalid TOML");
  const block = /\n?\[mcp_servers\.storytree\]\ncommand = (.+)\nargs = (.+)\n/.exec(source);
  const server = block === null ? undefined : { name: "storytree", enabled: true, transport: { type: "stdio", command: JSON.parse(block[1]!), args: JSON.parse(block[2]!), env: null, env_vars: [], cwd: null }, enabled_tools: null, disabled_tools: [] };
  if (args[1] === "list") return JSON.stringify(server === undefined ? [] : [server]);
  if (args[1] === "get") return JSON.stringify(server);
  if (args[1] === "add") {
    source += `\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(args[4])}\nargs = ${JSON.stringify(args.slice(5))}\n`;
  } else if (args[1] === "remove") source = source.replace(block![0], "");
  else throw new Error(`Unexpected command ${args.join(" ")}`);
  writeFileSync(file, source);
  return "";
};

function fixture(t: { after(fn: () => void): void }) {
  const home = mkdtempSync(path.join(tmpdir(), "storytree connect "));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const claude = path.join(home, ".claude");
  const codex = path.join(home, ".codex");
  const bin = path.join(home, "bin");
  const tools = path.join(home, "installed tools");
  for (const dir of [claude, codex, bin, tools]) mkdirSync(dir);
  const script = path.join(tools, "storytree-mcp.mjs");
  writeFileSync(script, "// installed tool server\n");
  const installed = installedToolServerCommand(process.execPath, script);
  const options = { installed, home, env: { PATH: bin }, run };
  const claudeFile = path.join(home, ".claude.json");
  const codexFile = path.join(codex, "config.toml");
  return { home, claude, codex, bin, tools, script, options, claudeFile, codexFile };
}

for (const harnesses of [["claude-code"], ["codex"], ["claude-code", "codex"]] as const) {
  test(`2.1/2.3: choosing ${harnesses.join(" and ")} preserves settings and repeats once`, async (t) => {
    const f = fixture(t);
    const original = { theme: "dark", projects: { elsewhere: { mcpServers: { storytree: { command: "0.2" } } } }, mcpServers: { legacy: { command: "storytree-02" }, other: { type: "http", url: "https://example.test/mcp" } } };
    writeFileSync(f.claudeFile, JSON.stringify(original));
    writeFileSync(f.codexFile, legacy);
    const first = await connectAgents({ ...f.options, harnesses });
    assert.deepEqual(first.map((r) => r.tools), harnesses.map(() => "connected"));
    assert.ok(first.every((r) => r.hooks === "not verified" && r.next.includes("check_setup")));
    const before = [readFileSync(f.claudeFile, "utf8"), readFileSync(f.codexFile, "utf8")];
    assert.deepEqual((await connectAgents({ ...f.options, harnesses })).map((r) => r.tools), harnesses.map(() => "already connected"));
    assert.deepEqual([readFileSync(f.claudeFile, "utf8"), readFileSync(f.codexFile, "utf8")], before);
    const claudeConfig = JSON.parse(before[0]!);
    assert.deepEqual(claudeConfig.projects, original.projects);
    assert.deepEqual(claudeConfig.mcpServers.legacy, original.mcpServers.legacy);
    assert.deepEqual(claudeConfig.mcpServers.other, original.mcpServers.other);
    assert.ok(before[1]!.startsWith(legacy));
    if (harnesses.includes("claude-code" as never)) {
      assert.deepEqual(claudeConfig.mcpServers.storytree, { type: "stdio", command: process.execPath, args: [f.script], env: {} });
    } else assert.deepEqual(claudeConfig, original);
    if (!harnesses.includes("codex" as never)) assert.equal(before[1], legacy);
  });
}

test("2.3/2.4: a conflicting 0.2 entry, missing harness and invalid settings get separate recovery actions", async (t) => {
  const f = fixture(t);
  const old = JSON.stringify({ mcpServers: { storytree: { command: "storytree-02" } } });
  writeFileSync(f.claudeFile, old);
  let results = await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  assert.equal(results[0]!.tools, "not connected");
  assert.match(results[0]!.next, /storytree.*existing|existing.*storytree/i);
  assert.equal(results[1]!.tools, "connected");
  assert.equal(readFileSync(f.claudeFile, "utf8"), old);
  writeFileSync(f.claudeFile, "{ broken JSON");
  results = await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  assert.match(results[0]!.next, /repair/i);
  assert.ok(results[0]!.next.includes(f.claudeFile));
  assert.equal(results[1]!.tools, "already connected");
  assert.equal(readFileSync(f.claudeFile, "utf8"), "{ broken JSON");
  writeFileSync(f.codexFile, "INVALID TOML");
  const absent: RunHarness = async (exe, args, opts) => { if (exe === "claude") throw Object.assign(new Error("not found"), { code: "ENOENT" }); return run(exe, args, opts); };
  results = await connectAgents({ ...f.options, run: absent, harnesses: ["claude-code", "codex"] });
  assert.ok(results.every((r) => r.tools === "not connected"));
  assert.match(results[0]!.next, /install.*sign in/i);
  assert.match(results[1]!.next, /repair/i);
  assert.equal(readFileSync(f.codexFile, "utf8"), "INVALID TOML");
});

test("2.2/2.6: the registered launch keeps the session folder and reaches its existing setup check; registration cannot verify hooks", async (t) => {
  const f = fixture(t);
  const folders = [path.join(f.home, "first project"), path.join(f.home, "second project")];
  for (const folder of folders) mkdirSync(folder);
  // A tiny installed-server stand-in measures exactly the cwd and environment delivered by the registration.
  writeFileSync(f.script, 'console.log(process.env.CLAUDE_PROJECT_DIR || process.cwd());');
  await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  const server = JSON.parse(readFileSync(f.claudeFile, "utf8")).mcpServers.storytree;
  for (const folder of folders) {
    const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
    assert.equal(execFileSync(server.command, server.args, { cwd: folder, env, encoding: "utf8" }).trim(), folder);
    const report = await runSetupCheck({ folder, storytreeHome: path.join(f.home, "no running app"), openWaitMs: 0, gh: async () => "missing", machine: async () => ({ agents: [], git: "missing", node: { status: "missing" } } as never) });
    assert.equal(report.project.status, "ask");
    assert.ok(!existsSync(path.join(folder, ".storytree.json")));
  }
  const verification = verifyHooks([], "codex");
  assert.equal(verification.verified, false);
});

test("2.5: disconnect one keeps the other and command; disconnect all removes only this installation's hooks and launcher", async (t) => {
  const f = fixture(t);
  await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  const hook = { node: process.execPath, script: path.join(f.tools, "storytree-hook.mjs") };
  registerHooks({ claude: f.claude, codex: f.codex }, hook);
  const settingsFile = path.join(f.claude, "settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.hooks.SessionStart[0].hooks.push({ type: "command", command: "my unrelated hook" });
  settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: "node", args: ["/old-02/storytree-hook.mjs"] }] });
  writeFileSync(settingsFile, JSON.stringify(settings));
  const commandFile = path.join(f.bin, process.platform === "win32" ? "storytree.cmd" : "storytree");
  const target = path.join(f.tools, "storytree.mjs");
  const marker = "storytree 0.3's command (put here by its setup check)";
  const launcher = process.platform === "win32" ? `@echo off\r\nrem ${marker}\r\ngoto #_storytree_handoff_# 2>nul || "${process.execPath}" "${target}" %*\r\n` : `#!/bin/sh\n# ${marker}\nexec "${process.execPath}" "${target}" "$@"\n`;
  writeFileSync(commandFile, launcher);
  const library = path.join(f.home, "library-kept"); writeFileSync(library, "project data");
  let result = await disconnectAgents({ ...f.options, harnesses: ["claude-code"] });
  assert.equal(result.harnesses[0]!.tools, "disconnected");
  assert.equal(result.command, "kept");
  assert.equal(readFileSync(commandFile, "utf8"), launcher);
  assert.match(readFileSync(f.codexFile, "utf8"), /mcp_servers.storytree/);
  const left = JSON.parse(readFileSync(settingsFile, "utf8"));
  assert.deepEqual(left.hooks.SessionStart, [{ hooks: [{ type: "command", command: "my unrelated hook" }] }, { hooks: [{ type: "command", command: "node", args: ["/old-02/storytree-hook.mjs"] }] }]);
  assert.equal(left.statusLine, undefined);
  result = await disconnectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(result.command, "removed");
  assert.equal(existsSync(commandFile), false);
  assert.equal(existsSync(path.join(f.codex, "hooks.json")), false);
  assert.equal(readFileSync(library, "utf8"), "project data");
});
