/**
 * Capability 8 · Setup check: the check's answer, in the app setup story (Session management's until ADR-0969 D3). Hook
 * registration's tests are Connect an agent's (./hooks-config.test.ts) and the command's on the path Built commands'
 * (./command.test.ts). Contract 8.6, the live check with a real Claude Code and a real Codex, is subscription-billed,
 * and is run once by hand as the story's final proof rather than here.
 *
 * Each test works in a throwaway home (../testing/homes.ts): its own Claude Code config folder and Codex home, holding
 * settings of the user's own that the setup check must leave alone, and a storytree home that says where storytree
 * listens (a copy of the test Postgres's owner record) or how to open it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect as connectTo, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect, type Line } from "@storytree/library";

import { noteCodexHookRan } from "@storytree/session-management";
import { locateStorytree, PROJECT_FILE, ROOT_MARKER_FILE } from "@storytree/project-and-caller";
import { withTempDir, writeMarker } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, placeTestServer, testServerRecordedUrl, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { waitUntil } from "@storytree/test-waits";

import { buildBins } from "../bins/build.js";
import { makeRepository, setUpProject } from "../project/making.js";
import { runSetupCheck } from "./index.js";
import { FIX_SENTENCES, ghState, launcherFile, machineState, putCommandOnPath, registerHooks, verifyHooks, type HookCommand } from "./index.js";
import { ANSWERED, fakeTool, HOOK, readJson, throwawayHome, type HookEntry } from "../testing/homes.js";

/** The stub app and the harness payload fixtures stay with Session management, whose hooks they feed. */
const AGENT_LINK_SRC = path.dirname(fileURLToPath(import.meta.resolve("@storytree/session-management")));
const STUB_APP = path.join(AGENT_LINK_SRC, "testing", "stub-app.mjs");
const FIXTURES = path.join(AGENT_LINK_SRC, "hooks", "fixtures") + path.sep;

let bins: string;
let hookScript: string;

before(async () => {
  bins = mkdtempSync(path.join(tmpdir(), "storytree-link-bins-"));
  hookScript = (await buildBins(bins))["storytree-hook"]!;
});

after(() => {
  rmSync(bins, { recursive: true, force: true });
});

test("8.43 the check registers hooks only for an agent already connected, or the one whose session asks; another agent on this computer has none of its files written, and is named as not connected with how to connect it, never as a fix (regression: the old test laptop's Codex wired from a Claude Code session, 2026-11-03)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    writeFileSync(home.codexConfig, 'model = "gpt-5"\n');
    const settings = readFileSync(home.claudeSettings, "utf8");

    // The tool server's own start-up check asks for no session: neither agent has storytree's hooks, so neither gets them.
    const start = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual(start.hooks, { "claude-code": "not connected", codex: "not connected", cursor: "not here", pi: "not here", antigravity: "not here", statusLine: "not here" });
    assert.equal(readFileSync(home.claudeSettings, "utf8"), settings, "Claude Code's settings are untouched");
    assert.equal(existsSync(path.join(home.homes.claude, "agents")), false, "and no builder agents are installed");

    // A Claude Code session asking connects Claude Code; Codex, never connected, is left alone and only named.
    const asked = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    assert.equal(asked.hooks?.["claude-code"], "registered");
    assert.equal(asked.hooks?.codex, "not connected");
    assert.equal(existsSync(home.codexHooks), false, "no hooks file is made for Codex");
    assert.equal(asked.codexServer, undefined, "and a Codex not connected is not told it lacks storytree's tool server");
    const codexLines = asked.lines.filter((line) => line.check === "hooks" && line.message.includes("Codex"));
    assert.deepEqual(codexLines.map((line) => line.state), ["note"], JSON.stringify(asked.lines));
    assert.match(codexLines[0]!.message, /Codex is on this computer and not connected to storytree.*Connect Codex.*storytree setup connect --codex/);

    // Once Codex carries storytree's hooks, any build's, the check keeps them current from any session.
    const old = path.join(dir, "old", "storytree-hook.mjs");
    registerHooks({ codex: home.homes.codex }, { ...HOOK, script: old });
    const later = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual([later.hooks?.["claude-code"], later.hooks?.codex, later.hooks?.replaced], ["already registered", "registered", { codex: [old] }]);

    // Pi and Antigravity CLI keep storytree's hooks in their own shapes: an extension, and a named hook. Antigravity's, an
    // older build's, makes it connected; a Pi with none is left alone and named.
    const homes = { ...home.homes, pi: path.join(dir, ".pi", "agent"), antigravity: path.join(dir, ".gemini") };
    for (const folder of [homes.pi, homes.antigravity]) mkdirSync(folder, { recursive: true });
    registerHooks({ antigravity: homes.antigravity }, { ...HOOK, script: old });
    const others = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes, storytreeHome: home.storytreeHome });
    assert.deepEqual([others.hooks?.pi, others.hooks?.antigravity, others.hooks?.replaced], ["not connected", "registered", { antigravity: [old] }]);
    assert.deepEqual(readdirSync(homes.pi), [], "nothing is written for Pi");
    assert.ok(others.lines.some((line) => line.state === "note" && line.message.includes("Pi is on this computer and not connected") && line.message.includes("storytree setup connect --pi")), JSON.stringify(others.lines));
    // Once Pi has storytree's extension, it is connected too.
    registerHooks({ pi: homes.pi }, { ...HOOK, script: old });
    assert.equal((await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes, storytreeHome: home.storytreeHome })).hooks?.pi, "registered");
  });
});

