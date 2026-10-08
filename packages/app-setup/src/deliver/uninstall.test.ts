import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connectAgents, installedToolServerCommand, type RunHarness } from "@storytree/app-setup/connect";

import { toolPaths } from "./payload.js";
import { uninstall, uninstallAsks } from "./uninstall.js";

// Only Codex's command line is fake: it reads and writes the TOML it was pointed at, as the real one does.
const run: RunHarness = async (_executable, args, options) => {
  if (args[0] === "--version") return "test harness";
  const file = path.join(options.env.CODEX_HOME!, "config.toml");
  let source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const block = /\n?\[mcp_servers\.storytree\]\ncommand = (.+)\nargs = (.+)\n/.exec(source);
  const server = block === null ? undefined : { name: "storytree", enabled: true, transport: { type: "stdio", command: JSON.parse(block[1]!), args: JSON.parse(block[2]!), env: null, env_vars: [], cwd: null }, enabled_tools: null, disabled_tools: [] };
  if (args[1] === "list") return JSON.stringify(server === undefined ? [] : [server]);
  if (args[1] === "get") return JSON.stringify(server);
  if (args[1] === "remove") { writeFileSync(file, source.replace(block![0], "")); return ""; }
  throw new Error(`Unexpected command ${args.join(" ")}`);
};

/** A first user's machine after the one-liner: app, home, command, both agents connected, a project. */
async function installedMachine(t: { after(fn: () => void): void }) {
  const user = mkdtempSync(path.join(tmpdir(), "storytree uninstall "));
  t.after(() => rmSync(user, { recursive: true, force: true }));
  const installDir = path.join(user, "AppData", "Local", "Programs", "storytree-0.3");
  const localAppData = path.join(user, "AppData", "Local");
  const home = path.join(user, ".storytree", "0.3");
  const tools = toolPaths(installDir, "win32");
  mkdirSync(tools.dir, { recursive: true });
  for (const file of [tools.node, tools.mcp, tools.hook]) writeFileSync(file, "installed");
  writeFileSync(path.join(installDir, "resources", "app-update.yml"), "provider: github\nupdaterCacheDirName: '@storytreedesktop-updater'\n");
  const cache = path.join(localAppData, "@storytreedesktop-updater");
  mkdirSync(cache, { recursive: true });
  writeFileSync(path.join(cache, "installer.exe"), "a downloaded update");
  for (const dir of [path.join(home, "pgdata"), path.join(home, "bin")]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(home, "pgdata", "PG_VERSION"), "17");
  writeFileSync(path.join(home, "bin", "storytree.cmd"), "@echo off\r\nrem storytree 0.3's command (put here by its setup check)\r\n");
  writeFileSync(path.join(home, "delivery.json"), JSON.stringify({ schema: 1, installDir, tools }));
  const old = path.join(user, ".storytree", "secrets.json");
  writeFileSync(old, "0.2's, never ours to remove");

  const claude = path.join(user, ".claude");
  const codex = path.join(user, ".codex");
  mkdirSync(claude);
  mkdirSync(codex);
  const claudeFile = path.join(user, ".claude.json");
  writeFileSync(claudeFile, JSON.stringify({ theme: "dark", mcpServers: { other: { type: "http", url: "https://example.test/mcp" } } }));
  writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "the user's own hook" }] }] } }));
  writeFileSync(path.join(codex, "config.toml"), '# the user\'s own\nmodel = "kept"\n');
  const env = { PATH: path.join(home, "bin") };
  const installed = installedToolServerCommand(tools.node, tools.mcp);
  const connected = await connectAgents({ harnesses: ["claude-code", "codex"], installed, home: user, env, run });
  assert.deepEqual(connected.map((result) => result.tools), ["connected", "connected"]);

  const project = path.join(user, "My Project");
  mkdirSync(project);
  writeFileSync(path.join(project, ".storytree.json"), '{"project":"my-project"}');
  writeFileSync(path.join(project, "notes.md"), "the user's work");

  const pathEntry = path.join(home, "bin");
  let userPath: string | undefined = `C:\\Windows;${pathEntry};C:\\Users\\me\\.local\\bin`;
  const effects = { readUserPath: () => userPath, writeUserPath: (value: string) => { userPath = value; } };
  const options = { installDir, home, userHome: user, env, run, localAppData, effects, platform: "win32" as const };
  return { user, installDir, home, cache, old, claude, codex, claudeFile, project, options, userPath: () => userPath };
}

