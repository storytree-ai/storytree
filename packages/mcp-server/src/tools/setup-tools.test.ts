/**
 * The setup check's two tools, check_setup and set_up_project, as an agent calls them through the MCP
 * server: the agent link's contracts 8.4-8.24 that only a call through the server shows, and 7.7, the
 * habits card in their answers. The setup work itself is the agent link's, and its own tests stay there.
 *
 * Each test works in a throwaway home: its own Claude Code config folder and Codex home, holding
 * settings of the user's own that the setup check must leave alone, and a storytree home that says
 * where storytree listens (a copy of the test Postgres's owner record) or how to open it.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MARKER_FILE, noteCodexHookRan, noteHookFailure, type Homes } from "@storytree/agent-link";
import { CHECK_FILE, registerHooks, type GhState, type HookCommand } from "@storytree/app-setup/setup";
import { buildBins } from "@storytree/app-setup/bins";
import { withTempDir } from "@storytree/agent-link/testing/folders";
import { approveCheckout, dropTestProjects, placeTestServer, testServerUrl, uniqueProjectName } from "@storytree/agent-link/testing/pg";
import { connect } from "@storytree/library";

import { habitsCard } from "../instructions/habits.js";
import { claudeCode, codex, withAgent } from "../testing/agent.js";

/** The hook fixtures the agent link's own hook tests run on: a harness's input, as it sends it. */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.resolve("@storytree/agent-link/testing/pg"))), "..", "hooks", "fixtures");

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
  placeTestServer(path.join(storytreeHome, "pgdata"));
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

test("agent-link 8.4 setup records the chosen project only after a successful yes, never on an existing-project check", async () => {
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
        assert.equal(readJson(path.join(folder, MARKER_FILE)).project, name);
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

test("agent-link 8.5 the agent fires a test of each hook, and the connection shows as verified only when storytree has received every one; until then it names the missing hook and the fix", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project, home.storytreeHome);
    const setup = {
      dataDir: path.join(home.storytreeHome, "pgdata"),
      setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome },
    };
    try {
      const server = await connect({ url: testServerUrl() });
      await (await server.openProject(project)).close().finally(() => server.close()); // set up, as a marked folder's project is
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

      // A Codex session whose hooks have not run is told only the fix that is Codex's own, its one-time
      // approval: an edit or a command could not reach storytree before it, and would leave a check file behind.
      await withAgent(folder, codex("codex-1", setup), async (agent) => {
        const answer = await agent.call("check_setup");
        const { verified, missing, fixes } = answer.data as { verified: boolean; missing: string[]; fixes: string[] };
        assert.deepEqual({ verified, missing, fixes }, { verified: false, missing: ["session start", "storytree tool call", "file edit", "command"], fixes: ["codex-approval"] });
        assert.doesNotMatch(answer.text, /storytree-check/);
      });
    } finally {
      await dropTestProjects([project]);
    }
  });
});

test("journey-events 1.5: the hooks-verified milestone is reported only once check_setup verifies all four of the current session's hooks; incomplete evidence, or another session's, reports none", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project, home.storytreeHome);
    let milestones = 0;
    const setup = {
      dataDir: path.join(home.storytreeHome, "pgdata"),
      setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome },
      journey: { hooksVerified: () => { milestones++; } },
    };
    try {
      const server = await connect({ url: testServerUrl() });
      await (await server.openProject(project)).close().finally(() => server.close());
      await withAgent(folder, claudeCode("claude-1", setup), async (agent) => {
        await fireHook(home.storytreeHome, "claude-code", "session-start-startup", folder, "claude-1");
        await fireHook(home.storytreeHome, "claude-code", "pre-tool-use-storytree", folder, "claude-1");
        await fireHook(home.storytreeHome, "claude-code", "post-tool-use-write", folder, "claude-1");
        await agent.call("check_setup");
        assert.equal(milestones, 0, "three of four hooks report nothing");
        await fireHook(home.storytreeHome, "claude-code", "post-tool-use-bash", folder, "claude-1");
        await agent.call("check_setup");
        assert.equal(milestones, 1);
      });
      // Another session in the same folder: claude-1's hooks are not its evidence.
      await withAgent(folder, claudeCode("claude-2", setup), async (agent) => {
        assert.equal(((await agent.call("check_setup")).data as { verified: boolean }).verified, false);
        assert.equal(milestones, 1, "another session's evidence reports nothing");
      });
    } finally {
      await dropTestProjects([project]);
    }
  });
});