/** Run one of storytree's registered hooks as `harness` runs it: Claude Code a program with arguments, Codex a line through this machine's shell. */
function runRegistered(harness: "claude-code" | "codex", hook: HookEntry["hooks"][number], input: string, storytreeHome: string): string {
  // Codex's line reaches the shell in an environment variable, so the command spawned here is fixed text that runs it.
  const env = { ...process.env, STORYTREE_HOME: storytreeHome, ...(harness === "codex" ? { STORYTREE_HOOK_LINE: hook.command } : {}) };
  const [command, args] =
    harness === "claude-code" ? [hook.command, hook.args ?? []] : process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command", "Invoke-Expression $env:STORYTREE_HOOK_LINE"]] : ["sh", ["-c", 'eval "$STORYTREE_HOOK_LINE"']];
  // A cold Windows PowerShell and Node can take most of 10 s on CI; a hang still fails.
  const ran = spawnSync(command, args, { input, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(ran.status, 0, `${harness}: ${ran.stderr}`);
  return ran.stdout;
}

test("8.12 at the start of a session in a folder that isn't a storytree project, no hook adds anything for the agent (ADR-0752 D3), an older install's asking hook included; nothing is set up", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    registerHooks(home.homes, { node: process.execPath, script: hookScript });
    const stopped = path.join(dir, "stopped-home");
    mkdirSync(stopped);
    const fresh = path.join(dir, "new-site");
    mkdirSync(fresh);
    // An install from before ADR-0752 registered a second Claude Code start hook, which the harness waits for.
    const older = { type: "command", command: process.execPath, args: [hookScript, "claude-code", "--ask-setup"] };
    for (const [harness, settings] of [["claude-code", home.claudeSettings], ["codex", home.codexHooks]] as const) {
      const starts = [...((readJson(settings).hooks as Record<string, HookEntry[]>).SessionStart ?? []).flatMap((entry) => entry.hooks), ...(harness === "claude-code" ? [older] : [])];
      const input = JSON.stringify({ ...readJson(path.join(FIXTURES, harness, "session-start-startup.json")), cwd: fresh });
      for (const hook of starts) assert.equal(runRegistered(harness, hook, input, stopped), "", `${harness}: ${JSON.stringify(hook.args ?? hook.command)} says nothing`);
    }
    assert.equal(existsSync(path.join(fresh, PROJECT_FILE)), false, "the folder is not set up");
  });
});

test("8.3 with storytree closed, a session start opens it", async () => {
  await withTempDir(async (dir) => {
    const storytreeHome = path.join(dir, "storytree-home");
    mkdirSync(storytreeHome);
    const dataDir = path.join(storytreeHome, "pgdata");
    // How to open storytree, as the app records it: here, a stand-in that says where the test Postgres listens,
    // handing over its sign-in as the app does (the handoff waits beside a record the stand-in writes).
    const { port, token, auth } = placeTestServer(dataDir);
    rmSync(`${dataDir}.owner.json`);
    writeFileSync(path.join(storytreeHome, "app.json"), JSON.stringify({ command: process.execPath, args: [STUB_APP, dataDir, String(port), JSON.stringify({ token, auth })] }));
    assert.equal(locateStorytree({ dataDir }).running, false, "closed to begin with");
    try {
      const report = await runSetupCheck({ ...ANSWERED, folder: dir, homes: {}, storytreeHome, openWaitMs: 20_000 });
      assert.deepEqual(report.storytree, { state: "opened", library: { url: testServerRecordedUrl() } });
      assert.deepEqual(locateStorytree({ dataDir }), { running: true, url: testServerRecordedUrl() });
    } finally {
      const record = `${dataDir}.owner.json`;
      const { pid } = existsSync(record) ? (readJson(record) as { pid?: number }) : {};
      if (pid !== undefined) await stop(pid);
    }

    // With nothing saying how to open it, it says so rather than waiting.
    const unopenable = path.join(dir, "no-app");
    mkdirSync(unopenable);
    const report = await runSetupCheck({ ...ANSWERED, folder: dir, homes: {}, storytreeHome: unopenable, openWaitMs: 20_000 });
    assert.equal(report.storytree.state, "not running");
  });
});

test("opening storytree waits until it accepts connections, not only until it has said where it will listen (regression: the agent link's live check, 2026-09-26)", async () => {
  await withTempDir(async (dir) => {
    const storytreeHome = path.join(dir, "storytree-home");
    mkdirSync(storytreeHome);
    const dataDir = path.join(storytreeHome, "pgdata");
    const port = await freePort();
    // The stand-in says where it listens at once, and starts listening only 1.5 s later, handing over its sign-in as the app does.
    const { token, auth } = placeTestServer(dataDir, { port });
    rmSync(`${dataDir}.owner.json`);
    writeFileSync(path.join(storytreeHome, "app.json"), JSON.stringify({ command: process.execPath, args: [STUB_APP, dataDir, String(port), "1500", JSON.stringify({ token, auth })] }));
    try {
      const report = await runSetupCheck({ ...ANSWERED, folder: dir, homes: {}, storytreeHome, openWaitMs: 20_000 });
      assert.equal(report.storytree.state, "opened");
      assert.equal(await accepts(port), true, "it accepts a connection the moment it is reported opened");
    } finally {
      const record = `${dataDir}.owner.json`;
      const { pid } = existsSync(record) ? (readJson(record) as { pid?: number }) : {};
      if (pid !== undefined) await stop(pid);
    }
  });
});

