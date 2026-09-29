/**
 * Capability 8 · Setup check: one test per contract 8.1-8.5 and 8.7 in the agent link story. Contract 8.6,
 * the live check with a real Claude Code and a real Codex, is subscription-billed, and is run once
 * by hand as the story's final proof rather than here.
 *
 * Each test works in a throwaway home: its own Claude Code config folder and Codex home, holding
 * settings of the user's own that the setup check must leave alone, and a storytree home that says
 * where storytree listens (a copy of the test Postgres's owner record) or how to open it.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as connectTo, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { runSetupCheck, setUpProject } from "../index.js";
import { buildBins } from "../bins/build.js";
import { locateStorytree, MARKER_FILE } from "../routing/index.js";
import { claudeCode, codex, withAgent } from "../testing/agent.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { ghState, machineState, putCommandOnPath, registerHooks, removeCommand, removeHooks, type GhState, type HookCommand, type Homes } from "./index.js";

const STUB_APP = fileURLToPath(new URL("../testing/stub-app.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../hooks/fixtures/", import.meta.url));

/** A hook command as the setup check registers it: registering never runs it. */
const HOOK: HookCommand = { node: process.execPath, script: path.join(tmpdir(), "storytree", "dist", "storytree-hook.mjs") };

let bins: string;
let hookScript: string;

before(async () => {
  bins = mkdtempSync(path.join(tmpdir(), "storytree-link-bins-"));
  hookScript = (await buildBins(bins))["storytree-hook"]!;
});

after(() => {
  rmSync(bins, { recursive: true, force: true });
});

/**
 * What gh and the machine answer, for tests about something else: asking this machine's own gh,
 * Claude Code and Codex is slow, differs between machines, and once hung the suite (2026-09-28).
 */
const ANSWERED = {
  gh: async () => "signed in" as const,
  machine: async () => ({ claude: "signed in", codex: "signed in", git: "present", node: { state: "ok", version: "v24.1.0" }, waitMs: 5_000 }) as const,
};

/** The user's own settings, which the setup check must leave as they are. */
const CLAUDE_SETTINGS = {
  permissions: { allow: ["Bash(npm test:*)"] },
  model: "opus",
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
};
const CODEX_CONFIG = 'model = "gpt-5"\n\n[mcp_servers.storytree]\ncommand = "node"\nargs = ["storytree-mcp.mjs"]\n';

interface Home {
  homes: Required<Homes>;
  claudeSettings: string;
  codexConfig: string;
  codexHooks: string;
  /** A storytree home whose owner record says storytree listens where the test Postgres does. */
  storytreeHome: string;
}