test("agent-link 8.21 a Codex session that set its project up during the session, while Codex's hooks are known to run, is told what Claude Code is told: start a new session here and check again; never the trust step, which stays for a Codex whose hooks have never run (regression: Conduit 1 on the reset laptop, 2026-10-01)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project, home.storytreeHome);
    const setup = { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } };
    try {
      const server = await connect({ url: testServerUrl() });
      await (await server.openProject(project)).close().finally(() => server.close());
      // storytree's hooks are registered for Codex and one of them has run on this machine: Codex trusts them.
      registerHooks(home.homes, HOOK);
      noteCodexHookRan({ storytreeHome: home.storytreeHome, codexHome: home.homes.codex });
      // This session started before its folder was a project, so storytree heard none of its hooks.
      await withAgent(folder, codex("codex-1", setup), async (agent) => {
        const answer = await agent.call("check_setup");
        assert.deepEqual((answer.data as { fixes: string[] }).fixes, ["new-session", "edit-check-file", "run-check-command"]);
        assert.match(answer.text, /start a new session here/);
        assert.doesNotMatch(answer.text, /type \/hooks/);
      });
    } finally {
      await dropTestProjects([project]);
    }
  });
});

test("7.7 set_up_project's answer and check_setup's in a project carry the whole habits card, so an agent whose harness keeps only the start of the server's instructions still gets all of it (regression: Claude Code kept 2,048 characters in the shop's first session, 2026-10-04)", async () => {
  const name = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, name);
    mkdirSync(folder);
    try {
      await withAgent(folder, claudeCode(`claude-${name}`, { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } }), async (agent) => {
        const setUp = await agent.call("set_up_project", { name });
        assert.ok(setUp.text.includes(habitsCard()), "set_up_project's answer lacks the card");
        const checked = await agent.call("check_setup");
        assert.ok(checked.text.includes(habitsCard()), "check_setup's answer lacks the card");
      });
    } finally {
      await dropTestProjects([name]);
    }
  });
});

test("agent-link 8.22 a session that sets its project up finishes the setup in that answer: the starter roles and a new session to verify its hooks, or Codex's trust step, never a second check_setup in this session (regression: Codex's approval review refused the second check, 2026-10-01)", async () => {
  const [claudes, codexes, waiting] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const setup = { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } };
    const setUp = async (name: string, agentFor: typeof claudeCode) => {
      const folder = path.join(dir, name);
      mkdirSync(folder);
      let answer: { isError: boolean; text: string; data: Record<string, unknown> } | undefined;
      await withAgent(folder, agentFor(`agent-${name}`, setup), async (agent) => {
        answer = await agent.call("set_up_project", { name });
      });
      return answer!;
    };
    try {
      registerHooks(home.homes, HOOK);
      // Codex has storytree's hooks but none has run: the user has not trusted them yet.
      const untrusted = await setUp(waiting, codex);
      assert.equal(untrusted.isError, false, untrusted.text);
      assert.deepEqual(untrusted.data.fixes, ["codex-approval"]);
      assert.match(untrusted.text, /type \/hooks/);

      noteCodexHookRan({ storytreeHome: home.storytreeHome, codexHome: home.homes.codex });
      for (const [name, agentFor] of [[claudes, claudeCode], [codexes, codex]] as const) {
        const answer = await setUp(name, agentFor);
        assert.equal(answer.isError, false, answer.text);
        assert.deepEqual(answer.data.starterRoles, ["orchestrator", "librarian"]);
        assert.deepEqual(answer.data.fixes, ["new-session"], "no edit or command test, which only a session started in the project could complete");
        assert.match(answer.text, /new session/);
        assert.doesNotMatch(answer.text, /type \/hooks/);
      }
    } finally {
      await dropTestProjects([claudes, codexes, waiting]);
    }
  });
});


/** Run the built hook as `harness` runs it, with a recorded input moved to `folder` and `session`. */
function fireHook(storytreeHome: string, harness: string, fixture: string, folder: string, session: string, changed: Record<string, unknown> = {}): Promise<void> {
  const input = { ...(readJson(path.join(FIXTURES, harness, `${fixture}.json`)) as object), cwd: folder, session_id: session, ...changed };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, harness], { env: { ...process.env, STORYTREE_HOME: storytreeHome }, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", () => resolve());
    child.stdin.end(JSON.stringify(input));
  });
}