test("8.10 a terminal runs the shared setup check with diagnostic lines and fixes, creating a project only on request", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const options = { ...ANSWERED, folder, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed out" as const, calling: "claude-code" as const };
    const storytree = await connect({ url: testServerUrl() });
    try {
      const report = await runSetupCheck(options);
      assert.equal(report.lines.find((line) => line.check === "storytree")?.state, "ok");
      assert.equal(report.lines.find((line) => line.check === "hooks")?.state, "fixed");
      assert.match(report.lines.find((line) => line.check === "transcripts")?.message ?? "", /secrets.*scrubbed.*best-effort.*180 days/is,
        "the check says transcripts leave the machine, and that the scrub is best-effort (ADR-0749 D4)");
      assert.deepEqual(noteOf(report.lines, "gh"), { state: "note", fix: undefined }, "gh is never a fix (owner, question_bb3efa1e3191)");
      assert.match(report.lines.find((line) => line.check === "project")?.fix ?? "", /only.*yes/i);
      assert.equal(existsSync(path.join(folder, PROJECT_FILE)), false);
      assert.equal((await storytree.listProjects()).includes(name), false);

      await setUpProject({ folder, project: name, storytree, storytreeHome: home.storytreeHome }); // the terminal's explicit yes
      const ready = await runSetupCheck({ ...options, gh: async () => "signed in" as const });
      assert.deepEqual(ready.project, { status: "set up", name });
      assert.equal(ready.lines.find((line) => line.check === "project")?.state, "ok");
      assert.equal(ready.lines.find((line) => line.check === "gh")?.fix, undefined);

      const stopped = await runSetupCheck({ ...options, storytreeHome: path.join(dir, "not-running") });
      assert.match(stopped.lines.find((line) => line.check === "storytree")?.fix ?? "", /open the storytree app/i);
      assert.deepEqual(noteOf(stopped.lines, "gh"), { state: "note", fix: undefined });
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

test("8.31 in a project with no git repository the check asks for one, made locally; with no origin remote it is ok: it names the steps that need one and the local route, verified health by a local run of its own tests, and never proposes making or pushing a remote; with an origin but no CI workflow storytree reads it names the local run too; with GitHub CI there, it says nothing of it", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const options = { ...ANSWERED, folder, homes: home.homes, storytreeHome: home.storytreeHome };
    const storytree = await connect({ url: testServerUrl() });
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, encoding: "utf8" });
    try {
      assert.equal((await runSetupCheck(options)).lines.find((line) => line.check === "repository"), undefined, "a folder that is no project is asked nothing of its repository");
      await setUpProject({ folder, project: name, storytree, storytreeHome: home.storytreeHome });

      const none = (await runSetupCheck(options)).lines.find((line) => line.check === "repository");
      assert.equal(none?.state, "needs-attention");
      assert.match(none?.message ?? "", /no git repository/);
      assert.match(none?.message ?? "", /review.*land/s);
      assert.match(none?.fix ?? "", /git init/);
      assert.match(none?.fix ?? "", /storytree health local/, "verified health is named as a local run");
      assert.doesNotMatch(none?.fix ?? "", /push|gh repo create/, "a remote is never proposed");

      git("init", "-q");
      git("add", ".storytree");
      git("commit", "-q", "-m", "first");
      const local = (await runSetupCheck(options)).lines.find((line) => line.check === "repository");
      assert.equal(local?.state, "ok", "a project with no origin is a working setup, not one needing attention");
      assert.equal(local?.fix, undefined);
      assert.match(local?.message ?? "", /no origin remote/);
      assert.match(local?.message ?? "", /review.*land.*health/s, "it names the steps that need a remote");
      assert.match(local?.message ?? "", /git diff/, "review goes on the local diff");
      assert.match(local?.message ?? "", /local commit/);
      assert.match(local?.message ?? "", /close the increment with a note/i);
      assert.match(local?.message ?? "", /storytree health local/, "verified health comes from a local run of the project's own tests");
      assert.doesNotMatch(local?.message ?? "", /unavailable/, "verified health is not said to be unavailable");
      assert.doesNotMatch(local?.message ?? "", /push|gh repo create|propose/, "a remote is never proposed");
      assert.equal(git("remote").stdout.trim(), "", "the check makes no remote");

      git("remote", "add", "origin", "https://github.com/someone/somewhere.git");
      const uncovered = (await runSetupCheck(options)).lines.find((line) => line.check === "repository");
      assert.equal(uncovered?.state, "ok", "an origin with no CI workflow is a working setup");
      assert.match(uncovered?.message ?? "", /no CI workflow/);
      assert.match(uncovered?.message ?? "", /storytree health local/, "its verified health comes from a local run of its own tests");
      assert.doesNotMatch(uncovered?.message ?? "", /no origin remote/);

      mkdirSync(path.join(folder, ".github", "workflows"), { recursive: true });
      writeFileSync(path.join(folder, ".github", "workflows", "ci.yml"), "on: push\n");
      assert.equal((await runSetupCheck(options)).lines.find((line) => line.check === "repository"), undefined, "a GitHub origin with a workflow is read from its CI, so nothing is said");

      git("remote", "set-url", "origin", "https://gitlab.com/someone/somewhere.git");
      assert.match((await runSetupCheck(options)).lines.find((line) => line.check === "repository")?.message ?? "", /storytree health local/, "a CI storytree cannot read, off GitHub, is no CI it reads");
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

test("8.40 a project whose marker is still a root .storytree.json is offered the move to .storytree/project.json, a git mv when git tracks it, and the check moves nothing; beside a .storytree/project.json the older one is named as ignored", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const options = { ...ANSWERED, folder, homes: home.homes, storytreeHome: home.storytreeHome };
    const storytree = await connect({ url: testServerUrl() });
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, encoding: "utf8" });
    const markerLine = async () => (await runSetupCheck(options)).lines.find((line) => line.check === "marker");
    try {
      await setUpProject({ folder, project: name, storytree, storytreeHome: home.storytreeHome });
      assert.equal(await markerLine(), undefined, "a project set up now is told nothing of its marker");

      const marker = readFileSync(path.join(folder, PROJECT_FILE));
      rmSync(path.join(folder, ".storytree"), { recursive: true });
      writeFileSync(path.join(folder, ROOT_MARKER_FILE), marker);
      const plain = await markerLine();
      assert.equal(plain?.state, "needs-attention");
      assert.match(plain?.message ?? "", /\.storytree\.json at its root/);
      assert.match(plain?.fix ?? "", /move \.storytree\.json to \.storytree\/project\.json/);
      assert.doesNotMatch(plain?.fix ?? "", /git mv/, "a marker git does not track is moved plainly");
      assert.ok(existsSync(path.join(folder, ROOT_MARKER_FILE)) && !existsSync(path.join(folder, PROJECT_FILE)), "the check moved nothing");

      git("init", "-q");
      git("add", ROOT_MARKER_FILE);
      git("commit", "-q", "-m", "first");
      assert.match((await markerLine())?.fix ?? "", /git mv \.storytree\.json \.storytree\/project\.json/, "a tracked marker is moved with git mv");

      writeMarker(folder, marker);
      const both = await markerLine();
      assert.equal(both?.state, "needs-attention");
      assert.match(both?.message ?? "", /reads \.storytree\/project\.json and ignores the other/);
      assert.match(both?.fix ?? "", /git rm \.storytree\.json/);
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

test("8.31 a project's repository begun with no git identity, its marker staged, gets its first commit from the check once git has one; until then the check asks the user for a name and email", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const options = { ...ANSWERED, folder, homes: home.homes, storytreeHome: home.storytreeHome };
    const storytree = await connect({ url: testServerUrl() });
    // Git reads no config of this machine's: the test chooses the identity, or none.
    const noConfig = path.join(dir, "no-gitconfig");
    writeFileSync(noConfig, "");
    const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { GIT_CONFIG_GLOBAL: noConfig, GIT_CONFIG_NOSYSTEM: "1" });
    const git = (...args: string[]) => spawnSync("git", args, { cwd: folder, encoding: "utf8" });
    try {
      await setUpProject({ folder, project: name, storytree, storytreeHome: home.storytreeHome });
      assert.equal(makeRepository(folder).state, "no identity");

      const waiting = (await runSetupCheck(options)).lines.filter((line) => line.check === "repository");
      assert.equal(waiting[0]?.state, "needs-attention");
      assert.match(waiting[0]?.message ?? "", /waiting for its first commit/);
      assert.match(waiting[0]?.fix ?? "", /ask the user for the name and email/i);
      assert.match(waiting[0]?.fix ?? "", /git config --global user\.name "<name>"/);
      assert.match(waiting[1]?.message ?? "", /no origin remote/, "the local route is still named");
      assert.equal(git("rev-list", "--all", "--count").stdout.trim(), "0");

      git("config", "user.name", "A User");
      git("config", "user.email", "user@example.invalid");
      const made = (await runSetupCheck(options)).lines.filter((line) => line.check === "repository");
      assert.equal(made[0]?.state, "fixed");
      assert.match(made[0]?.message ?? "", /first commit/);
      assert.equal(git("log", "--format=%an <%ae>").stdout.trim(), "A User <user@example.invalid>");
      assert.deepEqual(git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n"), [".storytree/.gitignore", PROJECT_FILE]);

      const after = (await runSetupCheck(options)).lines.filter((line) => line.check === "repository");
      assert.deepEqual(after.map((line) => line.state), ["ok"], "made once: then only the local route is left");
      assert.equal(git("rev-list", "--all", "--count").stdout.trim(), "1");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

/** A port nothing on 127.0.0.1 listens on just now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Whether something on 127.0.0.1:`port` accepts a connection within half a second. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTo({ port, host: "127.0.0.1", timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Kill process `pid`, and wait until it has gone. */
async function stop(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    return; // already gone
  }
  await waitUntil(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, 5_000, `process ${pid} to exit once killed`);
}

test("8.11 a Codex installed only as its desktop app, off the PATH, is found where the app keeps it or where Codex's config names it (regression: the owner's Windows laptop, 2026-09-29)", async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    const codexHome = path.join(dir, ".codex");
    for (const folder of [bin, codexHome]) mkdirSync(folder, { recursive: true });
    // Codex's CLI stand-in is a Node: `--version` answers, and `login status` fails as a signed-out Codex does.
    const desktopCodex = (file: string): string => {
      mkdirSync(path.dirname(file), { recursive: true });
      if (process.platform === "win32") copyFileSync(process.execPath, file);
      else symlinkSync(process.execPath, file);
      return file;
    };
    assert.equal((await machineState({ path: bin, waitMs: 10_000, codexHome, localAppData: path.join(dir, "Local") })).codex, "missing");

    // Where the desktop app installs its CLI: %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe.
    const localAppData = path.join(dir, "AppData", "Local");
    desktopCodex(path.join(localAppData, "OpenAI", "Codex", "bin", "3f2a9c", "codex.exe"));
    assert.equal((await machineState({ path: bin, waitMs: 10_000, codexHome, localAppData })).codex, "signed out");

    // Where Codex's config.toml names it.
    const named = desktopCodex(path.join(dir, "Programs", "codex.exe"));
    writeFileSync(path.join(codexHome, "config.toml"), `model = "gpt-5"\n\n[shell_environment_policy.set]\nCODEX_CLI_PATH = ${JSON.stringify(named)}\n`);
    assert.equal((await machineState({ path: bin, waitMs: 10_000, codexHome, localAppData: path.join(dir, "Local") })).codex, "signed out");
  });
});

test("8.11 on a Mac, a Codex installed only as its desktop app is found inside the Codex or ChatGPT app bundle, in each layout the app has shipped (increment_ebe913930972)", {
  skip: process.platform === "win32" && "platform:posix: the bundle's CLI is a bare `codex`, which Windows runs only as an .exe",
}, async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    const codexHome = path.join(dir, ".codex");
    for (const folder of [bin, codexHome]) mkdirSync(folder, { recursive: true });
    const options = { path: bin, waitMs: 10_000, codexHome, localAppData: path.join(dir, "Local") };
    const layouts = [
      ["Codex.app", "Contents", "Resources", "codex"],
      ["ChatGPT.app", "Contents", "Resources", "codex-cli", "bin", "codex"],
      ["ChatGPT.app", "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"],
    ];
    for (const [index, layout] of layouts.entries()) {
      const applications = path.join(dir, `Applications-${index}`);
      assert.equal((await machineState({ ...options, applications: [applications] })).codex, "missing", layout.join("/"));
      const file = path.join(applications, ...layout);
      mkdirSync(path.dirname(file), { recursive: true });
      symlinkSync(process.execPath, file);
      assert.equal((await machineState({ ...options, applications: [path.join(dir, "elsewhere"), applications] })).codex, "signed out", layout.join("/"));
    }
  });
});