/** A throwaway home with only the storytree tool server installed, and storytree running. */
function throwawayHome(dir: string): Home {
  const claude = path.join(dir, ".claude");
  const codexHome = path.join(dir, ".codex");
  const storytreeHome = path.join(dir, ".storytree", "0.3");
  for (const folder of [claude, codexHome, storytreeHome]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(claude, "settings.json"), `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
  writeFileSync(path.join(codexHome, "config.toml"), CODEX_CONFIG);
  copyFileSync(`${testServerDataDir()}.owner.json`, path.join(storytreeHome, "pgdata.owner.json"));
  return {
    homes: { claude, codex: codexHome },
    claudeSettings: path.join(claude, "settings.json"),
    codexConfig: path.join(codexHome, "config.toml"),
    codexHooks: path.join(codexHome, "hooks.json"),
    storytreeHome,
  };
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; args?: string[]; async?: boolean }[];
}

/** One of storytree's hook entries: its matcher, and whether the harness is left to go on without waiting for it. */
interface Registered {
  matcher: string;
  background: boolean;
}

/**
 * The events for which `settings` runs storytree's hook `script` for `harness`, each with its
 * entries: Claude Code runs it as a command with arguments (in the background when `async`), Codex
 * as one command line (handing its work to the background when it passes `--background`).
 */
function storytreeHooks(settings: Record<string, unknown>, script: string, harness: string): Record<string, Registered[]> {
  const events = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const found: Record<string, Registered[]> = {};
  for (const [event, entries] of Object.entries(events)) {
    for (const entry of entries) {
      const ours = entry.hooks.find((hook) =>
        hook.args !== undefined ? hook.args[0] === script && hook.args.includes(harness) : hook.command.includes(script) && hook.command.includes(harness),
      );
      if (ours === undefined) continue;
      const background = ours.async === true || (ours.args ?? ours.command.split(" ")).includes("--background");
      (found[event] ??= []).push({ matcher: entry.matcher ?? "", background });
    }
  }
  return found;
}

/** Whether `tool` is one `entry` runs for. Claude Code anchors a matcher of names; Codex's are regular expressions as written. */
function runsFor(entry: Registered | undefined, tool: string, anchored: boolean): boolean {
  return entry !== undefined && new RegExp(anchored ? `^(${entry.matcher})$` : entry.matcher).test(tool);
}

test("8.1 in a throwaway home with only the tool server installed, the first session start registers the hooks for Claude Code and for Codex without touching any other setting", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const report = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual(report.hooks, { "claude-code": "registered", codex: "registered", statusLine: "installed" });

    const claude = readJson(home.claudeSettings);
    assert.deepEqual({ ...claude, hooks: undefined, statusLine: undefined }, { ...CLAUDE_SETTINGS, hooks: undefined, statusLine: undefined }, "Claude Code's other settings are as they were");
    // The user has no status line of their own, so storytree's is installed: the hook script, run for the status line.
    const statusLine = claude.statusLine as { type: string; command: string };
    assert.equal(statusLine.type, "command");
    assert.ok(statusLine.command.includes(HOOK.script) && statusLine.command.endsWith(" statusline"), statusLine.command);
    const claudeHooks = claude.hooks as Record<string, HookEntry[]>;
    assert.deepEqual(claudeHooks.PreToolUse?.[0], CLAUDE_SETTINGS.hooks.PreToolUse[0], "and so is the user's own hook, still first");

    for (const [harness, events, anchored] of [
      ["claude-code", storytreeHooks(claude, HOOK.script, "claude-code"), true],
      ["codex", storytreeHooks(readJson(home.codexHooks), HOOK.script, "codex"), false],
    ] as const) {
      const failure = harness === "claude-code" ? ["PostToolUseFailure"] : [];
      assert.deepEqual(Object.keys(events).sort(), ["PostToolUse", ...failure, "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(), harness);
      const edits = harness === "claude-code" ? ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent", "Task"] : ["apply_patch", "Bash", "spawn_agent"];
      for (const tool of edits) assert.ok(runsFor(events.PostToolUse?.[0], tool, anchored), `${harness}: after ${tool}`);
      if (harness === "claude-code") assert.ok(runsFor(events.PostToolUseFailure?.[0], "Bash", anchored), "after a shell command that failed");
      // Without Git for Windows, Claude Code runs commands with its PowerShell tool instead of Bash.
      if (harness === "claude-code") {
        const shellBefore = (events.PreToolUse ?? []).find((entry) => entry.background);
        for (const [entry, when] of [[shellBefore, "before"], [events.PostToolUse?.[0], "after"], [events.PostToolUseFailure?.[0], "after a failed"]] as const)
          assert.ok(runsFor(entry, "PowerShell", anchored), `claude-code: ${when} a PowerShell command`);
      }

      // The harness waits for the hook before a storytree tool, so its line is written before the
      // call reaches the tool server; the one before a shell command never makes the agent wait.
      const before = events.PreToolUse ?? [];
      assert.equal(before.length, 2, `${harness}: two hooks before a tool`);
      const [tools, shell] = [before.find((entry) => !entry.background), before.find((entry) => entry.background)];
      assert.ok(runsFor(tools, "mcp__storytree__open", anchored) && !runsFor(tools, "Bash", anchored), `${harness}: in the foreground before a storytree tool, and no other`);
      assert.ok(runsFor(shell, "Bash", anchored) && !runsFor(shell, "mcp__storytree__open", anchored), `${harness}: in the background before a shell command, and no other`);
      assert.equal(events.Stop?.[0]?.background, true, `${harness}: in the background at the end of a turn`);
      // The one at each prompt adds the project's definitions for the agent, so the harness waits for it.
      assert.equal(events.UserPromptSubmit?.[0]?.background, false, `${harness}: in the foreground at each prompt`);
    }
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG, "Codex's config is untouched");
  });
});

test("8.2 a second start changes nothing, and removing storytree takes out exactly what it added", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    const first = { claude: readFileSync(home.claudeSettings, "utf8"), codex: readFileSync(home.codexHooks, "utf8") };

    const again = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual(again.hooks, { "claude-code": "already registered", codex: "already registered", statusLine: "already installed" });
    assert.deepEqual({ claude: readFileSync(home.claudeSettings, "utf8"), codex: readFileSync(home.codexHooks, "utf8") }, first, "not a byte changed");

    assert.deepEqual(removeHooks(home.homes), { "claude-code": "removed", codex: "removed", statusLine: "removed" });
    assert.deepEqual(readJson(home.claudeSettings), CLAUDE_SETTINGS, "Claude Code's settings are as they were before storytree");
    assert.equal(existsSync(home.codexHooks), false, "the hooks file storytree made is gone");
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG);
    assert.deepEqual(removeHooks(home.homes), { "claude-code": "none", codex: "none", statusLine: "none" }, "and removing again finds nothing");

    // An install from before the PowerShell tool was matched gets the new matchers at its next setup check.
    registerHooks(home.homes, HOOK);
    const older = readJson(home.claudeSettings);
    const olderHooks = older.hooks as Record<string, HookEntry[]>;
    for (const entry of Object.values(olderHooks).flat()) if (entry.matcher !== undefined) entry.matcher = entry.matcher.replace("|PowerShell", "");
    writeFileSync(home.claudeSettings, `${JSON.stringify(older, null, 2)}\n`);
    const upgraded = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.equal(upgraded.hooks?.["claude-code"], "registered");
    assert.ok(runsFor(storytreeHooks(readJson(home.claudeSettings), HOOK.script, "claude-code").PostToolUseFailure?.[0], "PowerShell", true), "the older install now hears PowerShell");
    removeHooks(home.homes);

    // A registration from an older install, at another path, is replaced rather than doubled.
    registerHooks(home.homes, { ...HOOK, script: path.join(dir, "old", "storytree-hook.mjs") });
    registerHooks(home.homes, HOOK);
    assert.deepEqual(Object.keys(storytreeHooks(readJson(home.claudeSettings), path.join(dir, "old", "storytree-hook.mjs"), "claude-code")), []);
    assert.equal(Object.keys(storytreeHooks(readJson(home.claudeSettings), HOOK.script, "claude-code")).length, 7);
  });
});

/** Run one of storytree's registered hooks as `harness` runs it: Claude Code a program with arguments, Codex a line through this machine's shell. */
function runRegistered(harness: "claude-code" | "codex", hook: HookEntry["hooks"][number], input: string, storytreeHome: string): string {
  const env = { ...process.env, STORYTREE_HOME: storytreeHome };
  const [command, args] =
    harness === "claude-code" ? [hook.command, hook.args ?? []] : process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command", hook.command]] : ["sh", ["-c", hook.command]];
  const ran = spawnSync(command, args, { input, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(ran.status, 0, `${harness}: ${ran.stderr}`);
  return ran.stdout;
}

test("8.12 at the start of a session in a folder that isn't a storytree project, a hook the harness waits for tells the agent to ask the user whether to set storytree up; in a project, nothing, and nothing is ever set up", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    registerHooks(home.homes, { node: process.execPath, script: hookScript });
    const stopped = path.join(dir, "stopped-home");
    mkdirSync(stopped);
    const fresh = path.join(dir, "new-site");
    const project = path.join(dir, "site");
    for (const folder of [fresh, project]) mkdirSync(folder);
    writeFileSync(path.join(project, MARKER_FILE), `${JSON.stringify({ project: "site" })}\n`);

    for (const [harness, settings] of [["claude-code", home.claudeSettings], ["codex", home.codexHooks]] as const) {
      const starts = ((readJson(settings).hooks as Record<string, HookEntry[]>).SessionStart ?? []).flatMap((entry) => entry.hooks);
      // What reaches the agent: the output of the hooks the harness waits for (Claude Code's run in the background print nothing it reads).
      const told = (folder: string) => {
        const input = JSON.stringify({ ...readJson(path.join(FIXTURES, harness, "session-start-startup.json")), cwd: folder });
        return starts.filter((hook) => hook.async !== true).map((hook) => runRegistered(harness, hook, input, stopped)).filter((out) => out !== "");
      };
      const [asked, ...more] = told(fresh);
      assert.equal(more.length, 0, `${harness}: told once`);
      const output = JSON.parse(asked ?? "{}") as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
      assert.equal(output.hookSpecificOutput?.hookEventName, "SessionStart", harness);
      const context = output.hookSpecificOutput?.additionalContext ?? "";
      assert.ok(context.includes("set_up_project") && context.includes('"new-site"'), `${harness}: ${context}`);
      assert.deepEqual(told(project), [], `${harness}: nothing in a project`);
      for (const hook of starts.filter((hook) => hook.async === true)) {
        assert.equal(runRegistered(harness, hook, JSON.stringify({ ...readJson(path.join(FIXTURES, harness, "session-start-startup.json")), cwd: fresh }), stopped), "", `${harness}: nothing from the background`);
      }
    }
    assert.equal(existsSync(path.join(fresh, MARKER_FILE)), false, "the folder is not set up");
  });
});

test("8.3 with storytree closed, a session start opens it", async () => {
  await withTempDir(async (dir) => {
    const storytreeHome = path.join(dir, "storytree-home");
    mkdirSync(storytreeHome);
    const dataDir = path.join(storytreeHome, "pgdata");
    // How to open storytree, as the app records it: here, a stand-in that says where the test Postgres listens.
    const port = new URL(testServerUrl()).port;
    writeFileSync(path.join(storytreeHome, "app.json"), JSON.stringify({ command: process.execPath, args: [STUB_APP, dataDir, port] }));
    assert.equal(locateStorytree({ dataDir }).running, false, "closed to begin with");
    try {
      const report = await runSetupCheck({ ...ANSWERED, folder: dir, homes: {}, storytreeHome, openWaitMs: 20_000 });
      assert.deepEqual(report.storytree, { state: "opened", library: { url: testServerUrl() } });
      assert.deepEqual(locateStorytree({ dataDir }), { running: true, url: testServerUrl() });
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
    // The stand-in says where it listens at once, and starts listening only 1.5 s later.
    writeFileSync(path.join(storytreeHome, "app.json"), JSON.stringify({ command: process.execPath, args: [STUB_APP, dataDir, String(port), "1500"] }));
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

test("8.4 setup records the chosen project only after a successful yes, never on an existing-project check", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const storytree = await connect({ url: testServerUrl() });
    try {
      const choice = path.join(home.storytreeHome, "project-choice.json");
      await withAgent(folder, claudeCode("claude-1", { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { homes: home.homes, storytreeHome: home.storytreeHome } }), async (agent) => {
        const checked = await agent.call("check_setup");
        assert.equal(checked.isError, false, checked.text);
        assert.deepEqual(checked.data.project, { status: "ask", suggestion: name });
        assert.equal(existsSync(path.join(folder, MARKER_FILE)), false, "no marker before a yes");
        assert.equal((await storytree.listProjects()).includes(name), false, "no project before a yes");
        assert.equal(existsSync(choice), false, "no choice before a yes");
        const refused = await agent.call("set_up_project", { name: "Invalid Name" });
        assert.equal(refused.isError, true);
        assert.equal(existsSync(choice), false, "a refused setup records no choice");

        mkdirSync(choice); // an unwritable choice destination, on every supported OS
        const unsaved = await agent.call("set_up_project", { name });
        assert.equal(unsaved.isError, true, "setup cannot report success without saving the choice");
        assert.equal(existsSync(path.join(folder, MARKER_FILE)), false, "a failed choice write leaves setup retryable");
        rmSync(choice, { recursive: true });

        const yes = await agent.call("set_up_project", { name });
        assert.equal(yes.isError, false, yes.text);
        assert.deepEqual(readJson(path.join(folder, MARKER_FILE)), { project: name });
        assert.ok((await storytree.listProjects()).includes(name), "the project, once the user said yes");
        assert.equal(readJson(choice).current, name, "yes records the choice in the app's home");
        writeFileSync(choice, JSON.stringify({ current: "another-project" }));
        assert.deepEqual((await agent.call("check_setup")).data.project, { status: "set up", name });
        await agent.call("set_up_project", { name });
        assert.equal(readJson(choice).current, "another-project", "neither an existing-project check nor a repeated tool call chooses it");
      });
      await withAgent(folder, claudeCode("claude-2", { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { homes: home.homes, storytreeHome: home.storytreeHome } }), async (agent) => {
        await agent.call("check_setup");
        assert.equal(readJson(choice).current, "another-project", "an ordinary new agent session records no choice");
      });
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

test("8.10 a terminal runs the shared setup check with diagnostic lines and fixes, creating a project only on request", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const name = uniqueProjectName();
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const options = { ...ANSWERED, folder, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed out" as const };
    const storytree = await connect({ url: testServerUrl() });
    try {
      const report = await runSetupCheck(options);
      assert.equal(report.lines.find((line) => line.check === "storytree")?.state, "ok");
      assert.equal(report.lines.find((line) => line.check === "hooks")?.state, "fixed");
      assert.match(report.lines.find((line) => line.check === "gh")?.fix ?? "", /gh auth login/);
      assert.match(report.lines.find((line) => line.check === "project")?.fix ?? "", /only.*yes/i);
      assert.equal(existsSync(path.join(folder, MARKER_FILE)), false);
      assert.equal((await storytree.listProjects()).includes(name), false);

      await setUpProject({ folder, project: name, storytree, storytreeHome: home.storytreeHome }); // the terminal's explicit yes
      const ready = await runSetupCheck({ ...options, gh: async () => "signed in" as const });
      assert.deepEqual(ready.project, { status: "set up", name });
      assert.equal(ready.lines.find((line) => line.check === "project")?.state, "ok");
      assert.equal(ready.lines.find((line) => line.check === "gh")?.fix, undefined);

      const stopped = await runSetupCheck({ ...options, storytreeHome: path.join(dir, "not-running") });
      assert.match(stopped.lines.find((line) => line.check === "storytree")?.fix ?? "", /open the storytree app/i);
      assert.match(stopped.lines.find((line) => line.check === "gh")?.fix ?? "", /gh auth login/, "one failure does not hide another fix");
    } finally {
      await storytree.close();
      await dropTestProjects([name]);
    }
  });
});

test("8.5 the agent fires a test of each hook, and the connection shows as verified only when storytree has received every one; until then it names the missing hook and the fix", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    const setup = { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } };
    try {
      await withAgent(folder, claudeCode("claude-1", setup), async (agent) => {
        const check = async () => {
          const { verified, missing, fixes } = (await agent.call("check_setup")).data as { verified: boolean; missing: string[]; fixes: string[] };
          return { verified, missing, fixes };
        };
        assert.deepEqual(await check(), {
          verified: false,
          missing: ["session start", "storytree tool call", "file edit", "command"],
          fixes: ["new-session", "edit-check-file", "run-check-command"],
        });

        // The hooks fire, as Claude Code runs them for this session in this folder.
        await fireHook(home.storytreeHome, "claude-code", "session-start-startup", folder, "claude-1");
        assert.deepEqual((await check()).missing, ["storytree tool call", "file edit", "command"]);
        // The hook before each storytree tool call: calling check_setup fires it.
        await fireHook(home.storytreeHome, "claude-code", "pre-tool-use-storytree", folder, "claude-1");
        assert.deepEqual((await check()).missing, ["file edit", "command"]);
        await fireHook(home.storytreeHome, "claude-code", "post-tool-use-write", folder, "claude-1");
        assert.deepEqual((await check()).missing, ["command"]);
        await fireHook(home.storytreeHome, "claude-code", "post-tool-use-bash", folder, "claude-1");
        assert.deepEqual(await check(), { verified: true, missing: [], fixes: [] });
      });

      // A Codex session whose hooks have not run is told the one fix that is Codex's own: its one-time approval.
      await withAgent(folder, codex("codex-1", setup), async (agent) => {
        const { verified, missing, fixes } = (await agent.call("check_setup")).data as { verified: boolean; missing: string[]; fixes: string[] };
        assert.deepEqual({ verified, missing }, { verified: false, missing: ["session start", "storytree tool call", "file edit", "command"] });
        assert.ok(fixes.includes("codex-approval"), `the fixes name Codex's approval: ${fixes.join(", ")}`);
      });
    } finally {
      await dropTestProjects([project]);
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
  for (let waited = 0; waited < 5_000; waited += 100) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Run the built hook as `harness` runs it, with a recorded input moved to `folder` and `session`. */
function fireHook(storytreeHome: string, harness: string, fixture: string, folder: string, session: string): Promise<void> {
  const input = { ...(readJson(path.join(FIXTURES, harness, `${fixture}.json`)) as object), cwd: folder, session_id: session };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, harness], { env: { ...process.env, STORYTREE_HOME: storytreeHome }, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", () => resolve());
    child.stdin.end(JSON.stringify(input));
  });
}

