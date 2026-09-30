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
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect as connectTo, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { runSetupCheck, setUpProject } from "../index.js";
import { buildBins } from "../bins/build.js";
import { noteCodexHookRan } from "../hooks/index.js";
import { locateStorytree, MARKER_FILE } from "../routing/index.js";
import { claudeCode, codex, withAgent } from "../testing/agent.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { builtFromMain, ghState, machineState, putCommandOnPath, registerHooks, removeCommand, removeHooks, type GhState, type HookCommand, type Homes } from "./index.js";

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
      // A second, in the foreground, may ask the agent to close out (ADR-0758 D4): the harness reads what it prints.
      assert.equal(events.Stop?.[1]?.background, false, `${harness}: and in the foreground at the end of a turn`);
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

    // A registration from an older install, at another path, is replaced rather than doubled, and the check names the path it replaced.
    const old = path.join(dir, "old", "storytree-hook.mjs");
    registerHooks(home.homes, { ...HOOK, script: old });
    const moved = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual(moved.hooks?.replaced, { "claude-code": [old], codex: [old] });
    assert.ok(moved.lines.find((line) => line.check === "hooks")?.message.includes(old), JSON.stringify(moved.lines));
    assert.deepEqual(Object.keys(storytreeHooks(readJson(home.claudeSettings), path.join(dir, "old", "storytree-hook.mjs"), "claude-code")), []);
    assert.equal(Object.keys(storytreeHooks(readJson(home.claudeSettings), HOOK.script, "claude-code")).length, 7);
  });
});

/** Run one of storytree's registered hooks as `harness` runs it: Claude Code a program with arguments, Codex a line through this machine's shell. */
function runRegistered(harness: "claude-code" | "codex", hook: HookEntry["hooks"][number], input: string, storytreeHome: string): string {
  const env = { ...process.env, STORYTREE_HOME: storytreeHome };
  const [command, args] =
    harness === "claude-code" ? [hook.command, hook.args ?? []] : process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command", hook.command]] : ["sh", ["-c", hook.command]];
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
        assert.match(checked.text, /not a storytree project/);
        assert.match(checked.text, /Add project/);
        assert.match(checked.text, /storytree doctor --set-up/);
        assert.doesNotMatch(checked.text, /[Aa]sk the user|set_up_project/, "the agent is not told to offer setup (ADR-0752 D3)");
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
      assert.match(report.lines.find((line) => line.check === "transcripts")?.message ?? "", /secrets.*scrubbed.*best-effort.*180 days/is,
        "the check says transcripts leave the machine, and that the scrub is best-effort (ADR-0749 D4)");
      assert.deepEqual(noteOf(report.lines, "gh"), { state: "note", fix: undefined }, "gh is never a fix (owner, question_bb3efa1e3191)");
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
      assert.deepEqual(noteOf(stopped.lines, "gh"), { state: "note", fix: undefined });
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

test("8.8 with gh missing, signed out or signed in, the agent is never asked to install or sign in to it, in check_setup's text or its data", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const said = async (gh: GhState): Promise<string> => {
      let text = "";
      const setup = { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome, gh: async () => gh };
      await withAgent(dir, claudeCode("claude-1", { dataDir: path.join(home.storytreeHome, "pgdata"), setup }), async (agent) => {
        const checked = await agent.call("check_setup");
        // The data too: an agent reads it as closely as the text (Claude Code repeated a note from it, PR #263).
        text = `${checked.text} ${JSON.stringify(checked.data)}`;
      });
      return text;
    };
    // Owner, 2026-09-29 (question_bb3efa1e3191): "dont list them as fixes".
    for (const gh of ["missing", "signed out", "signed in"] as const) {
      const text = await said(gh);
      assert.doesNotMatch(text, /\bgh\b/, `${gh}: ${text}`);
    }
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

test("8.9 an older storytree launcher in the home that runs another build is repointed, and the check names it and what it ran before", async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const command = { path: bin, home: dir };
    const file = path.join(bin, process.platform === "win32" ? "storytree.cmd" : "storytree");
    const older = path.join(dir, "an older storytree.mjs");
    putCommandOnPath(command, process.execPath, older);

    const said = putCommandOnPath(command, process.execPath, path.join(path.dirname(hookScript), "storytree.mjs"));
    assert.equal(said, `installed (replaced ${file}, which ran ${older})`);
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

test("8.14 the check names Codex's storytree tool server as missing, with its fix, where Codex has none (regression: the owner's Windows laptop, 2026-09-29)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const options = { ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome };
    assert.equal((await runSetupCheck(options)).lines.find((line) => line.check === "codex-server")?.state, "ok");

    writeFileSync(home.codexConfig, 'model = "gpt-5"\n');
    const line = (await runSetupCheck(options)).lines.find((each) => each.check === "codex-server");
    assert.equal(line?.state, "needs-attention");
    assert.match(line?.fix ?? "", /storytree setup connect --codex/);
  });
});