test("8.23 the check's codex-server line judges the tool server a Codex session in this folder starts: missing where none is named, ok from the project's own .codex/config.toml, and not ok where Codex's entry names a removed install (regression: the owner's Windows laptop and the Mint box, 2026-09-29 and 2026-10-05)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const options = { ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "codex" as const };
    const codexServer = async (folder = dir) => (await runSetupCheck({ ...options, folder })).lines.find((line) => line.check === "codex-server");
    assert.equal((await codexServer())?.state, "ok");

    writeFileSync(home.codexConfig, 'model = "gpt-5"\n');
    const missing = await codexServer();
    assert.equal(missing?.state, "needs-attention");
    assert.match(missing?.fix ?? "", /storytree setup connect --codex/);

    // A 0.3 worktree: Codex reads the repository's own .codex/config.toml, from its root down to the session's folder, over its own.
    const repo = path.join(dir, "repo");
    const folder = path.join(repo, "packages", "app");
    for (const made of [path.join(repo, ".git"), path.join(repo, ".codex"), folder]) mkdirSync(made, { recursive: true });
    const projectConfig = path.join(repo, ".codex", "config.toml");
    writeFileSync(projectConfig, '[mcp_servers.storytree]\ncommand = "node"\nargs = ["packages/dev-loop/src/provision-worktree.mjs", "--serve"]\n');
    const served = await codexServer(folder);
    assert.equal(served?.state, "ok");
    assert.ok(served?.message.includes(projectConfig), served?.message);

    // A removed install: Codex would start a command, or a server file, that is not there.
    const gone = path.join(dir, "Programs", "storytree-0.3", "resources", "agent-tools");
    for (const [command, server] of [[path.join(gone, "node.exe"), path.join(gone, "storytree-mcp.mjs")], [process.execPath, path.join(gone, "storytree-mcp.mjs")]] as const) {
      writeFileSync(home.codexConfig, `model = "gpt-5"\n\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(command)}\nargs = [${JSON.stringify(server)}]\n\n[projects.'c:\\code']\ntrust_level = "trusted"\n`);
      const broken = await codexServer();
      assert.equal(broken?.state, "needs-attention");
      assert.ok(broken?.message.includes(command === process.execPath ? server : command), broken?.message);
      assert.match(broken?.fix ?? "", /\[mcp_servers\.storytree\]/);
    }
  });
});

