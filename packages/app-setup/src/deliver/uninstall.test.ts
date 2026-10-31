import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connectAgents, installedToolServerCommand, type RunHarness } from "@storytree/app-setup/connect";

import { toolPaths } from "./payload.js";
import { openUninstaller, uninstall, uninstallAsks } from "./uninstall.js";

// Only Codex's command line is fake: it reads and writes the TOML it was pointed at, as the real one does.
const run: RunHarness = async (_executable, args, options) => {
  if (args[0] === "--version") return "test harness";
  const file = path.join(options.env.CODEX_HOME!, "config.toml");
  let source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const block = /\n?\[mcp_servers\.storytree\]\ncommand = (.+)\nargs = (.+)\n(?:tool_timeout_sec = (\d+)\n)?/.exec(source);
  const server = block === null ? undefined : { name: "storytree", enabled: true, transport: { type: "stdio", command: JSON.parse(block[1]!), args: JSON.parse(block[2]!), env: null, env_vars: [], cwd: null }, enabled_tools: null, disabled_tools: [], tool_timeout_sec: block[3] === undefined ? null : Number(block[3]) };
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

test("1.8: uninstalling removes a Codex registration storytree wrote before it allowed long tool calls", async (t) => {
  const m = await installedMachine(t);
  const file = path.join(m.codex, "config.toml");
  writeFileSync(file, readFileSync(file, "utf8").replace(/tool_timeout_sec = \d+\n/, ""));
  const report = await uninstall({ ...m.options, library: "remove" });
  assert.equal(report.complete, true, report.lines.join("\n"));
  assert.equal(readFileSync(file, "utf8"), '# the user\'s own\nmodel = "kept"\n');
});

test("1.8: keeping the library leaves only the library behind", async (t) => {
  const m = await installedMachine(t);
  // What the app leaves in its home beside the library: its browser data, logs and launch record.
  mkdirSync(path.join(m.home, "electron", "Cache"), { recursive: true });
  writeFileSync(path.join(m.home, "electron", "Cache", "data_0"), "cached");
  for (const file of ["releases.log", "pgdata.log", "app.json"]) writeFileSync(path.join(m.home, file), "the app's");
  // What finds the library again: this machine's identity (its projects' folders are recorded under it) and the chosen project.
  for (const file of ["machine.json", "project-choice.json"]) writeFileSync(path.join(m.home, file), "{}");
  // And what signs in to it: the database's password, in its private directory beside it.
  mkdirSync(path.join(m.home, "pgdata.auth"));
  writeFileSync(path.join(m.home, "pgdata.auth", "installation.json"), "{}");
  const report = await uninstall({ ...m.options, library: "keep" });
  assert.equal(report.complete, true, report.lines.join("\n"));
  assert.deepEqual(readdirSync(m.home).sort(), ["machine.json", "pgdata", "pgdata.auth", "project-choice.json"]);
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

/** A Linux user's machine after install.sh: its folder, menu entry and marked ~/.profile line, both agents connected. */
const posix = { skip: process.platform === "win32" && "platform:posix: install.sh writes the PATH line under a POSIX shell, which Windows CI does not provide" };

async function installedLinuxMachine(t: { after(fn: () => void): void }) {
  const user = mkdtempSync(path.join(tmpdir(), "storytree linux uninstall "));
  t.after(() => rmSync(user, { recursive: true, force: true }));
  const installDir = path.join(user, ".local", "share", "storytree-0.3");
  const home = path.join(user, ".storytree", "0.3");
  const tools = toolPaths(installDir, "linux");
  mkdirSync(tools.dir, { recursive: true });
  for (const file of [tools.app, tools.node, tools.mcp, tools.hook, path.join(installDir, "storytree-0.3.png")]) writeFileSync(file, "installed");
  const menu = path.join(user, ".local", "share", "applications");
  mkdirSync(menu, { recursive: true });
  writeFileSync(path.join(menu, "storytree-0.3.desktop"), `[Desktop Entry]\nExec="${tools.app}" %U\n`);
  writeFileSync(path.join(menu, "someone-else.desktop"), "[Desktop Entry]\n");
  for (const dir of [path.join(home, "pgdata"), path.join(home, "bin")]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(home, "pgdata", "PG_VERSION"), "17");
  writeFileSync(path.join(home, "delivery.json"), JSON.stringify({ schema: 1, installDir, tools }));
  // The PATH line is the one install.sh itself writes, between the user's own lines.
  const profile = path.join(user, ".profile");
  writeFileSync(profile, "# the user's own\nexport EDITOR=vi\n");
  const script = path.join(import.meta.dirname, "install.sh");
  execFileSync("sh", ["-c", `STORYTREE_INSTALL_LIBRARY=1; . "$1"; st_profile_add "$2" "$3"`, "sh", script, profile, path.join(home, "bin")]);
  appendFileSync(profile, "export PATH=\"$HOME/bin:$PATH\"\n");
  assert.match(readFileSync(profile, "utf8"), /setup uninstall/);

  mkdirSync(path.join(user, ".claude"));
  writeFileSync(path.join(user, ".claude.json"), JSON.stringify({ mcpServers: {} }));
  const env = { PATH: path.join(home, "bin") };
  const connected = await connectAgents({ harnesses: ["claude-code"], installed: installedToolServerCommand(tools.node, tools.mcp), home: user, env, run });
  assert.deepEqual(connected.map((result) => result.tools), ["connected"]);
  const options = { home, userHome: user, env, run, platform: "linux" as const };
  return { user, installDir, home, menu, profile, options };
}

test("1.8: uninstalling on Linux removes the installation folder, menu entry and marked PATH line, and only those", posix, async (t) => {
  const m = await installedLinuxMachine(t);
  const said = await openUninstaller("remove", toolPaths(m.installDir, "linux").dir, m.options);
  assert.equal(existsSync(m.installDir), false);
  assert.deepEqual(readdirSync(m.menu), ["someone-else.desktop"]);
  assert.equal(readFileSync(m.profile, "utf8"), "# the user's own\nexport EDITOR=vi\nexport PATH=\"$HOME/bin:$PATH\"\n");
  assert.equal(existsSync(m.home), false);
  assert.equal(JSON.parse(readFileSync(path.join(m.user, ".claude.json"), "utf8")).mcpServers.storytree, undefined);
  assert.match(said, /removed/);
});

test("1.8: on Linux a library is kept or removed only on the user's say", posix, async (t) => {
  const m = await installedLinuxMachine(t);
  const helper = toolPaths(m.installDir, "linux").dir;
  await assert.rejects(openUninstaller(undefined, helper, m.options), /--keep-library or --remove-library/);
  assert.equal(existsSync(m.installDir), true, "nothing is removed before the user chooses");
  writeFileSync(path.join(m.home, "app.json"), JSON.stringify({ pid: process.pid }));
  await assert.rejects(openUninstaller("keep", helper, m.options), /Quit storytree/);
  assert.equal(existsSync(m.installDir), true, "nothing is removed while the app runs from it");
  rmSync(path.join(m.home, "app.json"));
  const said = await openUninstaller("keep", helper, m.options);
  assert.deepEqual(readdirSync(m.home), ["pgdata"]);
  assert.equal(existsSync(m.installDir), false);
  assert.match(said, new RegExp(m.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

/** A Mac user's machine after install.sh: the .app in ~/Applications and the marked .zprofile line, Claude Code connected. */
async function installedMacMachine(t: { after(fn: () => void): void }, zdotdir?: string) {
  const user = mkdtempSync(path.join(tmpdir(), "storytree mac uninstall "));
  t.after(() => rmSync(user, { recursive: true, force: true }));
  const applications = path.join(user, "Applications");
  const installDir = path.join(applications, "storytree-0.3.app");
  const home = path.join(user, ".storytree", "0.3");
  const tools = toolPaths(installDir, "darwin");
  mkdirSync(tools.dir, { recursive: true });
  mkdirSync(path.dirname(tools.app), { recursive: true });
  for (const file of [tools.app, tools.node, tools.mcp, tools.hook]) writeFileSync(file, "installed");
  mkdirSync(path.join(applications, "Someone Else.app"));
  for (const dir of [path.join(home, "pgdata"), path.join(home, "bin")]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(home, "pgdata", "PG_VERSION"), "17");
  writeFileSync(path.join(home, "delivery.json"), JSON.stringify({ schema: 1, installDir, tools }));
  const profileDir = zdotdir ?? user;
  mkdirSync(profileDir, { recursive: true });
  const profile = path.join(profileDir, ".zprofile");
  writeFileSync(profile, "# the user's own\nexport EDITOR=vi\n");
  const script = path.join(import.meta.dirname, "install.sh");
  execFileSync("sh", ["-c", `STORYTREE_INSTALL_LIBRARY=1; . "$1"; st_profile_add "$2" "$3"`, "sh", script, profile, path.join(home, "bin")]);
  assert.match(readFileSync(profile, "utf8"), /setup uninstall/);

  mkdirSync(path.join(user, ".claude"));
  writeFileSync(path.join(user, ".claude.json"), JSON.stringify({ mcpServers: {} }));
  const env = { PATH: path.join(home, "bin"), ...(zdotdir === undefined ? {} : { ZDOTDIR: zdotdir }) };
  const connected = await connectAgents({ harnesses: ["claude-code"], installed: installedToolServerCommand(tools.node, tools.mcp), home: user, env, run });
  assert.deepEqual(connected.map((result) => result.tools), ["connected"]);
  const options = { home, userHome: user, env, run, platform: "darwin" as const };
  return { user, applications, installDir, home, profile, options, helper: tools.dir };
}

test("1.8: uninstalling on a Mac removes the .app and the marked .zprofile line, and only those", posix, async (t) => {
  const m = await installedMacMachine(t);
  const said = await openUninstaller("remove", m.helper, m.options);
  assert.deepEqual(readdirSync(m.applications), ["Someone Else.app"]);
  assert.equal(readFileSync(m.profile, "utf8"), "# the user's own\nexport EDITOR=vi\n");
  assert.equal(existsSync(m.home), false);
  assert.equal(JSON.parse(readFileSync(path.join(m.user, ".claude.json"), "utf8")).mcpServers.storytree, undefined);
  assert.match(said, /removed/);
});

test("1.8: on a Mac the .zprofile line goes from ZDOTDIR when zsh reads it there, and a library stays only on the user's say", posix, async (t) => {
  const zdotdir = path.join(tmpdir(), `storytree zdotdir ${process.pid}`);
  t.after(() => rmSync(zdotdir, { recursive: true, force: true }));
  const m = await installedMacMachine(t, zdotdir);
  await assert.rejects(openUninstaller(undefined, m.helper, m.options), /--keep-library or --remove-library/);
  writeFileSync(path.join(m.home, "app.json"), JSON.stringify({ pid: process.pid }));
  await assert.rejects(openUninstaller("keep", m.helper, m.options), /Quit storytree/);
  assert.equal(existsSync(m.installDir), true, "nothing is removed while the app runs");
  rmSync(path.join(m.home, "app.json"));
  await openUninstaller("keep", m.helper, m.options);
  assert.equal(readFileSync(m.profile, "utf8"), "# the user's own\nexport EDITOR=vi\n");
  assert.deepEqual(readdirSync(m.home), ["pgdata"]);
  assert.equal(existsSync(m.installDir), false);
});