test("8.16 until one of Codex's hooks has run, the check says Codex is waiting for the user to trust them, with the one step in plain words, also where it registers no hooks (the app's folder check); once one has run, it says they run", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const options = { ...ANSWERED, folder: dir, homes: home.homes, storytreeHome: home.storytreeHome };
    assert.equal((await runSetupCheck(options)).lines.find((line) => line.check === "codex-hooks"), undefined, "no line where Codex has none of storytree's hooks");

    await runSetupCheck({ ...options, hook: HOOK });
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

/** A line's state and fix, to pin that an optional tool is a note and never a fix. */
function noteOf(lines: readonly { check: string; state: string; fix?: string }[], check: string) {
  const line = lines.find((each) => each.check === check);
  return { state: line?.state, fix: line?.fix };
}

/**
 * A command named `name` in `bin` that answers each argument line in `answers` with its output and
 * exit code, and waits without end for any other: a shell script on macOS and Linux, a batch file on
 * Windows, run by name as the check runs the user's own tools. It answers after `delaySeconds`, as a
 * tool does on a loaded machine.
 */
function fakeTool(bin: string, name: string, answers: Record<string, { out?: string; code: number }>, delaySeconds = 0): void {
  if (process.platform === "win32") {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if "%*"=="${args}" (${out === undefined ? "" : `echo ${out}& `}exit /b ${code})`);
    const delay = delaySeconds > 0 ? `"%SystemRoot%\\System32\\PING.EXE" -n ${delaySeconds + 1} 127.0.0.1 >nul\r\n` : "";
    writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\n${delay}${cases.join("\r\n")}\r\n"%SystemRoot%\\System32\\PING.EXE" -n 60 127.0.0.1 >nul\r\n`);
  } else {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if [ "$*" = "${args}" ]; then ${out === undefined ? "" : `echo '${out}'; `}exit ${code}; fi`);
    const delay = delaySeconds > 0 ? `/bin/sleep ${delaySeconds}\n` : "";
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${delay}${cases.join("\n")}\nexec /bin/sleep 60\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
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

    const started = Date.now();
    const report = await check(2_000);
    assert.ok(Date.now() - started < 15_000, `a tool that never answers is not waited on: ${Date.now() - started}ms`);
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

/** A git checkout with one commit, which `origin/main` names too: a fresh worktree of main. */
function checkoutOfMain(dir: string): { folder: string; commit: string } {
  const folder = path.join(dir, "checkout");
  mkdirSync(folder);
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, encoding: "utf8" }).stdout.trim();
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { folder, commit: git("rev-parse", "HEAD") };
}

test("8.15 with no desktop app, a session whose tool server runs from a checkout at origin/main registers the hooks from a build of that commit kept in the storytree home; a checkout off main, or hooks the app installed, are left as they are (regression: the Mint box's hooks ran a build from 746caf1, 2026-09-30)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const { folder, commit } = checkoutOfMain(dir);
    const build = async (outdir: string) => {
      mkdirSync(outdir, { recursive: true });
      writeFileSync(path.join(outdir, "storytree-hook.mjs"), "");
    };
    const options = { checkout: folder, storytreeHome: home.storytreeHome, homes: home.homes, build };

    const hook = await builtFromMain(options);
    assert.ok(hook !== undefined, "a checkout at origin/main gives a hook to register");
    assert.equal(path.dirname(hook.script), path.join(home.storytreeHome, "agent-tools", commit), "built from main's commit, in the storytree home");
    assert.ok(existsSync(hook.script));
    await runSetupCheck({ ...ANSWERED, folder: dir, hook, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.ok(Object.keys(storytreeHooks(readJson(home.claudeSettings), hook.script, "claude-code")).length > 0, "Claude Code runs that build");

    // A branch with work on it is not main: its hooks are not what every session on the machine should run.
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "branch work"], { cwd: folder });
    assert.equal(await builtFromMain(options), undefined, "a checkout off main registers nothing");

    // Where the desktop app installed the hooks, its updater keeps them current: they stay the app's.
    spawnSync("git", ["reset", "-q", "--hard", commit], { cwd: folder });
    const app: HookCommand = { node: process.execPath, script: path.join(dir, "Programs", "storytree-0.3", "resources", "agent-tools", "storytree-hook.mjs") };
    registerHooks(home.homes, app);
    assert.equal(await builtFromMain(options), undefined, "hooks the app installed are kept");
  });
});