test("8.16 until one of Codex's hooks has run, the check says Codex is waiting for the user to trust them, with the one step in plain words, also where it registers no hooks (the app's folder check); once one has run, it says they run", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const options = { ...ANSWERED, folder: dir, homes: home.homes, storytreeHome: home.storytreeHome };
    assert.equal((await runSetupCheck(options)).lines.find((line) => line.check === "codex-hooks"), undefined, "no line where Codex has none of storytree's hooks");

    await runSetupCheck({ ...options, hook: HOOK, calling: "codex" });
    for (const check of [{ ...options, hook: HOOK }, options]) {
      const line = (await runSetupCheck(check)).lines.find((each) => each.check === "codex-hooks");
      assert.equal(line?.state, "needs-attention");
      assert.match(line?.fix ?? "", /type \/hooks/);
      assert.match(line?.fix ?? "", /Hooks need review/);
    }

    noteCodexHookRan({ storytreeHome: home.storytreeHome, codexHome: home.homes.codex });
    const line = (await runSetupCheck({ ...options, hook: HOOK })).lines.find((each) => each.check === "codex-hooks");
    assert.equal(line?.state, "ok");
    assert.equal(line?.fix, undefined);
  });
});

test("8.17 from an administrator (elevated) terminal with Codex here, the check says Codex cannot run commands there and to open a normal terminal, and a Codex session missing only its command hook is told that instead of the command test; Claude Code alone, or a normal terminal, hears nothing of it", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const machine = (elevated: boolean, codex: "signed in" | "missing") => async () => ({ ...(await ANSWERED.machine()), codex, elevated });
    const check = (elevated: boolean, codex: "signed in" | "missing" = "signed in") => runSetupCheck({ ...ANSWERED, machine: machine(elevated, codex), folder: dir, homes: home.homes, storytreeHome: home.storytreeHome });
    const line = (await check(true)).lines.find((each) => each.check === "elevated");
    assert.equal(line?.state, "needs-attention");
    assert.match(line?.message ?? "", /administrator/);
    assert.match(line?.message ?? "", /Codex cannot run commands/);
    assert.match(line?.fix ?? "", /normal/);
    assert.equal((await check(false)).lines.find((each) => each.check === "elevated"), undefined);
    assert.equal((await check(true, "missing")).lines.find((each) => each.check === "elevated"), undefined, "Claude Code runs commands elevated; only Codex cannot");

    const hooked = ["session-started", "tool-requested", "file-edited"].map((kind) => ({ session: "s1", source: "hook", kind }) as Line);
    assert.deepEqual(verifyHooks(hooked, "s1", "codex", { elevated: true }).fixes, ["codex-elevated"]);
    assert.match(FIX_SENTENCES["codex-elevated"], /administrator/);
    assert.deepEqual(verifyHooks(hooked, "s1", "codex").fixes, ["run-check-command"]);
    assert.deepEqual(verifyHooks(hooked, "s1", "claude-code", { elevated: true }).fixes, ["run-check-command"]);
  });
});