test("8.7 a status line of the user's own is kept: storytree's is installed only where there is none, and removing storytree leaves theirs", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const theirs = { type: "command", command: "echo my own line" };
    writeFileSync(home.claudeSettings, `${JSON.stringify({ ...CLAUDE_SETTINGS, statusLine: theirs }, null, 2)}\n`);
    const report = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.equal(report.hooks?.statusLine, "the user's own kept");
    assert.deepEqual(readJson(home.claudeSettings).statusLine, theirs, "theirs, untouched");
    assert.equal(removeHooks(home.homes).statusLine, "none");
    assert.deepEqual(readJson(home.claudeSettings), { ...CLAUDE_SETTINGS, statusLine: theirs }, "and still theirs once storytree is removed");
  });
});

test("8.8 with gh missing, or signed out, the check says so and names the fix; signed in, it says nothing about it", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const said = async (gh: GhState): Promise<string> => {
      let text = "";
      const setup = { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => gh };
      await withAgent(dir, claudeCode("claude-1", { dataDir: path.join(home.storytreeHome, "pgdata"), setup }), async (agent) => {
        text = (await agent.call("check_setup")).text;
      });
      return text;
    };
    const missing = await said("missing");
    assert.match(missing, /gh/);
    assert.match(missing, /cli\.github\.com/, `names where to get it: ${missing}`);
    assert.match(await said("signed out"), /gh auth login/);
    assert.doesNotMatch(await said("signed in"), /\bgh\b/);
  });
});

