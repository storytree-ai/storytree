// Windows packaging proof: install the built NSIS payload, start the installed app's own main once
// (4.17's start check), prove a sign-in callback reaches it (1.15: through the shell when the build offers sign-in), run its Postgres binaries, verify the shipped license (app setup 4.2), and
// uninstall. No real app data, update feed or release is used. The release workflow runs it before
// it publishes, so a release whose installed app cannot start never publishes.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkEmbeddingBinaries, checkTools } from "./check-tools.mjs";
import { startsCleanly } from "./src/main/start-check.ts";

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

/** The environment of a temporary user with an empty storytree home, for starting the installed app as Electron. */
function throwawayUser(name) {
  const user = path.join(temp, name);
  const home = path.join(user, ".storytree", "0.3");
  mkdirSync(home, { recursive: true });
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
  return { ...env, USERPROFILE: user, STORYTREE_HOME: home, LOCALAPPDATA: path.join(user, "AppData", "Local"), APPDATA: path.join(user, "AppData", "Roaming") };
}

/**
 * Lifecycle 1.15, in the installed app: under `--callback-check` the first start holds the single-instance
 * lock and reports each sign-in callback a later start hands it, and where it went. A build stamped with a
 * WorkOS client ID offers sign-in, so the first start registers the storytree-auth scheme and the callback
 * is opened through the shell (`start storytree-auth://…`, as a browser's redirect reaches the app); it must
 * reach the sign-in session. An unstamped build registers no scheme, so a second start carries the callback
 * as its argument and the first reports that no sign-in takes it. No live sign-in.
 */
async function checkCallbackDelivery(env) {
  const exe = path.join(installed, "storytree-0.3.exe");
  const code = "fabricated-code-0f3a";
  const offered = Boolean(process.env.STORYTREE_WORKOS_CLIENT_ID);
  const first = spawn(exe, ["--callback-check"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  const heard = (pattern, what) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { first.stdout.off("data", listen); reject(new Error(`the running app did not report ${what} within 60 s: ${said.trim()}`)); }, 60_000);
    const listen = () => { if (pattern.test(said)) { clearTimeout(timer); first.stdout.off("data", listen); resolve(); } };
    first.stdout.on("data", listen);
    listen();
  });
  first.stdout.on("data", (chunk) => { said += chunk.toString("utf8"); });
  first.stderr.on("data", (chunk) => { said += chunk.toString("utf8"); });
  const exited = new Promise((resolve) => first.on("exit", (status) => resolve(status)));
  try {
    await heard(/callback check: waiting for sign-in callbacks/, "that it was waiting for callbacks");
    const callback = `storytree-auth://callback?code=${code}&state=x`;
    // cmd.exe /d /s /c "start "" "<callback>"": the quotes keep the callback's & from cmd.
    const second = offered
      ? spawnSync(`start "" "${callback}"`, { env, shell: true, windowsHide: true, timeout: 60_000, encoding: "utf8" })
      : spawnSync(exe, [callback], { env, windowsHide: true, timeout: 60_000, encoding: "utf8" });
    assert.equal(second.status, 0, `${offered ? "the shell opens the callback" : "the second start hands its callback over and exits"}: ${second.error ?? ""}${second.stdout}${second.stderr}`);
    const outcome = offered ? "reached the sign-in session" : "this build offers no sign-in";
    await heard(new RegExp(`sign-in callback received: storytree-auth://callback; ${outcome}`), `the callback (${outcome})`);
    assert.ok(!said.includes(code), "the report never prints the callback's code");
    const quit = spawnSync(exe, ["--quit"], { env, windowsHide: true, timeout: 60_000 });
    assert.equal(quit.status, 0, "a --quit start reaches the running app");
    assert.equal(await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve("still running"), 30_000))]), 0, `the callback check ends on --quit: ${said.trim()}`);
  } finally {
    if (first.exitCode === null) first.kill();
  }
  console.log(`1.15 PASS (Windows x64): ${offered ? "a storytree-auth callback opened through the shell" : "a second start's storytree-auth callback"} reached the installed app's running instance, which reported it (${offered ? "routed to the sign-in session" : "no sign-in offered by this build"})`);
}

try {
  execFileSync(path.join(release, installer), ["/S", `/D=${installed}`], { timeout: 180_000 });
  assert.deepEqual(readFileSync(path.join(installed, "resources", "LICENSE")), license, "the installed app carries the repository license unchanged");
  assert.deepEqual(readFileSync(path.join(release, "win-arm64-unpacked", "resources", "LICENSE")), license, "the arm64 portable payload carries the same license");
  assert.equal(readFileSync(path.join(installed, "resources", "storytree-installed"), "utf8"), "nsis-stable");
  const update = readFileSync(path.join(installed, "resources", "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const archive = path.join(installed, "resources", "app.asar");
  const result = execFileSync(path.join(installed, "storytree-0.3.exe"), ["--eval", `console.log(require(${JSON.stringify(`${archive}/package.json`)}).version)`], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.trim(), version);
  // The installed app's real main, as Electron, with a throwaway home: it must reach its handlers and
  // exit 0 in time, with no promise rejection left unhandled (0.3.606 passed every check and died here).
  const cannotStart = await startsCleanly({ execPath: path.join(installed, "storytree-0.3.exe"), args: [], env: throwawayUser("starting user") });
  assert.equal(cannotStart, undefined, `the installed app cannot start: ${cannotStart}`);
  await checkCallbackDelivery(throwawayUser("signing-in user"));
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
  console.log("4.17 PASS (Windows x64): the installed app's main process started with a throwaway home, reached its handlers and exited 0");
  console.log("app setup 4.2 PASS: the NSIS and arm64 portable payloads carry the same offline license");
  console.log("app setup 1.1 PASS (Windows x64): bundled Node, CLI, hook, setup and MCP run from an installed path with spaces; arm64 Node PE inspected, not executed");
  checkUninstall(tools);
} finally {
  const uninstaller = path.join(installed, "Uninstall storytree-0.3.exe");
  if (existsSync(uninstaller)) execFileSync(uninstaller, ["/S"], { timeout: 180_000 });
  rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