test("8.17 an elevated process is recognised by its high integrity label", { skip: process.platform !== "win32" && "platform:win32: administrator elevation is Windows' own" }, async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    fakeTool(bin, "whoami", { "/groups /fo csv": { out: '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""', code: 0 } });
    assert.equal((await machineState({ path: bin, waitMs: 5_000 })).elevated, true);
    fakeTool(bin, "whoami", { "/groups /fo csv": { out: '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""', code: 0 } });
    assert.equal((await machineState({ path: bin, waitMs: 5_000 })).elevated, false);
  });
});

/** A line's state and fix, to pin that an optional tool is a note and never a fix. */
function noteOf(lines: readonly { check: string; state: string; fix?: string }[], check: string) {
  const line = lines.find((each) => each.check === check);
  return { state: line?.state, fix: line?.fix };
}

test("8.11 the check says whether Claude Code or Codex is installed and signed in, naming its fix, and notes a missing git or Node without making either a fix; a tool that does not answer is never waited on", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    // Claude Code is installed and signed out, Codex never answers, Node is too old, and git is not there.
    fakeTool(bin, "claude", { "--version": { out: "2.0.0 (Claude Code)", code: 0 }, "auth status": { code: 1 } });
    fakeTool(bin, "codex", {});
    fakeTool(bin, "node", { "--version": { out: "v20.11.0", code: 0 } });
    const check = (waitMs: number) => runSetupCheck({ folder: dir, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, machine: () => machineState({ path: bin, waitMs }) });

    // The bound is generous, so a fake run through a shell on a loaded machine or as a Windows .cmd still answers within it
    // (the product's own bound is shorter); Codex's fake waits a minute, so finishing well inside that proves it was left behind.
    const started = Date.now();
    const report = await check(10_000);
    assert.ok(Date.now() - started < 40_000, `a tool that never answers is not waited on: ${Date.now() - started}ms`);
    const line = (name: string) => report.lines.find((each) => each.check === name);
    assert.equal(line("agent-cli")?.state, "needs-attention");
    assert.match(line("agent-cli")?.message ?? "", /Claude Code is installed and not signed in/);
    assert.match(line("agent-cli")?.message ?? "", /Codex did not answer/);
    assert.match(line("agent-cli")?.fix ?? "", /claude auth login/);
    // Owner, 2026-09-29 (question_bb3efa1e3191): "dont list them as fixes". storytree runs on its own Node.
    assert.deepEqual(noteOf(report.lines, "git"), { state: "note", fix: undefined });
    assert.deepEqual(noteOf(report.lines, "node"), { state: "note", fix: undefined });

    // Claude Code signed in, git and Node 24 there: nothing to fix, and Codex is not needed as well.
    // Claude Code answers slower than the short bound above, as it does on a loaded machine starting
    // it, so this half waits as long as a busy machine needs; with no Codex there is nothing silent to wait on.
    fakeTool(bin, "claude", { "--version": { out: "2.0.0 (Claude Code)", code: 0 }, "auth status": { code: 0 } }, 3);
    fakeTool(bin, "git", { "--version": { out: "git version 2.50.0", code: 0 } });
    fakeTool(bin, "node", { "--version": { out: "v24.1.0", code: 0 } });
    rmSync(path.join(bin, process.platform === "win32" ? "codex.cmd" : "codex"));
    const ready = await check(15_000);
    for (const name of ["agent-cli", "git", "node"]) {
      assert.equal(ready.lines.find((each) => each.check === name)?.state, "ok", `${name}: ${JSON.stringify(ready.lines)}`);
    }
  });
});

test("8.46 the check says whether Cursor, Pi and Antigravity CLI are installed, each alone a harness storytree watches, and never that one is signed in, since Cursor's command line reports a lapsed sign-in as logged in", async () => {
  // Their command lines as measured (2026-10-12): Cursor's says "Logged in" whether or not it is; agy and pi answer their version signed in or not.
  const harnesses = [
    { harness: "cursor", folder: ".cursor", command: "cursor-agent", answers: { "--version": { out: "2026.07.09", code: 0 }, status: { out: "Logged in", code: 0 } }, name: "Cursor" },
    { harness: "pi", folder: path.join(".pi", "agent"), command: "pi", answers: { "--version": { out: "1.1.0", code: 0 } }, name: "Pi" },
    { harness: "antigravity", folder: ".gemini", command: "agy", answers: { "--version": { out: "1.3.3", code: 0 } }, name: "Antigravity CLI" },
  ] as const;
  for (const { harness, folder, command, answers, name } of harnesses) {
    await withTempDir(async (dir) => {
      const home = throwawayHome(dir);
      const agentHome = path.join(dir, folder);
      const bin = path.join(dir, "bin");
      for (const each of [agentHome, bin]) mkdirSync(each, { recursive: true });
      fakeTool(bin, command, answers);
      const check = () => runSetupCheck({
        folder: dir, hook: HOOK, homes: { ...home.homes, [harness]: agentHome }, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, calling: harness,
        machine: () => machineState({ path: bin, waitMs: 15_000, codexHome: home.homes.codex, localAppData: dir, applications: [] }),
      });

      const said = (await check()).lines.find((each) => each.check === "agent-cli");
      assert.equal(said?.state, "ok", `${name} alone is a harness storytree watches`);
      assert.match(said?.message ?? "", new RegExp(`${name} is installed`));
      assert.doesNotMatch(said?.message ?? "", new RegExp(`${name} is (installed and )?(not )?signed in`));

      rmSync(path.join(bin, process.platform === "win32" ? `${command}.cmd` : command));
      assert.match((await check()).lines.find((each) => each.check === "agent-cli")?.message ?? "", new RegExp(`${name} is not installed`));
    });
  }
});