test("agent-link 8.8 with gh missing, signed out or signed in, the agent is never asked to install or sign in to it, in check_setup's text or its data", async () => {
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

test("agent-link 8.19 in a project whose library holds the starter roles, the check names them for the agent to open; a project without them is told of none", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const [seeded, older] = [uniqueProjectName(), uniqueProjectName()];
    const storytree = await connect({ url: testServerUrl() });
    try {
      const agentIn = (folder: string) => claudeCode(`claude-${path.basename(folder)}`, { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { homes: home.homes, storytreeHome: home.storytreeHome } });
      const newFolder = path.join(dir, seeded);
      mkdirSync(newFolder);
      await withAgent(newFolder, agentIn(newFolder), async (agent) => {
        assert.equal((await agent.call("set_up_project", { name: seeded })).isError, false);
        const checked = await agent.call("check_setup");
        assert.deepEqual(checked.data.starterRoles, ["orchestrator", "librarian"]);
        assert.match(checked.text, /orchestrator/);
        assert.match(checked.text, /librarian/);
      });
      // A project set up before the starter pack: its library has no roles to name.
      const oldFolder = path.join(dir, older);
      mkdirSync(oldFolder);
      await (await storytree.openProject(older)).close();
      writeFileSync(path.join(oldFolder, MARKER_FILE), `${JSON.stringify({ project: older })}\n`);
      await approveCheckout(oldFolder, older, home.storytreeHome);
      await withAgent(oldFolder, agentIn(oldFolder), async (agent) => {
        const checked = await agent.call("check_setup");
        assert.deepEqual(checked.data.starterRoles, []);
        assert.doesNotMatch(checked.text, /orchestrator|librarian/);
      });
    } finally {
      await storytree.close();
      await dropTestProjects([seeded, older]);
    }
  });
});

test("agent-link 8.20 once storytree has received the session's edit of the check file, the check deletes the file where the agent wrote it, in a worktree whose tool server runs in the project's folder and while the other hooks are still missing (regression: the laptop's worktree sessions, 2026-10-02)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    const worktree = path.join(folder, ".claude", "worktrees", "a-worktree");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project, home.storytreeHome);
    const setup = { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } };
    try {
      const server = await connect({ url: testServerUrl() });
      await (await server.openProject(project)).close().finally(() => server.close());
      // The agent writes the check file in its worktree with its own edit tool, and the edit hook reports it.
      const checkFile = path.join(worktree, CHECK_FILE);
      writeFileSync(checkFile, "check");
      await fireHook(home.storytreeHome, "claude-code", "post-tool-use-write", worktree, "claude-1", { tool_input: { file_path: checkFile, content: "check" } });
      await withAgent(folder, claudeCode("claude-1", setup), async (agent) => {
        const { missing } = (await agent.call("check_setup")).data as { missing: string[] };
        assert.deepEqual(missing, ["session start", "storytree tool call", "command"]);
        assert.equal(existsSync(checkFile), false);
      });
    } finally {
      await dropTestProjects([project]);
    }
  });
});

test("agent-link 8.24 the check tells a session the hook failures this machine traced for it (how many, and the latest's event, stage and error), so a session whose lines went missing can capture why; a session with none is told nothing of them", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project, home.storytreeHome);
    const setup = { dataDir: path.join(home.storytreeHome, "pgdata"), setup: { ...ANSWERED, homes: home.homes, storytreeHome: home.storytreeHome } };
    try {
      const server = await connect({ url: testServerUrl() });
      await (await server.openProject(project)).close().finally(() => server.close());
      const who = { harness: "claude-code", event: "PreToolUse", session: "claude-1", toolUseId: "toolu_1" };
      noteHookFailure(() => home.storytreeHome, who, "reach", new Error("timeout expired"));
      noteHookFailure(() => home.storytreeHome, { ...who, toolUseId: "toolu_2" }, "write", Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
      await withAgent(folder, claudeCode("claude-1", setup), async (agent) => {
        const answer = await agent.call("check_setup");
        const failures = (answer.data.hookFailures as { toolUseId: string; stage: string }[]).map(({ toolUseId, stage }) => ({ toolUseId, stage }));
        assert.deepEqual(failures, [{ toolUseId: "toolu_1", stage: "reach" }, { toolUseId: "toolu_2", stage: "write" }]);
        assert.match(answer.text, /2 hook failures/);
        assert.match(answer.text, /EACCES: permission denied/);
      });
      await withAgent(folder, claudeCode("claude-2", setup), async (agent) => {
        const answer = await agent.call("check_setup");
        assert.deepEqual(answer.data.hookFailures, []);
        assert.doesNotMatch(answer.text, /hook failure/);
      });
    } finally {
      await dropTestProjects([project]);
    }
  });
});
