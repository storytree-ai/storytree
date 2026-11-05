/**
 * Capability 2 · Connect an agent: hook registration, the half of connecting an agent the setup check also runs at
 * every session start. Registering storytree's hooks in each harness's own user-level settings (Claude Code, Codex,
 * Cursor, Pi and Antigravity CLI), keeping every setting of the user's own, and taking out exactly what it added.
 *
 * Each test works in a throwaway home (../testing/homes.ts).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

import { AFTER_TOOL, BACKGROUND, registeredHookScripts } from "@storytree/session-management";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { buildBins } from "../bins/build.js";
import { runSetupCheck } from "./index.js";
import { machineState, registerHooks, removeHooks } from "./index.js";
import { ANSWERED, CLAUDE_SETTINGS, CODEX_CONFIG, fakeTool, HOOK, readJson, runsFor, storytreeHooks, throwawayHome, type HookEntry } from "../testing/homes.js";

let bins: string;
let hookScript: string;

before(async () => {
  bins = mkdtempSync(path.join(tmpdir(), "storytree-link-bins-"));
  hookScript = (await buildBins(bins))["storytree-hook"]!;
});

after(() => {
  rmSync(bins, { recursive: true, force: true });
});

test("2.15 in a throwaway home with only the tool server installed, the first session start in Claude Code and in Codex registers that agent's hooks without touching any other setting", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const report = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    assert.deepEqual(report.hooks, { "claude-code": "registered", codex: "not connected", cursor: "not here", pi: "not here", antigravity: "not here", statusLine: "installed" });
    const codex = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "codex" });
    assert.deepEqual(codex.hooks, { "claude-code": "already registered", codex: "registered", cursor: "not here", pi: "not here", antigravity: "not here", statusLine: "already installed" });

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
      // Claude Code also says when a command failed, and when a subagent finished, which its end line records (3.55).
      const claudeOnly = harness === "claude-code" ? ["PostToolUseFailure", "SubagentStop"] : [];
      assert.deepEqual(Object.keys(events).sort(), ["PostToolUse", ...claudeOnly, "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(), harness);
      if (harness === "claude-code") assert.ok(events.SubagentStop?.every((entry) => entry.background), "a subagent's end is recorded in the background");
      // And after each tool that reads outside text, whose line marks the session's later knowledge writes (3.49).
      const edits = harness === "claude-code"
        ? ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent", "Task", "WebFetch", "WebSearch", "mcp__github__get_issue", "mcp__claude_ai_Gmail__read_thread"]
        : ["apply_patch", "Bash", "spawn_agent"];
      for (const tool of edits) assert.ok(runsFor(events.PostToolUse?.[0], tool, anchored), `${harness}: after ${tool}`);
      assert.ok(!runsFor(events.PostToolUse?.[0], "mcp__storytree__open", anchored), `${harness}: not after a storytree tool`);
      if (harness === "claude-code") assert.ok(runsFor(events.PostToolUseFailure?.[0], "Bash", anchored), "after a shell command that failed");
      // Without Git for Windows, Claude Code runs commands with its PowerShell tool instead of Bash.
      if (harness === "claude-code") {
        const shellBefore = (events.PreToolUse ?? []).find((entry) => entry.background);
        for (const [entry, when] of [[shellBefore, "before"], [events.PostToolUse?.[0], "after"], [events.PostToolUseFailure?.[0], "after a failed"]] as const)
          assert.ok(runsFor(entry, "PowerShell", anchored), `claude-code: ${when} a PowerShell command`);
      }

      // The harness waits for the hook before a storytree tool, so its line is written before the
      // call reaches the tool server; the one before a shell command never makes the agent wait; and it
      // waits for the one before a file edit, whose answer may refuse the edit (ADR-0949 D3).
      const before = events.PreToolUse ?? [];
      assert.equal(before.length, 3, `${harness}: three hooks before a tool`);
      const [tools, shell, edit] = [before[0], before.find((entry) => entry.background), before[2]];
      const edited = harness === "claude-code" ? ["Write", "Edit", "MultiEdit", "NotebookEdit"] : ["apply_patch"];
      assert.ok(edit?.background === false && edited.every((tool) => runsFor(edit, tool, anchored)) && !runsFor(edit, "Bash", anchored), `${harness}: in the foreground before a file edit, and no other`);
      assert.ok(runsFor(tools, "mcp__storytree__open", anchored) && !runsFor(tools, "Bash", anchored), `${harness}: in the foreground before a storytree tool, and no other`);
      assert.ok(runsFor(shell, "Bash", anchored) && !runsFor(shell, "mcp__storytree__open", anchored), `${harness}: in the background before a shell command, and no other`);
      assert.equal(events.Stop?.[0]?.background, true, `${harness}: in the background at the end of a turn`);
      // A second, in the foreground, may ask the agent to close out (ADR-0758 D4): the harness reads what it prints.
      assert.equal(events.Stop?.[1]?.background, false, `${harness}: and in the foreground at the end of a turn`);
      // The one at each prompt adds the project's definitions for the agent, so the harness waits for it.
      assert.equal(events.UserPromptSubmit?.[0]?.background, false, `${harness}: in the foreground at each prompt`);
      // After a shell command, finished or failed, it waits for a guard that tells the agent of its changes to imported code (ADR-1015).
      for (const event of harness === "claude-code" ? ["PostToolUse", "PostToolUseFailure"] : ["PostToolUse"]) {
        const guards = (events[event] ?? []).filter((entry) => entry.guard);
        const shells = harness === "claude-code" ? ["Bash", "PowerShell"] : ["Bash"];
        assert.ok(guards.length === 1 && !guards[0]!.background && shells.every((tool) => runsFor(guards[0], tool, anchored)) && !runsFor(guards[0], edited[0]!, anchored), `${harness}: in the foreground after a shell command (${event}), and no other`);
      }
    }
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG, "Codex's config is untouched");
  });
});

test("2.16 a second start changes nothing, and removing storytree takes out exactly what it added", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "codex" });
    const first = { claude: readFileSync(home.claudeSettings, "utf8"), codex: readFileSync(home.codexHooks, "utf8") };

    const again = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome });
    assert.deepEqual(again.hooks, { "claude-code": "already registered", codex: "already registered", cursor: "not here", pi: "not here", antigravity: "not here", statusLine: "already installed" });
    assert.deepEqual({ claude: readFileSync(home.claudeSettings, "utf8"), codex: readFileSync(home.codexHooks, "utf8") }, first, "not a byte changed");

    assert.deepEqual(removeHooks(home.homes), { "claude-code": "removed", codex: "removed", cursor: "none", pi: "none", antigravity: "none", statusLine: "removed" });
    assert.deepEqual(readJson(home.claudeSettings), CLAUDE_SETTINGS, "Claude Code's settings are as they were before storytree");
    assert.equal(existsSync(home.codexHooks), false, "the hooks file storytree made is gone");
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG);
    assert.deepEqual(removeHooks(home.homes), { "claude-code": "none", codex: "none", cursor: "none", pi: "none", antigravity: "none", statusLine: "none" }, "and removing again finds nothing");

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
    assert.equal(Object.keys(storytreeHooks(readJson(home.claudeSettings), HOOK.script, "claude-code")).length, 8);
  });
});

test("2.16 the built storytree-setup install registers storytree's hooks, and remove takes out exactly what it added", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    // Every home it could reach is inside the throwaway folder, never the real one.
    const env = { PATH: bin, Path: bin, SystemRoot: process.env.SystemRoot ?? "", HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: home.homes.claude, CODEX_HOME: home.homes.codex, STORYTREE_HOME: home.storytreeHome };
    const setup = (command: string) => spawnSync(process.execPath, [path.join(bins, "storytree-setup.mjs"), command], { env, encoding: "utf8", timeout: 60_000 });

    const installed = setup("install");
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /^Claude Code: registered$/m, installed.stdout);
    assert.match(installed.stdout, /^Codex: registered/m, installed.stdout);
    // The command names its own hook by its real path (on macOS the temporary folder is a link into /private).
    assert.equal(Object.keys(storytreeHooks(readJson(home.claudeSettings), realpathSync(hookScript), "claude-code")).length, 8, "the hook built beside it is registered");

    const removed = setup("remove");
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /^Claude Code: storytree's hooks removed$/m, removed.stdout);
    assert.deepEqual(readJson(home.claudeSettings), CLAUDE_SETTINGS, "Claude Code's settings are as they were before storytree");
    assert.equal(existsSync(home.codexHooks), false, "the hooks file storytree made is gone");
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG);
  });
});

test("2.23 on Linux and macOS, the hook settings files and extension storytree creates in each harness's empty home are its owner's alone (0600), and one already there keeps its mode", {
  skip: process.platform === "win32" && "platform:posix: Windows has no owner-only file mode",
}, async () => {
  await withTempDir(async (dir) => {
    const homes = { claude: path.join(dir, ".claude"), codex: path.join(dir, ".codex"), cursor: path.join(dir, ".cursor"), pi: path.join(dir, ".pi", "agent"), antigravity: path.join(dir, ".gemini") };
    for (const folder of Object.values(homes)) mkdirSync(folder, { recursive: true });
    const kept = path.join(homes.claude, "settings.json");
    writeFileSync(kept, `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
    chmodSync(kept, 0o644);
    registerHooks(homes, HOOK);
    const made = Object.values(homes).flatMap((home) => readdirSync(home, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)));
    assert.ok(made.length >= 5, made.join("\n"));
    for (const file of made) assert.equal(statSync(file).mode & 0o777, file === kept ? 0o644 : 0o600, file);
  });
});

test("2.17 a status line of the user's own is kept: storytree's is installed only where there is none, and removing storytree leaves theirs", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const theirs = { type: "command", command: "echo my own line" };
    writeFileSync(home.claudeSettings, `${JSON.stringify({ ...CLAUDE_SETTINGS, statusLine: theirs }, null, 2)}\n`);
    const report = await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    assert.equal(report.hooks?.statusLine, "the user's own kept");
    assert.deepEqual(readJson(home.claudeSettings).statusLine, theirs, "theirs, untouched");
    assert.equal(removeHooks(home.homes).statusLine, "none");
    assert.deepEqual(readJson(home.claudeSettings), { ...CLAUDE_SETTINGS, statusLine: theirs }, "and still theirs once storytree is removed");
  });
});

test("2.18 the setup check registers storytree's hooks for Cursor where Cursor's home is, without touching any other setting, and they stay there when Cursor's command is gone", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const cursor = path.join(dir, ".cursor");
    const bin = path.join(dir, "bin");
    for (const folder of [cursor, bin]) mkdirSync(folder);
    const servers = '{"mcpServers":{"other":{"command":"npx"}}}';
    const own = { version: 1, hooks: { stop: [{ command: "./mine.sh" }] } };
    writeFileSync(path.join(cursor, "mcp.json"), servers);
    writeFileSync(path.join(cursor, "hooks.json"), JSON.stringify(own));
    // Cursor's command line, as measured on the owner's laptop (2026-10-12): it says it is logged in whether or not it is.
    fakeTool(bin, "cursor-agent", { "--version": { out: "2026.07.09", code: 0 }, status: { out: "Logged in", code: 0 } });
    const check = () => runSetupCheck({
      folder: dir, hook: HOOK, homes: { ...home.homes, cursor }, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, calling: "cursor",
      machine: () => machineState({ path: bin, waitMs: 15_000, codexHome: home.homes.codex, localAppData: dir, applications: [] }),
    });

    const report = await check();
    assert.equal(report.hooks?.cursor, "registered");
    const registered = readJson(path.join(cursor, "hooks.json")) as { version: number; hooks: Record<string, { command: string; matcher?: string }[]> };
    assert.equal(registered.version, 1);
    assert.deepEqual(registered.hooks.stop?.[0], own.hooks.stop[0], "the user's own hook is kept, still first");
    assert.equal(readFileSync(path.join(cursor, "mcp.json"), "utf8"), servers, "Cursor's tool servers are untouched");
    const ours = (event: string) => (registered.hooks[event] ?? []).filter((entry) => entry.command.includes(HOOK.script) && entry.command.split(" ").includes("cursor"));
    for (const event of ["sessionStart", "sessionEnd", "beforeSubmitPrompt", "beforeMCPExecution", "preToolUse", "postToolUse", "postToolUseFailure", "afterFileEdit", "subagentStart", "stop"]) {
      assert.ok(ours(event).length > 0, `Cursor: at ${event}`);
    }
    // Cursor waits for every hook: the one before a shell command hands its work on, the one before a file edit answers.
    const [shell, edit] = ours("preToolUse");
    assert.ok(new RegExp(shell!.matcher!).test("Shell") && shell!.command.endsWith(" --background"), "in the background before a shell command");
    assert.ok(new RegExp(edit!.matcher!).test("Write") && !new RegExp(edit!.matcher!).test("Shell") && !edit!.command.includes("--background"), "in the foreground before a file edit, and no other");

    assert.match(report.lines.find((each) => each.check === "hooks")?.message ?? "", /Cursor/);

    rmSync(path.join(bin, process.platform === "win32" ? "cursor-agent.cmd" : "cursor-agent"));
    const without = await check();
    assert.equal(without.hooks?.cursor, "already registered", "its hooks stay where its home is");
  });
});

test("2.20 the setup check registers storytree's named hook in Antigravity CLI's hooks.json where its home is, keeping every other, and removing storytree takes out its named hook alone", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const gemini = path.join(dir, ".gemini");
    const bin = path.join(dir, "bin");
    for (const folder of [gemini, bin]) mkdirSync(folder);
    // Antigravity CLI's command line, as measured on the Mint box (2026-10-12): it answers its version signed in or not.
    fakeTool(bin, "agy", { "--version": { out: "1.3.3", code: 0 } });
    const check = () => runSetupCheck({
      folder: dir, hook: HOOK, homes: { ...home.homes, antigravity: gemini }, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, calling: "antigravity",
      machine: () => machineState({ path: bin, waitMs: 15_000, codexHome: home.homes.codex, localAppData: dir, applications: [] }),
    });

    const report = await check();
    assert.equal(report.hooks?.antigravity, "registered", "its config folder is made where its home is");
    const hooksFile = path.join(gemini, "config", "hooks.json");
    const own = { reminder: { PreInvocation: [{ type: "command", command: "./remind.sh" }] } };
    writeFileSync(hooksFile, JSON.stringify({ ...own, ...(readJson(hooksFile) as object) }));
    assert.equal((await check()).hooks?.antigravity, "already registered");
    const registered = readJson(hooksFile) as Record<string, Record<string, unknown[]>>;
    assert.deepEqual(registered.reminder, own.reminder, "another named hook is kept");
    assert.deepEqual(Object.keys(registered.storytree!).sort(), ["PostToolUse", "PreToolUse", "Stop"]);

    assert.equal(removeHooks({ antigravity: gemini }).antigravity, "removed");
    assert.deepEqual(readJson(hooksFile), own, "removing storytree takes out its named hook alone");
  });
});

test("2.19 the setup check installs storytree's Pi extension where Pi's agent folder is; the extension, loaded as Pi loads it, forwards Pi's events to the hook script and hands Pi back its refusal and its close-out request; removing storytree deletes it", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const pi = path.join(dir, ".pi", "agent");
    const bin = path.join(dir, "bin");
    for (const folder of [pi, bin]) mkdirSync(folder, { recursive: true });
    const servers = '{"mcpServers":{"other":{"command":"npx"}}}';
    writeFileSync(path.join(pi, "mcp.json"), servers);
    mkdirSync(path.join(pi, "extensions"));
    writeFileSync(path.join(pi, "extensions", "mine.ts"), "export default function () {}\n");
    // A hook script standing in for storytree's: it notes each run, refuses every edit it is asked about, and asks every settling run to close out.
    const heard = path.join(dir, "heard.jsonl");
    const script = path.join(dir, "tools", "storytree-hook.mjs");
    mkdirSync(path.dirname(script));
    writeFileSync(script, `import { appendFileSync, readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(${JSON.stringify(heard)}, JSON.stringify({ args: process.argv.slice(2), input }) + "\\n");
if (process.argv.includes("--edit-gate")) process.stdout.write(JSON.stringify({ block: true, reason: "held by another session" }));
if (process.argv.includes("--close-out-reminder")) process.stdout.write(JSON.stringify({ entries: [{ type: "custom_message", customType: "storytree-close-out", content: "close out", display: true }], continue: true }));
`);
    const hook = { node: process.execPath, script };
    fakeTool(bin, "pi", { "--version": { out: "1.1.0", code: 0 } });
    const check = () => runSetupCheck({
      folder: dir, hook, homes: { ...home.homes, pi }, storytreeHome: home.storytreeHome, gh: async () => "signed in" as const, calling: "pi",
      machine: () => machineState({ path: bin, waitMs: 15_000, codexHome: home.homes.codex, localAppData: dir, applications: [] }),
    });

    const report = await check();
    assert.equal(report.hooks?.pi, "registered");
    const extension = path.join(pi, "extensions", "storytree.ts");
    assert.ok(existsSync(extension));
    assert.equal(readFileSync(path.join(pi, "mcp.json"), "utf8"), servers, "Pi's tool servers are untouched by the check");
    assert.ok(existsSync(path.join(pi, "extensions", "mine.ts")), "the user's own extension is kept");
    assert.match(report.lines.find((each) => each.check === "hooks")?.message ?? "", /Pi/);
    assert.deepEqual(registeredHookScripts({ pi }), [script], "the worktree reaper keeps the build Pi runs");
    const written = readFileSync(extension, "utf8");
    assert.equal((await check()).hooks?.pi, "already registered");
    assert.equal(readFileSync(extension, "utf8"), written, "not a byte changed");

    // The extension as Pi loads it: a default export given Pi's API, whose handlers Pi calls with each event and its context.
    const handlers: [string, (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>][] = [];
    const { default: load } = (await import(pathToFileURL(extension).href)) as { default: (pi: unknown) => void };
    load({ on: (event: string, handler: (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>) => void handlers.push([event, handler]) });
    const ctx = { cwd: dir, sessionManager: { getSessionId: () => "pi-session-1", getSessionFile: () => path.join(pi, "sessions", "s.jsonl") } };
    const fire = async (event: Record<string, unknown> & { type: string }) => (await Promise.all(handlers.filter(([name]) => name === event.type).map(([, handler]) => handler(event, ctx)))).filter((answer) => answer !== undefined);
    const heardLines = () => existsSync(heard) ? readFileSync(heard, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; input: Record<string, unknown> }) : [];

    assert.deepEqual(await fire({ type: "tool_call", toolName: "write", toolCallId: "call_w", input: { path: "a.ts", content: "x" } }), [{ block: true, reason: "held by another session" }], "a write is refused as the hook said");
    const [gate] = heardLines();
    assert.deepEqual(gate?.args, ["pi", "--edit-gate"]);
    assert.deepEqual(gate?.input, { type: "tool_call", toolName: "write", toolCallId: "call_w", input: { path: "a.ts", content: "x" }, hook_event_name: "tool_call", session_id: "pi-session-1", cwd: dir, transcript_path: path.join(pi, "sessions", "s.jsonl") });
    assert.deepEqual(await fire({ type: "tool_call", toolName: "read", toolCallId: "call_r", input: { path: "a.ts" } }), [], "a tool storytree does not hear runs no hook");
    assert.deepEqual(await fire({ type: "before_agent_start", prompt: "hi", systemPrompt: "Pi's whole system prompt", systemPromptOptions: { tools: [] } }), [], "a prompt with nothing to add answers nothing");
    assert.deepEqual(heardLines()[1], { args: ["pi"], input: { type: "before_agent_start", prompt: "hi", hook_event_name: "before_agent_start", session_id: "pi-session-1", cwd: dir, transcript_path: path.join(pi, "sessions", "s.jsonl") } }, "the prompt is heard without the system prompt the hook does not read");
    const others = { type: "custom_message", customType: "another-extension", content: "kept", display: false };
    const asked = { type: "custom_message", customType: "storytree-close-out", content: "close out", display: true };
    assert.deepEqual(await fire({ type: "agent_before_settle", outcome: "completed", entries: [others], continue: false, context: { messages: ["the whole run"] } }), [{ entries: [others, asked], continue: true }], "a settling run is asked to close out, its entries added to the ones it came with");
    assert.deepEqual(heardLines()[2], { args: ["pi", "--close-out-reminder"], input: { type: "agent_before_settle", outcome: "completed", continue: false, hook_event_name: "agent_before_settle", session_id: "pi-session-1", cwd: dir, transcript_path: path.join(pi, "sessions", "s.jsonl") } }, "heard without the run's context and entries");

    assert.equal(removeHooks({ ...home.homes, pi }).pi, "removed");
    assert.equal(existsSync(extension), false);
    assert.ok(existsSync(path.join(pi, "extensions", "mine.ts")));
    assert.equal(removeHooks({ ...home.homes, pi }).pi, "none");
  });
});

test("2.21 with a Codex that runs tool handlers (0.148 or later), each event the tool server takes is handed to it by a handler carrying that event's fields, beside the command hook, now in the background and standing down when the tool recorded it; an older Codex, or one whose version cannot be read, keeps the command hooks alone; removing storytree takes out both and leaves a tool handler of the user's own (ADR-1056 D2)", async () => {
  await withTempDir(async (dir) => {
    type Hook = { type: string; command?: string; async?: boolean; server?: string; tool?: string; input?: { harness: string; input: Record<string, string> } };
    type Group = { matcher?: string; hooks: Hook[] };
    const registered = async (codexVersion: string | undefined) => {
      const home = throwawayHome(path.join(dir, codexVersion ?? "unknown"));
      await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "codex", ...(codexVersion === undefined ? {} : { codexVersion }) });
      return { home, events: (readJson(home.codexHooks).hooks ?? {}) as Record<string, Group[]> };
    };
    const handlers = (events: Record<string, Group[]>) => Object.values(events).flat().flatMap((group) => group.hooks).filter((hook) => hook.type === "mcp_tool");

    for (const version of ["0.147.2", undefined]) {
      const { events } = await registered(version);
      assert.deepEqual(handlers(events), [], `${version}: no tool handler`);
      assert.ok(events.Stop?.[0]?.hooks[0]?.command?.endsWith(` codex ${BACKGROUND}`), `${version}: the turn's hook hands its work to a copy of itself`);
    }

    const { home, events } = await registered("0.153.4");
    const tool = (group: Group | undefined) => group?.hooks.find((hook) => hook.type === "mcp_tool");
    const delivered = { SessionStart: events.SessionStart?.[0], PreToolUse: events.PreToolUse?.find((group) => group.matcher === "^Bash$"), PostToolUse: events.PostToolUse?.[0], Stop: events.Stop?.[0] };
    // Only fields every input of the event carries (Codex 0.155's recorded inputs, Session management's fixtures): a missing one fails the handler.
    const common = ["session_id", "cwd", "hook_event_name", "transcript_path"];
    const fields: Record<string, string[]> = {
      SessionStart: [...common, "source"],
      PreToolUse: [...common, "tool_name", "tool_input", "tool_use_id"],
      PostToolUse: [...common, "tool_name", "tool_input", "tool_response", "tool_use_id"],
      Stop: common,
    };
    for (const [event, group] of Object.entries(delivered)) {
      const handler = tool(group);
      assert.deepEqual([handler?.server, handler?.tool, handler?.input?.harness], ["storytree", "hook_event", "codex"], event);
      assert.deepEqual(handler?.input?.input, Object.fromEntries(fields[event]!.map((field) => [field, "${" + field + "}"])), `${event}: each field it carries, as Codex fills a template`);
      const command = group?.hooks.find((hook) => hook.type === "command");
      assert.ok(command?.async === true && command.command?.endsWith(` codex ${AFTER_TOOL}`), `${event}: the command hook beside it, in the background, standing down when the tool recorded the event`);
    }
    // Codex runs no tool handler at a session's end; before a storytree tool, only a subagent's input names its agent; the prompt hook reaches the library anyway.
    for (const event of ["SessionEnd", "UserPromptSubmit"]) assert.equal(tool(events[event]?.[0]), undefined, event);
    assert.equal(tool(events.PreToolUse?.[0]), undefined, "before a storytree tool");
    // The hooks the agent waits for, for their answers, are as they were.
    assert.ok(!events.Stop?.[1]?.hooks[0]?.async && !events.PostToolUse?.[1]?.hooks[0]?.async, "the close-out reminder and the shell guard stay in the foreground");

    // A tool handler of the user's own, in a group of storytree's, stays when storytree's hooks go.
    const own = { type: "mcp_tool", server: "mine", tool: "note", input: {} };
    const file = readJson(home.codexHooks) as { hooks: Record<string, Group[]> };
    file.hooks.Stop![0]!.hooks.push(own as Hook);
    writeFileSync(home.codexHooks, `${JSON.stringify(file, null, 2)}\n`);
    assert.equal(removeHooks(home.homes, { harness: "codex", hook: HOOK }).codex, "removed");
    assert.deepEqual(readJson(home.codexHooks), { hooks: { Stop: [{ hooks: [own] }] } });
  });
});

test("2.22 Claude Code's registration leaves the mod's own tool calls (hook_event, heartbeat) out of the storytree-tools hook, and its background hooks wait for the tool's note (--after-tool), so a session with the Claude Code mod spawns no recording hook for its own deliveries", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    await runSetupCheck({ ...ANSWERED, folder: dir, hook: HOOK, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    const groups = (readJson(home.claudeSettings).hooks ?? {}) as Record<string, HookEntry[]>;
    const ours = (event: string) => (groups[event] ?? []).flatMap((group) => group.hooks.filter((hook) => hook.args?.[0] === HOOK.script).map((hook) => ({ matcher: group.matcher ?? "", hook })));
    // Claude Code matches a tool's name against the whole matcher, as a regular expression.
    const runs = (matcher: string, tool: string) => new RegExp(`^(?:${matcher})$`).test(tool);
    const [tools] = ours("PreToolUse").filter(({ matcher }) => runs(matcher, "mcp__storytree__open"));
    assert.ok(tools, "a hook before a storytree tool");
    assert.ok(runs(tools.matcher, "mcp__storytree__claim") && !runs(tools.matcher, "mcp__storytree__hook_event"), "before every storytree tool but hook_event");
    assert.ok(runs(tools.matcher, "mcp__storytree__check_setup") && !runs(tools.matcher, "mcp__storytree__heartbeat"), "nor before the mod's heartbeat");
    assert.ok(runs(tools.matcher, "mcp__storytree__hook_events"), "a tool whose name only starts like it is still one");
    // Every background hook that records a line stands down when the tool recorded its event; the foreground ones look for the note at once.
    const background = Object.keys(groups).flatMap((event) => ours(event).map((one) => ({ event, ...one }))).filter(({ hook }) => hook.async === true);
    assert.deepEqual([...new Set(background.map(({ event }) => event))].sort(), ["PostToolUse", "PostToolUseFailure", "PreToolUse", "SessionStart", "Stop", "SubagentStop"], "the background hooks");
    for (const { hook } of background) assert.ok(hook.args?.includes(AFTER_TOOL), hook.args?.join(" "));
    for (const { hook } of Object.keys(groups).flatMap(ours).filter(({ hook }) => hook.async !== true)) assert.ok(!hook.args?.includes(AFTER_TOOL), hook.args?.join(" "));
  });
});