test("8.47 an Antigravity CLI session, which sends no session start, passes the start test once any of its hook lines has arrived; a harness with a start still needs it", () => {
  const line = (kind: Line["kind"]) => ({ kind, session: "c1", harness: "antigravity", source: "hook" }) as unknown as Line;
  assert.deepEqual(verifyHooks([], "c1", "antigravity").missing, ["session start", "storytree tool call", "file edit", "command"], "nothing heard proves nothing");
  assert.deepEqual(verifyHooks([line("tool-requested")], "c1", "antigravity").missing, ["file edit", "command"], "its first line opens the session");
  assert.deepEqual(verifyHooks([line("tool-requested")], "c1", "claude-code").missing, ["session start", "file edit", "command"], "a harness with a start still needs it");
});

test("8.27 with neither Claude Code nor Codex ready, the agent-cli line's fix gives storytree's stdio server entry, in the mcpServers JSON shape, for any other harness with an MCP client to add by hand", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const missing = async () => ({ claude: "missing", codex: "missing", git: "present", node: { state: "ok", version: "v24.1.0" }, waitMs: 5_000 }) as const;
    const report = await runSetupCheck({ folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, machine: missing });
    const line = report.lines.find((each) => each.check === "agent-cli");
    assert.equal(line?.state, "needs-attention");
    const entry = /(\{[\s\S]*\})/.exec(line?.fix ?? "")?.[1];
    assert.ok(entry !== undefined, `an entry in the fix: ${line?.fix}`);
    assert.deepEqual(JSON.parse(entry), { mcpServers: { storytree: { type: "stdio", command: HOOK.node, args: [path.join(tmpdir(), "storytree", "dist", "storytree-mcp.mjs")] } } });
    assert.match(line?.fix ?? "", /Claude Code/, "installing a watched harness stays offered");
  });
});

test("8.11 a tool that exits while something it started still holds its output is not waited on (regression: gh auth status's tzutil, 2026-09-28)", { timeout: 30_000 }, async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    // `gh auth status` answers signed in, leaving behind a process that keeps its output open for 20s.
    if (process.platform === "win32") {
      writeFileSync(path.join(bin, "gh.cmd"), `@echo off\r\nstart "" /b "%SystemRoot%\\System32\\PING.EXE" -n 20 127.0.0.1\r\nexit /b 0\r\n`);
    } else {
      writeFileSync(path.join(bin, "gh"), "#!/bin/sh\n/bin/sleep 20 &\nexit 0\n");
      chmodSync(path.join(bin, "gh"), 0o755);
    }

    const started = Date.now();
    assert.equal(await ghState({ path: bin, waitMs: 10_000 }), "signed in");
    assert.ok(Date.now() - started < 10_000, `answered when gh exited, not at the deadline: ${Date.now() - started}ms`);
  });
});

test("8.11 a tool that answered while the check was busy reading synchronously is read as answering, not as missing its wait (regression: the owner's laptop, 2026-10-31)", { timeout: 30_000 }, async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    fakeTool(bin, "claude", { "--version": { out: "2.0.0 (Claude Code)", code: 0 }, "auth status": { code: 1 } });
    fakeTool(bin, "git", { "--version": { out: "git version 2.50.0", code: 0 } });

    const reading = machineState({ path: bin, waitMs: 300 });
    // The setup check reads the app's session records synchronously beside the probes; here, for longer than the wait.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_500);
    const machine = await reading;
    assert.deepEqual({ claude: machine.claude, git: machine.git }, { claude: "signed out", git: "present" });
  });
});

test("8.13 the check says whether storytree can read which sessions the Claude desktop app and Codex keep and have archived; where it cannot, it says sessions here leave the list after the leave-after time instead, and never makes that a fix (ADR-0754 D4)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const options = { ...ANSWERED, folder: dir, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const };
    const absent = await runSetupCheck({ ...options, appPlaces: { claudeSessions: path.join(dir, "no-claude"), codexState: path.join(dir, "no-codex", "state_5.sqlite") } });
    const line = absent.lines.find((each) => each.check === "archives");
    assert.deepEqual({ state: line?.state, fix: line?.fix }, { state: "note", fix: undefined });
    assert.match(line?.message ?? "", /leave-after/);

    const sessions = path.join(dir, "Claude", "claude-code-sessions", "account", "org");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "local_1.json"), JSON.stringify({ cliSessionId: "one", isArchived: true }));
    const read = await runSetupCheck({ ...options, appPlaces: { claudeSessions: path.dirname(path.dirname(sessions)), codexState: path.join(dir, "no-codex", "state_5.sqlite") } });
    const readLine = read.lines.find((each) => each.check === "archives");
    assert.equal(readLine?.state, "ok");
    assert.match(readLine?.message ?? "", /Claude desktop app.*1 session/);
  });
});