test("8.9 in a throwaway home, the first start puts a storytree command on the path, a second changes nothing, and removing storytree takes it out", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const command = { path: bin, home: dir };
    const hook: HookCommand = { node: process.execPath, script: hookScript };
    const start = () => runSetupCheck({ ...ANSWERED, folder: dir, hook, homes: home.homes, storytreeHome: home.storytreeHome, command });
    const file = path.join(bin, process.platform === "win32" ? "storytree.cmd" : "storytree");

    assert.equal((await start()).command, "installed");
    // It runs as the user would run it: by its name, through their shell, found on the path.
    const ran = spawnSync("storytree", [], { shell: true, encoding: "utf8", env: { ...process.env, PATH: bin, Path: bin } });
    assert.match(`${ran.stdout}${ran.stderr}`, /storytree setup/, `it is storytree's command: ${ran.stdout}${ran.stderr}`);
    const first = readFileSync(file, "utf8");

    assert.equal((await start()).command, "already installed");
    assert.equal(readFileSync(file, "utf8"), first, "not a byte changed");

    assert.equal(removeCommand(command), "removed");
    assert.equal(existsSync(file), false);
    assert.equal(removeCommand(command), "none", "and removing again finds nothing");

    writeFileSync(file, "a storytree of the user's own\n");
    assert.equal((await start()).command, "another storytree kept");
    assert.equal(removeCommand(command), "none");
    assert.equal(readFileSync(file, "utf8"), "a storytree of the user's own\n", "theirs, untouched");
  });
});

