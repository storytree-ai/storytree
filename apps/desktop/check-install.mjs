// Windows packaging proof: install the built NSIS payload, run its Electron and Postgres
// binaries, verify the shipped license (app setup 4.2), and uninstall. No real app data,
// update feed or release is used.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkEmbeddingBinaries, checkTools } from "./check-tools.mjs";

const release = path.resolve("apps/desktop/release");
const installer = readdirSync(release).find((file) => file.endsWith("-setup.exe"));
assert.ok(installer, "NSIS installer was not built");
assert.equal(process.platform, "win32", "Run this proof on Windows");
const version = process.env.STORYTREE_RELEASE_VERSION ?? JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const temp = mkdtempSync(path.join(tmpdir(), "storytree-installer-"));
const installed = path.join(temp, "app with spaces");
const license = readFileSync("LICENSE");

/**
 * App setup 1.8, through the real NSIS uninstaller, for a temporary user whose home this
 * installation's delivery record owns. Reinstalling (the path every update takes: the old
 * uninstaller runs with --updated) must remove nothing; uninstalling then removes all of it.
 */
function checkUninstall(tools) {
  const user = path.join(temp, "leaving user");
  const home = path.join(user, ".storytree", "0.3");
  const claude = path.join(user, ".claude");
  const localAppData = path.join(user, "AppData", "Local");
  const project = path.join(user, "My Project");
  const cacheName = /^updaterCacheDirName:\s*['"]?([^'"\r\n]+)/m.exec(readFileSync(path.join(installed, "resources", "app-update.yml"), "utf8"))[1];
  const cache = path.join(localAppData, cacheName);
  for (const dir of [path.join(home, "pgdata"), path.join(home, "bin"), claude, project, cache]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(home, "pgdata", "PG_VERSION"), "17");
  writeFileSync(path.join(home, "delivery.json"), JSON.stringify({ schema: 1, installDir: installed }));
  writeFileSync(path.join(home, "bin", "storytree.cmd"), "rem storytree 0.3's command (put here by its setup check)\r\n");
  const other = { type: "http", url: "https://example.test/mcp" };
  const claudeFile = path.join(claude, ".claude.json");
  const ours = { type: "stdio", command: path.join(tools, "node.exe"), args: [path.join(tools, "storytree-mcp.mjs")], env: {} };
  writeFileSync(claudeFile, JSON.stringify({ theme: "dark", mcpServers: { other, storytree: ours } }));
  writeFileSync(path.join(project, "notes.md"), "the user's work");
  const env = { ...process.env, USERPROFILE: user, STORYTREE_HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: path.join(user, ".codex"), LOCALAPPDATA: localAppData };

  execFileSync(path.join(release, installer), ["/S", `/D=${installed}`], { timeout: 180_000, env });
  assert.ok(existsSync(path.join(home, "pgdata", "PG_VERSION")) && existsSync(cache), "an update's uninstall leaves the home and cache");
  assert.deepEqual(JSON.parse(readFileSync(claudeFile, "utf8")).mcpServers.storytree, ours, "an update's uninstall leaves the agent connection");

  const asks = spawnSync(path.join(tools, "node.exe"), [path.join(tools, "storytree-deliver.mjs"), "uninstall-asks", installed], { encoding: "utf8", env });
  assert.equal(asks.status, 0, `the installation owns the home it delivered: ${asks.stdout}${asks.stderr}`);

  // What `storytree setup uninstall --remove-library` runs. The uninstaller it starts relaunches from a
  // copy and returns at once, so the proof waits for the app's own files to go.
  const opened = spawnSync(path.join(tools, "node.exe"), [path.join(tools, "storytree-deliver.mjs"), "open-uninstaller", "remove"], { encoding: "utf8", env });
  assert.equal(opened.status, 0, `the uninstall command starts the uninstaller: ${opened.stdout}${opened.stderr}`);
  const deadline = Date.now() + 180_000;
  while ((existsSync(path.join(installed, "storytree-0.3.exe")) || existsSync(home)) && Date.now() < deadline) execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  if (existsSync(home)) console.log(`after uninstall, the user's folder holds:\n  ${readdirSync(user, { recursive: true }).join("\n  ")}\n.claude.json: ${readFileSync(claudeFile, "utf8")}`);
  assert.ok(!existsSync(home) && !existsSync(path.join(user, ".storytree")), "the home and library are removed");
  assert.ok(!existsSync(cache), "the update cache is removed");
  assert.deepEqual(JSON.parse(readFileSync(claudeFile, "utf8")), { theme: "dark", mcpServers: { other } }, "only storytree's connection is removed");
  assert.equal(readFileSync(path.join(project, "notes.md"), "utf8"), "the user's work");
  assert.ok(!existsSync(path.join(installed, "storytree-0.3.exe")), "the app is removed");
  console.log("app setup 1.8 PASS (Windows x64): an update keeps storytree's home and connection; the uninstaller removes the app, home, library, update cache and Claude Code connection, and leaves the project and other settings");
}

try {
  execFileSync(path.join(release, installer), ["/S", `/D=${installed}`], { timeout: 180_000 });
  assert.deepEqual(readFileSync(path.join(installed, "resources", "LICENSE")), license, "the installed app carries the repository license unchanged");
  assert.deepEqual(readFileSync(path.join(release, "win-arm64-unpacked", "resources", "LICENSE")), license, "the arm64 portable payload carries the same license");
  assert.equal(readFileSync(path.join(installed, "resources", "storytree-installed"), "utf8"), "nsis");
  const update = readFileSync(path.join(installed, "resources", "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const archive = path.join(installed, "resources", "app.asar");
  const result = execFileSync(path.join(installed, "storytree-0.3.exe"), ["--eval", `console.log(require(${JSON.stringify(`${archive}/package.json`)}).version)`], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.trim(), version);
  const postgres = execFileSync(path.join(installed, "resources", "postgres", "bin", "postgres.exe"), ["--version"], { encoding: "utf8", timeout: 30_000 });
  assert.match(postgres, /PostgreSQL/);
  const tools = path.join(installed, "resources", "agent-tools");
  checkEmbeddingBinaries(tools, "x64");
  const node = path.join(tools, "node.exe");
  const runtime = execFileSync(node, ["-p", "JSON.stringify({arch:process.arch,version:process.versions.node})"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(JSON.parse(runtime).arch, process.arch);
  assert.match(JSON.parse(runtime).version, /^24\./);
  await checkTools(node, tools, path.join(temp, "fresh user"));
  // An x64 CI host cannot execute arm64 Node; inspect its PE architecture and manifest instead.
  const armTools = path.join(release, "win-arm64-unpacked", "resources", "agent-tools");
  checkEmbeddingBinaries(armTools, "arm64");
  const armNode = readFileSync(path.join(armTools, "node.exe"));
  assert.equal(armNode.readUInt16LE(armNode.readUInt32LE(0x3c) + 4), 0xaa64, "arm64 payload contains native arm64 Node");
  // The command launcher (ADR-0854) is built for each payload's own architecture.
  for (const [dir, machine] of [[tools, 0x8664], [armTools, 0xaa64]]) {
    const launcher = readFileSync(path.join(dir, "storytree-launcher.exe"));
    assert.equal(launcher.readUInt16LE(launcher.readUInt32LE(0x3c) + 4), machine, `${dir} carries a command launcher for its architecture`);
  }
  assert.equal(JSON.parse(readFileSync(path.join(armTools, "payload.json"), "utf8")).arch, "arm64");
  execFileSync(node, [path.join(tools, "storytree-deliver.mjs"), "inspect", installed, process.arch], { timeout: 30_000 });
  assert.match(readFileSync(path.join(release, "latest.yml"), "utf8"), new RegExp(`version: ${version.replaceAll(".", "\\.")}(?:\\s|$)`));
  console.log(`4.4 PASS: NSIS installed ${version}; its Electron, Postgres and update configuration work`);
  console.log("app setup 4.2 PASS: the NSIS and arm64 portable payloads carry the same offline license");
  console.log("app setup 1.1 PASS (Windows x64): bundled Node, CLI, hook, setup and MCP run from an installed path with spaces; arm64 Node PE inspected, not executed");
  checkUninstall(tools);
} finally {
  const uninstaller = path.join(installed, "Uninstall storytree-0.3.exe");
  if (existsSync(uninstaller)) execFileSync(uninstaller, ["/S"], { timeout: 180_000 });
  rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