test("8.18 the check says when the hooks run an older release than the latest, since the app updates them only while it runs, and says nothing is wrong when they run the latest (regression: the laptop's hooks ran v0.3.309 with v0.3.333 out, 2026-09-30)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const tools = path.join(dir, "Programs", "storytree-0.3", "resources", "agent-tools");
    mkdirSync(tools, { recursive: true });
    const hook: HookCommand = { node: process.execPath, script: path.join(tools, "storytree-hook.mjs") };
    writeFileSync(hook.script, "");
    const hooksLine = async (running: string) => {
      writeFileSync(path.join(tools, "release.json"), JSON.stringify({ version: running, commit: "abc1234" }));
      const report = await runSetupCheck({ ...ANSWERED, latestRelease: async () => "0.3.333", folder: dir, hook, homes: home.homes, storytreeHome: home.storytreeHome, openWaitMs: 0, calling: "claude-code" });
      return report.lines.find((line) => line.check === "hooks-release");
    };

    const behind = await hooksLine("0.3.309");
    assert.equal(behind?.state, "needs-attention");
    assert.match(behind?.message ?? "", /0\.3\.309.*0\.3\.333/);
    assert.match(behind?.fix ?? "", /open the storytree app/i);
    assert.equal((await hooksLine("0.3.333"))?.state, "ok");
  });
});

test("8.37 a look (the doctor without --repair) writes no file: each connected harness, the status line and the command say what registering would change, and the check's lines name --repair", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const homes = { ...home.homes, cursor: path.join(dir, ".cursor"), pi: path.join(dir, ".pi", "agent"), antigravity: path.join(dir, ".gemini") };
    for (const folder of [homes.cursor, homes.pi, homes.antigravity]) mkdirSync(folder, { recursive: true });
    // Cursor's hooks run another build's script, as an older install left them.
    const other = path.join(dir, "older", "storytree-hook.mjs");
    writeFileSync(path.join(homes.cursor, "hooks.json"), `${JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: `node ${other} cursor` }] } }, null, 2)}\n`);
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const hook: HookCommand = { node: process.execPath, script: hookScript };
    // Run from a Claude Code session's shell: Claude Code is the asking harness, and Cursor is connected by its older hooks (8.43).
    const check = (look: boolean) => runSetupCheck({ ...ANSWERED, folder: dir, hook, homes, storytreeHome: home.storytreeHome, command: { path: bin, home: dir }, look, calling: "claude-code" });
    const files = () => Object.fromEntries([homes.claude, homes.codex, homes.cursor, homes.pi, homes.antigravity, bin]
      .flatMap((folder) => readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)))
      .map((file) => [file, readFileSync(file, "utf8")]));
    const before = files();

    const looked = await check(true);

    assert.deepEqual(files(), before, "a look changes no file");
    assert.deepEqual(looked.hooks, {
      "claude-code": "would register", codex: "not connected", cursor: "would register", pi: "not connected", antigravity: "not connected",
      statusLine: "would install", replaced: { cursor: [other] },
    });
    assert.equal(looked.command, "would install");
    const line = (report: typeof looked, check: string) => report.lines.find((each) => each.check === check);
    for (const check of ["hooks", "status-line", "command"]) {
      assert.equal(line(looked, check)?.state, "needs-attention", check);
      assert.match(line(looked, check)?.fix ?? "", /storytree doctor --repair/, check);
    }
    assert.ok(line(looked, "hooks")?.message.includes(other), line(looked, "hooks")?.message);

    const repaired = await check(false);

    assert.equal(repaired.hooks?.cursor, "registered");
    assert.equal(line(repaired, "hooks")?.state, "fixed");
    assert.ok(line(repaired, "hooks")?.message.includes(`replacing another build's hooks, which ran ${other}`), line(repaired, "hooks")?.message);
    assert.equal(line(repaired, "status-line")?.state, "fixed");
    assert.equal(repaired.command, "installed");

    // storytree's command on the path, running another build: a look names it and leaves it.
    // Beside the built scripts, where a Windows launcher finds the program it is made from.
    const older = path.join(path.dirname(hookScript), "an older storytree.mjs");
    rmSync(path.join(bin, launcherFile()));
    putCommandOnPath({ path: bin, home: dir }, process.execPath, older);
    const launcher = readFileSync(path.join(bin, launcherFile()));
    const relooked = await check(true);
    assert.equal(relooked.command, `would replace ${path.join(bin, launcherFile())}, which runs ${older}`);
    assert.deepEqual(readFileSync(path.join(bin, launcherFile())), launcher, "the older launcher, untouched");
    assert.match(line(relooked, "command")?.fix ?? "", /storytree doctor --repair/);
  });
});

test("8.42 a folder whose marker names a project this computer's library lacks reads missing, with the one reading and a set-up fix only on the user's yes; once the library has the project, it reads set up", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, "checkout");
    mkdirSync(folder);
    // A marker committed on another computer, against another library: this one never had the project.
    writeFileSync(path.join(folder, ROOT_MARKER_FILE), `${JSON.stringify({ project: name, identity: "19697429" })}\n`);
    const options = { ...ANSWERED, folder, homes: home.homes, storytreeHome: home.storytreeHome };
    const storytree = await connect({ url: testServerUrl() });
    try {
      const missing = await runSetupCheck(options);
      assert.deepEqual(missing.project, { status: "missing", name });
      const line = missing.lines.find((each) => each.check === "project");
      assert.equal(line?.state, "needs-attention");
      assert.ok(line?.message.includes(`this computer's library has no project "${name}"`), line?.message);
      assert.match(line?.fix ?? "", /^Only after the user says yes, set this folder up here as a new project/);
      assert.equal(missing.lines.find((each) => each.check === "marker"), undefined, "a missing project's marker is not offered the move");

      await (await storytree.openProject(name)).close();
      assert.deepEqual((await runSetupCheck(options)).project, { status: "set up", name });
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});