test("8.9 storytree's own command in a folder outside the home is never touched: the command goes into the home's folder, and removing takes out only that one (regression: launcher.test rewrote developers' real command, 2026-09-29)", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const bin = path.join(home, ".local", "bin");
    const elsewhere = path.join(dir, "elsewhere", "bin");
    for (const folder of [bin, elsewhere]) mkdirSync(folder, { recursive: true });
    const name = process.platform === "win32" ? "storytree.cmd" : "storytree";
    // Another home's install of storytree, left by the setup check under a different HOME.
    const theirs = path.join(elsewhere, name);
    const hook: HookCommand = { node: process.execPath, script: hookScript };
    putCommandOnPath({ path: elsewhere, home: path.dirname(elsewhere) }, hook.node, path.join(dir, "an older storytree.mjs"));
    const before = readFileSync(theirs, "utf8");
    const command = { path: [bin, elsewhere].join(path.delimiter), home };

    assert.equal(putCommandOnPath(command, hook.node, path.join(path.dirname(hookScript), "storytree.mjs")), "installed");
    assert.ok(existsSync(path.join(bin, name)), "put in the home's folder");
    assert.equal(readFileSync(theirs, "utf8"), before, "the one outside the home, untouched");

    assert.equal(removeCommand(command), "removed");
    assert.equal(existsSync(path.join(bin, name)), false);
    assert.equal(readFileSync(theirs, "utf8"), before, "and still there after removing");
  });
});