test("1.8: uninstalling removes everything storytree added, and leaves the user's projects and settings", async (t) => {
  const m = await installedMachine(t);
  assert.equal(uninstallAsks(m.installDir, m.home), "ask");

  const report = await uninstall({ ...m.options, library: "remove" });
  assert.equal(report.complete, true, report.lines.join("\n"));

  const claudeConfig = JSON.parse(readFileSync(m.claudeFile, "utf8"));
  assert.equal(claudeConfig.mcpServers.storytree, undefined);
  assert.deepEqual(claudeConfig.mcpServers.other, { type: "http", url: "https://example.test/mcp" });
  assert.equal(claudeConfig.theme, "dark");
  const settings = JSON.parse(readFileSync(path.join(m.claude, "settings.json"), "utf8"));
  assert.deepEqual(settings, { theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "the user's own hook" }] }] } });
  assert.equal(readFileSync(path.join(m.codex, "config.toml"), "utf8"), '# the user\'s own\nmodel = "kept"\n');
  assert.equal(existsSync(path.join(m.codex, "hooks.json")), false);
  assert.equal(existsSync(path.join(m.codex, "AGENTS.md")), false, "connecting Codex wrote a storytree section there; it held nothing else");

  assert.equal(m.userPath(), "C:\\Windows;C:\\Users\\me\\.local\\bin");
  assert.equal(existsSync(m.home), false);
  assert.equal(existsSync(m.cache), false);
  assert.equal(readFileSync(m.old, "utf8"), "0.2's, never ours to remove");

  assert.equal(readFileSync(path.join(m.project, "notes.md"), "utf8"), "the user's work");
  assert.equal(readFileSync(path.join(m.project, ".storytree.json"), "utf8"), '{"project":"my-project"}');
});

test("1.8: keeping the library leaves only the library behind", async (t) => {
  const m = await installedMachine(t);
  // What the app leaves in its home beside the library: its browser data, logs and launch record.
  mkdirSync(path.join(m.home, "electron", "Cache"), { recursive: true });
  writeFileSync(path.join(m.home, "electron", "Cache", "data_0"), "cached");
  for (const file of ["releases.log", "pgdata.log", "app.json"]) writeFileSync(path.join(m.home, file), "the app's");
  // What finds the library again: this machine's identity (its projects' folders are recorded under it) and the chosen project.
  for (const file of ["machine.json", "project-choice.json"]) writeFileSync(path.join(m.home, file), "{}");
  const report = await uninstall({ ...m.options, library: "keep" });
  assert.equal(report.complete, true, report.lines.join("\n"));
  assert.deepEqual(readdirSync(m.home).sort(), ["machine.json", "pgdata", "project-choice.json"]);
  assert.equal(readFileSync(path.join(m.home, "pgdata", "PG_VERSION"), "utf8"), "17");
  assert.equal(m.userPath(), "C:\\Windows;C:\\Users\\me\\.local\\bin");
  assert.equal(JSON.parse(readFileSync(m.claudeFile, "utf8")).mcpServers.storytree, undefined);
  assert.ok(report.lines.some((line) => line.includes(m.home)), "the user is told where the kept library is");
});

test("1.8: an uninstaller leaves another installation's home alone", async (t) => {
  const m = await installedMachine(t);
  const other = path.join(m.user, "another install");
  mkdirSync(path.join(other, "resources", "agent-tools"), { recursive: true });
  assert.equal(uninstallAsks(other, m.home), "not ours");
  const report = await uninstall({ ...m.options, installDir: other, library: "remove" });
  assert.equal(report.complete, true, report.lines.join("\n"));
  assert.equal(readFileSync(path.join(m.home, "pgdata", "PG_VERSION"), "utf8"), "17");
  assert.equal(existsSync(m.cache), true);
  assert.match(m.userPath()!, /\.storytree/);
  assert.ok(JSON.parse(readFileSync(m.claudeFile, "utf8")).mcpServers.storytree, "the other installation's connection stays");
});

test("1.8: a connection that cannot be removed is named, and the rest is still removed", async (t) => {
  const m = await installedMachine(t);
  const broken: RunHarness = async () => { throw new Error("codex is not installed"); };
  const report = await uninstall({ ...m.options, run: broken, library: "remove" });
  assert.equal(report.complete, false);
  assert.ok(report.lines.some((line) => line.startsWith("Codex") && line.includes("config.toml")), report.lines.join("\n"));
  assert.equal(JSON.parse(readFileSync(m.claudeFile, "utf8")).mcpServers.storytree, undefined);
  assert.equal(existsSync(m.home), false);
});
