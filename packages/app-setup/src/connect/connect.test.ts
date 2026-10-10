import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { launcherFile, noteCodexHookRan, registerHooks, runSetupCheck, verifyHooks } from "@storytree/agent-link";
import { connectAgents, disconnectAgents, installedToolServerCommand, type RunHarness } from "./index.js";
import { deliveredCommand } from "./installed.js";
import { makeDevHome, removeDevHome } from "./dev-home.js";

const legacy = '# user comment\nmodel = "kept"\n[mcp_servers.legacy]\ncommand = "storytree-02"\n';

// Only the harness process is fake: registration edits real files in isolated homes.
const run: RunHarness = async (executable, args, options) => {
  if (args[0] === "--version") return "test harness";
  assert.equal(executable, "codex");
  const file = path.join(options.env.CODEX_HOME!, "config.toml");
  let source = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (source.includes("INVALID")) throw new Error("invalid TOML");
  const block = /\n?\[mcp_servers\.storytree\]\ncommand = (.+)\nargs = (.+)\n(?:env = \{ CODEX_HOME = (.+) \}\n)?/.exec(source);
  const env = block?.[3] === undefined ? null : { CODEX_HOME: JSON.parse(block[3]) };
  const server = block === null ? undefined : { name: "storytree", enabled: true, transport: { type: "stdio", command: JSON.parse(block[1]!), args: JSON.parse(block[2]!), env, env_vars: [], cwd: null }, enabled_tools: null, disabled_tools: [] };
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
  test(`2.1/2.3 choosing ${harnesses.join(" and ")} preserves settings and repeats once`, async (t) => {
    const f = fixture(t);
    const original = { theme: "dark", projects: { elsewhere: { mcpServers: { storytree: { command: "0.2" } } } }, mcpServers: { legacy: { command: "storytree-02" }, other: { type: "http", url: "https://example.test/mcp" } } };
    writeFileSync(f.claudeFile, JSON.stringify(original));
    writeFileSync(f.codexFile, legacy);
    const first = await connectAgents({ ...f.options, harnesses });
    assert.deepEqual(first.map((r) => r.tools), harnesses.map(() => "connected"));
    assert.ok(first.every((r) => r.harness === "codex" ? r.hooks === "waiting for you to trust them in Codex" : r.hooks === "not verified" && r.next.includes("check_setup")));
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

test("2.2 connecting registers the chosen harness's hooks, so its first session's start hook already runs", async (t) => {
  const f = fixture(t);
  const hookScript = path.join(f.tools, "storytree-hook.mjs");
  const settingsFile = path.join(f.claude, "settings.json");
  const codexHooks = path.join(f.codex, "hooks.json");
  await connectAgents({ ...f.options, harnesses: ["claude-code"] });
  const starts = JSON.parse(readFileSync(settingsFile, "utf8")).hooks.SessionStart.flatMap((entry: { hooks: { args?: string[] }[] }) => entry.hooks);
  assert.ok(starts.some((hook: { args?: string[] }) => hook.args?.[0] === hookScript), "the start hook is registered");
  assert.equal(existsSync(codexHooks), false, "an unchosen harness gets no hooks");
  await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.ok(readFileSync(codexHooks, "utf8").includes("storytree-hook.mjs"));
});

test("2.2 connecting a harness that has never run, so has no home folder yet, still registers its hooks", async (t) => {
  const f = fixture(t);
  rmSync(f.claude, { recursive: true });
  rmSync(f.codex, { recursive: true });
  const results = await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  assert.deepEqual(results.map((r) => r.tools), ["connected", "connected"]);
  assert.ok(readFileSync(path.join(f.claude, "settings.json"), "utf8").includes("storytree-hook.mjs"));
  assert.ok(readFileSync(path.join(f.codex, "hooks.json"), "utf8").includes("storytree-hook.mjs"));
});

test("2.2 connecting Codex tells its first session, hooks trusted or not, to call check_setup first in a project; disconnecting takes that out", async (t) => {
  const f = fixture(t);
  const agents = path.join(f.codex, "AGENTS.md");
  await connectAgents({ ...f.options, harnesses: ["claude-code"] });
  assert.equal(existsSync(agents), false, "Claude Code alone writes nothing into Codex's home");
  await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.match(readFileSync(agents, "utf8"), /`check_setup`/);
  await disconnectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(existsSync(agents), false);
});

test("2.6 connecting Codex names the one-time trust step until one of its hooks has run, then says its hooks run", async (t) => {
  const f = fixture(t);
  const [first] = await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(first!.hooks, "waiting for you to trust them in Codex");
  assert.match(first!.next, /type \/hooks/);
  assert.match(first!.next, /Hooks need review/);
  noteCodexHookRan({ storytreeHome: path.join(f.home, ".storytree", "0.3"), codexHome: f.codex });
  const [again] = await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(again!.hooks, "running");
  assert.doesNotMatch(again!.next, /\/hooks/);
  const [claude] = await connectAgents({ ...f.options, harnesses: ["claude-code"] });
  assert.equal(claude!.hooks, "not verified", "Claude Code runs hooks without asking; its session check verifies them");
});

test("2.6 connecting Codex from an administrator terminal says Codex cannot run commands from one and to open it from a normal terminal; Claude Code, or a normal terminal, hears nothing of it", async (t) => {
  const f = fixture(t);
  const [codex, claude] = await connectAgents({ ...f.options, elevated: async () => true, harnesses: ["codex", "claude-code"] });
  assert.match(codex!.next, /administrator/);
  assert.match(codex!.next, /normal terminal/);
  assert.doesNotMatch(claude!.next, /administrator/);
  const [normal] = await connectAgents({ ...f.options, elevated: async () => false, harnesses: ["codex"] });
  assert.doesNotMatch(normal!.next, /administrator/);
});

test("2.3/2.4 a conflicting 0.2 entry, missing harness and invalid settings get separate recovery actions", async (t) => {
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

test("2.2/2.6 the registered launch keeps the session folder and reaches its existing setup check; registration cannot verify hooks", async (t) => {
  const f = fixture(t);
  const folders = [path.join(f.home, "first project"), path.join(f.home, "second project")];
  for (const folder of folders) mkdirSync(folder);
  // A tiny installed-server stand-in measures exactly the cwd and environment delivered by the registration.
  writeFileSync(f.script, 'console.log(process.env.CLAUDE_PROJECT_DIR || process.cwd());');
  await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  const server = JSON.parse(readFileSync(f.claudeFile, "utf8")).mcpServers.storytree;
  for (const folder of folders) {
    const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
    assert.equal(execFileSync(server.command, server.args, { cwd: folder, env, encoding: "utf8" }).trim(), realpathSync(folder));
    const report = await runSetupCheck({ folder, storytreeHome: path.join(f.home, "no running app"), openWaitMs: 0, gh: async () => "missing", machine: async () => ({ claude: "missing", codex: "missing", git: "missing", node: { state: "missing" }, waitMs: 0 }) });
    assert.equal(report.project.status, "ask");
    assert.ok(!existsSync(path.join(folder, ".storytree.json")));
  }
  const verification = verifyHooks([], "session", "codex");
  assert.equal(verification.verified, false);
});

test("2.2 with its own CODEX_HOME, Codex's registration hands the tool server that home, which Codex would otherwise strip, so its setup check registers and reads hooks where Codex reads them", async (t) => {
  const f = fixture(t);
  const custom = path.join(f.home, "custom codex");
  mkdirSync(custom);
  await connectAgents({ ...f.options, env: { ...f.options.env, CODEX_HOME: custom }, harnesses: ["codex"] });
  const table = readFileSync(path.join(custom, "config.toml"), "utf8").split("[mcp_servers.storytree]")[1] ?? "";
  assert.ok(table.includes(`\nenv = { CODEX_HOME = ${JSON.stringify(custom)} }\n`), table);
  assert.deepEqual((await connectAgents({ ...f.options, env: { ...f.options.env, CODEX_HOME: custom }, harnesses: ["codex"] })).map((r) => r.tools), ["already connected"]);
  await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.doesNotMatch(readFileSync(f.codexFile, "utf8"), /CODEX_HOME/, "the default home needs no hand-off");
});

test("2.2 a custom-home Codex registration storytree wrote before it handed over CODEX_HOME is updated in place, keeping the user's other settings", async (t) => {
  const f = fixture(t);
  const custom = path.join(f.home, "custom codex");
  mkdirSync(custom);
  const file = path.join(custom, "config.toml");
  writeFileSync(file, `${legacy}\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(f.options.installed.command)}\nargs = ${JSON.stringify(f.options.installed.args)}\n`);
  const [result] = await connectAgents({ ...f.options, env: { ...f.options.env, CODEX_HOME: custom }, harnesses: ["codex"] });
  assert.equal(result!.tools, "connected", result!.next);
  const source = readFileSync(file, "utf8");
  assert.ok(source.startsWith(legacy), source);
  assert.equal(source.split("[mcp_servers.storytree]").length, 2, source);
  assert.ok(source.includes(`\nenv = { CODEX_HOME = ${JSON.stringify(custom)} }\n`), source);
});

test("2.5 disconnect one keeps the other and command; disconnect all removes only this installation's hooks and launcher", async (t) => {
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

test("2.5 a disconnected harness stays disconnected: the other harness's next setup check does not register its hooks again, and connecting it again does", async (t) => {
  const f = fixture(t);
  await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  const hook = { node: process.execPath, script: path.join(f.tools, "storytree-hook.mjs") };
  registerHooks({ claude: f.claude, codex: f.codex }, hook);
  const codexHooks = path.join(f.codex, "hooks.json");
  const result = await disconnectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(result.harnesses[0]!.tools, "disconnected");
  assert.equal(existsSync(codexHooks), false);

  // The next Claude Code session's setup check, as its tool server runs it.
  const check = () => runSetupCheck({
    folder: f.home, hook, homes: { claude: f.claude, codex: f.codex }, storytreeHome: path.join(f.home, ".storytree", "0.3"), openWaitMs: 0,
    gh: async () => "missing", machine: async () => ({ claude: "missing", codex: "missing", git: "missing", node: { state: "missing" }, waitMs: 0 }),
  });
  const report = await check();
  assert.equal(existsSync(codexHooks), false, "Codex's hooks are still absent");
  assert.equal(report.hooks?.["claude-code"], "already registered", "Claude Code's are kept");

  await connectAgents({ ...f.options, harnesses: ["codex"] });
  await check();
  assert.equal(existsSync(codexHooks), true, "connected again, Codex gets its hooks at the next check");
});

test("2.3 incompatible Codex command and disabled tools are explained without overwriting", async (t) => {
  const f = fixture(t);
  const original = `${legacy}\n[mcp_servers.storytree]\ncommand = "storytree-02"\nargs = []\n`;
  writeFileSync(f.codexFile, original);
  const results = await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(results[0]!.tools, "not connected");
  assert.match(results[0]!.next, /existing storytree/);
  assert.equal(readFileSync(f.codexFile, "utf8"), original);
  rmSync(f.codexFile);
  await connectAgents({ ...f.options, harnesses: ["codex"] });
  const registered = readFileSync(f.codexFile, "utf8");
  const restricted: RunHarness = async (exe, args, opts) => {
    const answer = await run(exe, args, opts);
    return args[1] === "get" ? JSON.stringify({ ...JSON.parse(answer), disabled_tools: ["check_setup"] }) : answer;
  };
  assert.equal((await connectAgents({ ...f.options, run: restricted, harnesses: ["codex"] }))[0]!.tools, "not connected");
  assert.equal(readFileSync(f.codexFile, "utf8"), registered);
});

test("2.4 invalid JSON shapes are preserved and an interrupted settings edit can safely retry", async (t) => {
  const f = fixture(t);
  for (const invalid of ["null", "[]", '{"mcpServers":[]}']) {
    writeFileSync(f.claudeFile, invalid);
    assert.equal((await connectAgents({ ...f.options, harnesses: ["claude-code"] }))[0]!.tools, "not connected");
    assert.equal(readFileSync(f.claudeFile, "utf8"), invalid);
  }
  const changed: RunHarness = async (exe, args, opts) => {
    const answer = await run(exe, args, opts);
    if (args[1] === "get") writeFileSync(f.codexFile, legacy);
    return answer;
  };
  const failed = await connectAgents({ ...f.options, run: changed, harnesses: ["codex"] });
  assert.equal(failed[0]!.tools, "not connected");
  assert.equal(readFileSync(f.codexFile, "utf8"), legacy);
  assert.equal((await connectAgents({ ...f.options, harnesses: ["codex"] }))[0]!.tools, "connected");
});

test("2.5 a Claude-only machine finishes cleanup without requiring Codex", async (t) => {
  const f = fixture(t);
  const onlyClaude: RunHarness = async (exe, args, opts) => {
    if (exe === "codex") throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return run(exe, args, opts);
  };
  const options = { ...f.options, run: onlyClaude, harnesses: ["claude-code"] as const };
  await connectAgents(options);
  registerHooks({ claude: f.claude }, { node: process.execPath, script: path.join(f.tools, "storytree-hook.mjs") });
  const result = await disconnectAgents(options);
  assert.equal(result.harnesses[0]!.tools, "disconnected");
  assert.equal(result.command, "none");
  assert.equal(JSON.parse(readFileSync(path.join(f.claude, "settings.json"), "utf8")).hooks, undefined);
});

test("2.5 damaged hook settings keep the connection for a safe retry; a replaced registration is left alone", async (t) => {
  const f = fixture(t);
  const options = { ...f.options, harnesses: ["claude-code"] as const };
  await connectAgents(options);
  const registered = readFileSync(f.claudeFile, "utf8");
  const hookFile = path.join(f.claude, "settings.json");
  writeFileSync(hookFile, '{"hooks":{"SessionStart":"damaged"}}');
  let result = await disconnectAgents(options);
  assert.equal(result.harnesses[0]!.tools, "kept");
  assert.equal(result.command, "kept");
  assert.equal(readFileSync(f.claudeFile, "utf8"), registered);
  assert.equal(readFileSync(hookFile, "utf8"), '{"hooks":{"SessionStart":"damaged"}}');
  writeFileSync(hookFile, "{}");
  assert.equal((await disconnectAgents(options)).harnesses[0]!.tools, "disconnected");
  const replaced = '{"mcpServers":{"storytree":{"command":"my replacement"}}}';
  writeFileSync(f.claudeFile, replaced);
  result = await disconnectAgents(options);
  assert.equal(result.harnesses[0]!.tools, "kept");
  assert.equal(readFileSync(f.claudeFile, "utf8"), replaced);
});

test("2.4 invalid hook settings block only that harness; missing installed tools direct a reinstall", async (t) => {
  const f = fixture(t);
  const hookFile = path.join(f.claude, "settings.json");
  writeFileSync(hookFile, "{ invalid");
  const results = await connectAgents({ ...f.options, harnesses: ["claude-code", "codex"] });
  assert.deepEqual(results.map((r) => r.tools), ["not connected", "connected"]);
  assert.ok(results[0]!.next.includes(hookFile));
  assert.equal(existsSync(f.claudeFile), false);
  assert.equal(readFileSync(hookFile, "utf8"), "{ invalid");
  rmSync(f.script);
  const missing = await connectAgents({ ...f.options, harnesses: ["codex"] });
  assert.equal(missing[0]!.tools, "not connected");
  assert.match(missing[0]!.next, /installer.*bundled Node/);
});

test("2.1 before finish has recorded the delivery, connect uses the tools installed beside its own helper", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree unfinished "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, "resources", "agent-tools");
  mkdirSync(tools, { recursive: true });
  const node = path.join(tools, process.platform === "win32" ? "node.exe" : "node");
  const mcp = path.join(tools, "storytree-mcp.mjs");
  for (const file of [node, mcp]) writeFileSync(file, "installed");
  const home = path.join(dir, "home without a delivery record");
  assert.deepEqual(deliveredCommand(home, tools), installedToolServerCommand(node, mcp));
  rmSync(mcp);
  assert.throws(() => deliveredCommand(home, tools), /finish/);
});

test("2.2 a dev build connects its own commands to a throwaway Codex home with its own database, reading nothing of the user's but the sign-in", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree dev home "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const signedIn = path.join(dir, "the user's codex");
  mkdirSync(signedIn);
  writeFileSync(path.join(signedIn, "auth.json"), '{"signed":"in"}');
  writeFileSync(path.join(signedIn, "config.toml"), legacy);
  // The commands a dev build makes, stood in for: building them is the agent link's own concern.
  const build = async (outdir: string) => {
    mkdirSync(outdir, { recursive: true });
    const names = ["storytree-mcp", "storytree-hook", "storytree-setup", "storytree"];
    for (const name of names) writeFileSync(path.join(outdir, `${name}.mjs`), `// ${name}\n`);
    // A build on Windows also makes the program its command is made from (ADR-0854); nothing runs it here.
    writeFileSync(path.join(outdir, "storytree-launcher.exe"), "a stand-in launcher program");
    return Object.fromEntries(names.map((name) => [name, path.join(outdir, `${name}.mjs`)]));
  };
  const rig = path.join(dir, "rig");
  const made = await makeDevHome({ dir: rig, harnesses: ["codex"], signedIn: { codex: signedIn }, build, run });
  assert.deepEqual(made.results.map((r) => r.tools), ["connected"]);
  const codexHome = made.env.CODEX_HOME!;
  assert.ok(codexHome.startsWith(rig) && made.env.HOME!.startsWith(rig) && made.env.STORYTREE_HOME!.startsWith(rig));
  assert.equal(readFileSync(path.join(codexHome, "auth.json"), "utf8"), '{"signed":"in"}');
  const config = readFileSync(path.join(codexHome, "config.toml"), "utf8");
  assert.ok(config.includes(JSON.stringify(path.join(rig, "tools", "storytree-mcp.mjs"))), "Codex starts the dev build's own tool server");
  assert.ok(readFileSync(path.join(codexHome, "hooks.json"), "utf8").includes("storytree-hook.mjs"));
  assert.match(readFileSync(path.join(codexHome, "AGENTS.md"), "utf8"), /check_setup/);
  assert.equal(readFileSync(path.join(signedIn, "config.toml"), "utf8"), legacy, "the user's own Codex home is only read");
  // Its own database: opening storytree in the throwaway home starts it there, as the app would.
  const app = JSON.parse(readFileSync(path.join(made.env.STORYTREE_HOME!, "app.json"), "utf8"));
  assert.equal(app.command, process.execPath);
  // One file to source, and the dev build's storytree command first on its PATH.
  const envFile = readFileSync(made.envFile, "utf8");
  for (const name of ["HOME", "CODEX_HOME", "STORYTREE_HOME"]) assert.ok(envFile.includes(made.env[name]!), name);
  assert.ok(existsSync(path.join(made.env.PATH!.split(path.delimiter)[0]!, launcherFile())));
});

test("2.2 a dev home never copies Claude Code's sign-in, and hands a Codex sign-in refreshed inside it back to the user's own, so its refresh cannot end the user's", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree dev home sign-in "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const codex = path.join(dir, "the user's codex");
  const claude = path.join(dir, "the user's claude");
  for (const folder of [codex, claude]) mkdirSync(folder);
  writeFileSync(path.join(codex, "auth.json"), '{"refresh":"one"}');
  writeFileSync(path.join(claude, ".credentials.json"), '{"refresh":"one"}');
  const build = async (outdir: string) => {
    mkdirSync(outdir, { recursive: true });
    const names = ["storytree-mcp", "storytree-hook", "storytree-setup", "storytree"];
    for (const name of names) writeFileSync(path.join(outdir, `${name}.mjs`), `// ${name}\n`);
    // A build on Windows also makes the program its command is made from (ADR-0854); nothing runs it here.
    writeFileSync(path.join(outdir, "storytree-launcher.exe"), "a stand-in launcher program");
    return Object.fromEntries(names.map((name) => [name, path.join(outdir, `${name}.mjs`)]));
  };
  const rig = path.join(dir, "rig");
  const made = await makeDevHome({ dir: rig, harnesses: ["codex", "claude-code"], signedIn: { codex }, build, run });
  assert.equal(existsSync(path.join(made.env.CLAUDE_CONFIG_DIR!, ".credentials.json")), false, "a copied Claude Code sign-in refreshes on its own and ends the user's");
  // Codex refreshed its sign-in inside the throwaway home: the user's old one no longer works.
  writeFileSync(path.join(made.env.CODEX_HOME!, "auth.json"), '{"refresh":"two"}');
  await removeDevHome(rig);
  assert.equal(readFileSync(path.join(codex, "auth.json"), "utf8"), '{"refresh":"two"}');
  assert.equal(existsSync(rig), false);
});