test("8.9 setup remove exits cleanly through the Windows wrapper that it deletes (regression: storytree#83)", {
  skip: process.platform !== "win32" && "Windows-only: cmd.exe reads the .cmd wrapper again after setup remove deletes it",
}, async () => {
  await withTempDir(async (dir) => {
    const profile = path.join(dir, "user home");
    const home = throwawayHome(profile);
    const bin = path.join(profile, "bin");
    mkdirSync(bin);
    const env = {
      ...process.env,
      USERPROFILE: profile,
      CLAUDE_CONFIG_DIR: home.homes.claude,
      CODEX_HOME: home.homes.codex,
      STORYTREE_HOME: home.storytreeHome,
      PATH: bin,
      Path: bin,
    };
    const installed = spawnSync(process.execPath, [path.join(bins, "storytree.mjs"), "setup", "install"], { env, encoding: "utf8" });
    assert.equal(installed.status, 0, `${installed.stdout}${installed.stderr}`);
    const wrapper = path.join(bin, "storytree.cmd");
    assert.ok(existsSync(wrapper), "the real .cmd wrapper is installed on the path");

    const invalid = spawnSync("storytree setup invalid", { shell: true, env, cwd: profile, encoding: "utf8" });
    assert.equal(invalid.status, 2, "the wrapper preserves a failing command's exit code");
    const removed = spawnSync("storytree setup remove", { shell: true, env, cwd: profile, encoding: "utf8" });
    assert.equal(removed.status, 0, `${removed.stdout}${removed.stderr}`);
    assert.equal(existsSync(wrapper), false, "the wrapper is gone when the command returns");
    assert.deepEqual(readJson(home.claudeSettings), CLAUDE_SETTINGS);
    assert.equal(existsSync(home.codexHooks), false);
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG);
  });
});

/**
 * A command named `name` in `bin` that answers each argument line in `answers` with its output and
 * exit code, and waits without end for any other: a shell script on macOS and Linux, a batch file on
 * Windows, run by name as the check runs the user's own tools.
 */
function fakeTool(bin: string, name: string, answers: Record<string, { out?: string; code: number }>): void {
  if (process.platform === "win32") {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if "%*"=="${args}" (${out === undefined ? "" : `echo ${out}& `}exit /b ${code})`);
    writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\n${cases.join("\r\n")}\r\n"%SystemRoot%\\System32\\PING.EXE" -n 60 127.0.0.1 >nul\r\n`);
  } else {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if [ "$*" = "${args}" ]; then ${out === undefined ? "" : `echo '${out}'; `}exit ${code}; fi`);
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${cases.join("\n")}\nexec /bin/sleep 60\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
}

test("8.11 the check says whether Claude Code or Codex is installed and signed in, and whether git and a Node of at least 24 are present, naming each fix; a tool that does not answer is never waited on", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    // Claude Code is installed and signed out, Codex never answers, Node is too old, and git is not there.
    fakeTool(bin, "claude", { "--version": { out: "2.0.0 (Claude Code)", code: 0 }, "auth status": { code: 1 } });
    fakeTool(bin, "codex", {});
    fakeTool(bin, "node", { "--version": { out: "v20.11.0", code: 0 } });
    const check = () => runSetupCheck({ folder: dir, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, machine: () => machineState({ path: bin, waitMs: 2_000 }) });

    const started = Date.now();
    const report = await check();
    assert.ok(Date.now() - started < 15_000, `a tool that never answers is not waited on: ${Date.now() - started}ms`);
    const line = (name: string) => report.lines.find((each) => each.check === name);
    assert.equal(line("agent-cli")?.state, "needs-attention");
    assert.match(line("agent-cli")?.message ?? "", /Claude Code is installed and not signed in/);
    assert.match(line("agent-cli")?.message ?? "", /Codex did not answer/);
    assert.match(line("agent-cli")?.fix ?? "", /claude auth login/);
    assert.equal(line("git")?.state, "needs-attention");
    assert.match(line("git")?.fix ?? "", /git-scm\.com/);
    assert.equal(line("node")?.state, "needs-attention");
    assert.match(line("node")?.message ?? "", /v20\.11\.0/);
    assert.match(line("node")?.fix ?? "", /Node 24/);

    // Claude Code signed in, git and Node 24 there: nothing to fix, and Codex is not needed as well.
    fakeTool(bin, "claude", { "--version": { out: "2.0.0 (Claude Code)", code: 0 }, "auth status": { code: 0 } });
    fakeTool(bin, "git", { "--version": { out: "git version 2.50.0", code: 0 } });
    fakeTool(bin, "node", { "--version": { out: "v24.1.0", code: 0 } });
    const ready = await check();
    for (const name of ["agent-cli", "git", "node"]) {
      assert.equal(ready.lines.find((each) => each.check === name)?.state, "ok", `${name}: ${JSON.stringify(ready.lines)}`);
    }
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
