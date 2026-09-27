/**
 * Capability 3 · Hooks: one test per contract 3.1-3.8 in the agent link story.
 *
 * The hook runs the way a harness runs it: the built command (`storytree-hook.mjs`, a plain Node
 * script) started directly, with no shell, the hook's input on its stdin. The inputs are real ones,
 * recorded from Claude Code 2.1.212 and Codex on 2026-09-26 (their paths rewritten to a neutral
 * folder); each test points the input's working folder at a throwaway folder set up as a project.
 * Contract 3.5's were recorded the same day from Claude Code 2.1.283 and Codex 0.155, each starting
 * two subagents that called a stand-in tool server, whose name and tool are rewritten to storytree's
 * `open`. Contract 3.6's were recorded on 2026-09-27 from the same versions, each running a shell
 * command that failed (Codex's sandbox refused its commands, so only its before-hook fired), and
 * 3.7's the same day, from one prompt each, with the prompt replaced. Contract 3.8's status line
 * input is not recorded: Claude Code runs a status line only in an interactive window, so it is the
 * documented shape (session_id, cwd, workspace.current_dir).
 *
 * "Storytree running" is the test Postgres: a throwaway storytree home holds a copy of its owner
 * record, where the app's would be.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import pg from "pg";

import { openActivityLog, type Line, type NewLine } from "../activity/index.js";
import { buildBins } from "../bins/build.js";
import { MARKER_FILE } from "../routing/index.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
/** The name of the machine the tests run on, as every line a hook writes names it. */
const MACHINE = hostname().trim();
/** "Under half a second", as the tests hold it. */
const QUICK_MS = 500;
/** Slower than this, a bare Node's start says the machine is busy: here one takes about 0.11 s. */
const BUSY_NODE_START_MS = 250;

let bins: string;
let hook: string;

before(async () => {
  bins = mkdtempSync(path.join(tmpdir(), "storytree-link-bins-"));
  hook = (await buildBins(bins))["storytree-hook"]!;
});

after(() => {
  rmSync(bins, { recursive: true, force: true });
});

/** A recorded hook input, with its working folder moved to `folder`. */
function recorded(harness: "claude-code" | "codex", name: string, folder: string): string {
  const input = JSON.parse(readFileSync(path.join(FIXTURES, harness, `${name}.json`), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...input, cwd: folder });
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Run the built hook as a harness does: directly, no shell, `input` on stdin, the storytree home given. */
function runHook(harness: string, input: string, storytreeHome: string, flags: readonly string[] = []): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [hook, harness, ...flags], {
      env: { ...process.env, STORYTREE_HOME: storytreeHome },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
    child.stdin.end(input);
  });
}

/** How long a bare Node that does nothing takes, started as runHook starts the hook: the machine's floor. */
function runNode(): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, ["-e", "0"], { stdio: ["pipe", "ignore", "ignore"], shell: false });
    child.on("error", reject);
    child.on("exit", () => resolve(performance.now() - started));
    child.stdin.end();
  });
}

/** A throwaway storytree home: where the app's owner record would be, a copy of the test server's when `running`. */
function storytreeHome(dir: string, running: boolean): string {
  const home = path.join(dir, "storytree-home");
  mkdirSync(home, { recursive: true });
  if (running) copyFileSync(`${testServerDataDir()}.owner.json`, path.join(home, "pgdata.owner.json"));
  return home;
}

/** A folder under `dir` set up as `project`. */
function projectFolder(dir: string, project: string): string {
  const folder = path.join(dir, "site");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
  return folder;
}

async function linesOf(project: string): Promise<Line[]> {
  const log = await openActivityLog(testServerUrl());
  try {
    return (await log.since(project, 0)).lines;
  } finally {
    await log.close();
  }
}

/** How many lines any project's log holds for `session`: none, for a hook that wrote nothing. */
async function linesAnywhereFor(session: string): Promise<number> {
  const url = new URL(testServerUrl());
  url.pathname = "/storytree-activity";
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    const { rows } = await client.query<{ count: string }>("SELECT count(*) FROM activity WHERE session = $1", [session]);
    return Number(rows[0]!.count);
  } finally {
    await client.end();
  }
}

/** The line's own fields, without the number and time the log gives it. */
function written(line: Line): Omit<Line, "seq" | "at"> {
  const { seq: _seq, at: _at, ...rest } = line;
  return rest;
}

test("3.1 recorded Claude Code hook inputs (a start, a file edit, a shell command, an end) make four lines on that session, carrying the file path, the command and the machine's name", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    for (const name of ["session-start-startup", "post-tool-use-write", "post-tool-use-bash", "session-end"]) {
      const ran = await runHook("claude-code", recorded("claude-code", name, folder), home);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
    }
    const session = "b2ef2128-23c1-4a1e-b126-4fa79b2c2a97";
    const common = { project, session, harness: "claude-code", source: "hook", folder, machine: MACHINE } as const;
    assert.deepEqual((await linesOf(project)).map(written), [
      { ...common, kind: "session-started", how: "startup" },
      { ...common, kind: "file-edited", files: ["C:\\Users\\dev\\projects\\site\\hello.txt"] },
      { ...common, kind: "command-run", command: "echo probe-command", call: "toolu_0198fGg1AbRnVBG34suBFFTy" },
      { ...common, kind: "session-ended", reason: "other" },
    ]);
  });
});

test("3.2 recorded Codex hook inputs make the same four lines, with the edited files read out of its patch text", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    for (const name of ["session-start-startup", "post-tool-use-apply-patch", "post-tool-use-bash", "session-end"]) {
      const ran = await runHook("codex", recorded("codex", name, folder), home);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
    }
    const session = "01a0dc55-55fe-7b01-a0ea-cebc2d4a4267";
    const common = { project, session, harness: "codex", source: "hook", folder, machine: MACHINE } as const;
    assert.deepEqual((await linesOf(project)).map(written), [
      { ...common, kind: "session-started", how: "startup" },
      { ...common, kind: "file-edited", files: ["hello.txt"] },
      { ...common, kind: "command-run", command: "echo probe-command", call: "exec-5a31d7cf-344a-4477-8f26-e0780d799779" },
      { ...common, kind: "session-ended", reason: "other" },
    ]);

    // One patch touching several files names them all: the one it updates, where it moves it, and the one it adds.
    const before = (await linesOf(project)).length;
    await runHook("codex", recorded("codex", "post-tool-use-apply-patch-move", folder), home);
    // The same patch run through the shell (`apply_patch <<'EOF'`) reaches the hook as a Bash command.
    const patch = (JSON.parse(recorded("codex", "post-tool-use-apply-patch-move", folder)) as { tool_input: { command: string } }).tool_input.command;
    const shell = { ...JSON.parse(recorded("codex", "post-tool-use-bash", folder)), tool_input: { command: `apply_patch <<'EOF'\n${patch}\nEOF` } };
    await runHook("codex", JSON.stringify(shell), home);
    assert.deepEqual((await linesOf(project)).slice(before).map(written), [
      { ...common, kind: "file-edited", files: ["hello.txt", "greeting.txt", "notes.txt"] },
      { ...common, kind: "file-edited", files: ["hello.txt", "greeting.txt", "notes.txt"] },
    ]);
  });
});

test("3.3 with storytree stopped, with garbage input, or outside a storytree project, the command exits cleanly in under half a second and writes nothing", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const outside = path.join(dir, "not-a-project");
    mkdirSync(outside);
    const stopped = storytreeHome(path.join(dir, "stopped"), false);
    const running = storytreeHome(path.join(dir, "running"), true);
    const session = `session-${project}`;
    const start = (cwd: string): string => JSON.stringify({ ...JSON.parse(recorded("claude-code", "session-start-startup", cwd)), session_id: session });

    const cases: [string, string, string][] = [
      ["storytree stopped", start(folder), stopped],
      ["garbage input", "{ this is not a hook's input", running],
      ["an empty input", "", running],
      ["input of the wrong shape", JSON.stringify({ hook_event_name: 42, cwd: [folder] }), running],
      ["outside a storytree project", start(outside), running],
    ];
    for (const [what, input, home] of cases) {
      // Each case three times, beside three starts of a bare Node made the same way: every run
      // must exit cleanly and silently. The fastest run must be under half a second; but on a
      // machine so busy that a bare Node alone is slow to start (as when a whole test suite, or
      // several, share it: one full run on Windows took 1.7 s for a command that takes 0.13 s),
      // what is held to half a second is what the command adds to that start.
      const runs = [];
      const bare = [];
      for (let run = 0; run < 3; run++) {
        runs.push(await runHook("claude-code", input, home));
        bare.push(await runNode());
      }
      for (const ran of runs) assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, what);
      const fastest = Math.min(...runs.map((ran) => ran.ms));
      const floor = Math.min(...bare);
      const busy = floor > BUSY_NODE_START_MS;
      assert.ok(
        busy ? fastest - floor < QUICK_MS : fastest < QUICK_MS,
        `${what}: exited in ${fastest.toFixed(0)} ms at best, where a bare Node took ${floor.toFixed(0)} ms`,
      );
    }
    assert.deepEqual(await linesOf(project), [], "nothing written for the project");
    assert.equal(await linesAnywhereFor(session), 0, "nothing written anywhere for the session");
  });
});

test("3.4 it runs on Windows without a Unix shell, and it never prints anything the agent would see, even when storytree cannot be reached", async () => {
  const project = uniqueProjectName();
  // Storytree "running" whose address never answers: a live process in the owner record, and on
  // its port something that accepts a connection and says nothing.
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  try {
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const home = path.join(dir, "unanswering-home");
      mkdirSync(home);
      const { port } = silent.address() as AddressInfo;
      writeFileSync(path.join(home, "pgdata.owner.json"), JSON.stringify({ pid: process.pid, token: "t", port, startedAt: new Date().toISOString() }));
      for (const harness of ["claude-code", "codex", "a harness it does not know"]) {
        const ran = await runHook(harness, recorded("claude-code", "post-tool-use-bash", folder), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, harness);
      }
    });
  } finally {
    silent.close();
  }
});

test("3.5 recorded inputs for starting a subagent, for a storytree tool call inside it and for one by the orchestrator make three lines: the subagent's id, type and task, and who asked for each call, by the call's id, for Claude Code and Codex alike", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    for (const [harness, started] of [
      ["claude-code", "post-tool-use-agent"],
      ["codex", "post-tool-use-spawn-agent"],
    ] as const) {
      for (const name of [started, "pre-tool-use-storytree-subagent", "pre-tool-use-storytree"]) {
        const ran = await runHook(harness, recorded(harness, name, folder), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, `${harness} ${name}`);
      }
    }
    const claude = { project, session: "cf0453e9-0036-435f-9ea6-2a11f2ea0946", harness: "claude-code", source: "hook", folder, machine: MACHINE } as const;
    const codex = { project, session: "01a0dd1c-74c7-77d1-8248-f5e13dbe46c4", harness: "codex", source: "hook", folder, machine: MACHINE } as const;
    const codexSubagent = "01a0dd1c-afd2-7062-8f09-8152ad44d7ff";
    assert.deepEqual((await linesOf(project)).map(written), [
      { ...claude, kind: "subagent-started", subagent: "a5b107a7efcabea1e", type: "probe-reader", task: "probe read alpha" },
      { ...claude, kind: "tool-requested", tool: "open", call: "toolu_01DAqeuVgkJN85ZEoYpcEjyk", agent: { subagent: "a5b107a7efcabea1e", type: "probe-reader" } },
      { ...claude, kind: "tool-requested", tool: "open", call: "toolu_018cKhhRDozwv48NrNJx8p4z", agent: "orchestrator" },
      {
        ...codex,
        kind: "subagent-started",
        subagent: codexSubagent,
        type: "explorer",
        task: "Call the MCP tool open (on the MCP server storytree) with id decision_2f6c1e0a9b3d, then reply done.",
      },
      { ...codex, kind: "tool-requested", tool: "open", call: "exec-1ec1f51c-a4ca-4717-970e-c9e495cc6693", agent: { subagent: codexSubagent, type: "explorer" } },
      { ...codex, kind: "tool-requested", tool: "open", call: "exec-a6165a7e-7f86-4ca3-a6d6-ae4a68433045", agent: "orchestrator" },
    ]);
  });
});

test("3.6 recorded inputs from before a shell command, after one that failed, and at the end of a turn make three lines: the command started, and finished, under the call's id, and the turn ended; for Codex, which waits for its hooks, the hook hands its line to one in the background", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    for (const name of ["pre-tool-use-bash", "post-tool-use-failure-bash", "stop"]) {
      const ran = await runHook("claude-code", recorded("claude-code", name, folder), home);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
    }
    const claude = { project, session: "b4f8eff5-05ab-4ef2-b070-78375e2a5deb", harness: "claude-code", source: "hook", folder, machine: MACHINE } as const;
    const command = "echo probe-start\nexit 3";
    assert.deepEqual((await linesOf(project)).map(written), [
      { ...claude, kind: "command-started", command, call: "toolu_01Kjexd4yP2myMhXEATFdm25" },
      { ...claude, kind: "command-run", command, call: "toolu_01Kjexd4yP2myMhXEATFdm25" },
      { ...claude, kind: "turn-ended" },
    ]);

    const codex = { project, session: "01a0de40-cd2f-73e1-92c7-8ee8ff58135b", harness: "codex", source: "hook", folder, machine: MACHINE } as const;
    for (const name of ["pre-tool-use-bash", "stop"]) {
      const ran = await runHook("codex", recorded("codex", name, folder), home, ["--background"]);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
      // Its line arrives from the background, after the hook has already exited.
      const deadline = Date.now() + 5_000;
      while ((await linesOf(project)).filter((line) => line.session === codex.session).length < (name === "stop" ? 2 : 1) && Date.now() < deadline) await sleep(50);
    }
    assert.deepEqual((await linesOf(project)).filter((line) => line.session === codex.session).map(written), [
      { ...codex, kind: "command-started", command: "echo probe-start", call: "exec-ba34158e-632e-4dbc-86d0-a2419ae85e68" },
      { ...codex, kind: "turn-ended" },
    ]);
  });
});

/** The context a prompt hook's output adds for the agent, or undefined when it printed nothing. */
function addedContext(ran: Ran): string | undefined {
  if (ran.stdout === "") return undefined;
  const output = JSON.parse(ran.stdout) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
  assert.equal(output.hookSpecificOutput?.hookEventName, "UserPromptSubmit");
  return output.hookSpecificOutput?.additionalContext;
}

/** A recorded prompt hook input for `harness`, in `folder`, with the prompt and session given. */
function prompted(harness: "claude-code" | "codex", folder: string, prompt: string, session: string): string {
  return JSON.stringify({ ...JSON.parse(recorded(harness, "user-prompt-submit", folder)), prompt, session_id: session });
}

test("3.7 at each prompt, the project's definitions for the terms it names are added for the agent: whole words in any case or plural, at most five, longest first, each once a session; a harness's own notice gets none, and with storytree stopped nothing is printed", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    const define = (term: string, meaning: string) => library.defineTerm({ term, meaning });
    const claim = await define("Claim", "Holding a capability while you build it.\nA second agent is refused.");
    const quiet = await define("Quiet time", "How long a session may say nothing before it reads as idle.");
    await define("Id", "Too short to look for.");
    await define("Front cover", "A decision that is the way into a story's knowledge.");
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const home = storytreeHome(dir, true);
      // Sessions named for this run: what each has been given is kept between runs of the hook.
      const ask = async (harness: "claude-code" | "codex", prompt: string, session: string, where = home) => {
        const ran = await runHook(harness, prompted(harness, folder, prompt, `${project}-${session}`), where);
        assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" }, prompt);
        return addedContext(ran);
      };

      const prompt = "Who holds the CLAIMS on the email form, and has its quiet-time passed? Give me the id, and skip the claimant.";
      assert.equal(
        await ask("claude-code", prompt, "cc-1"),
        [
          "[storytree] Definitions from this project's library for terms in this prompt (open a note by its id to read all of it):",
          `- Quiet time (${quiet.id}): How long a session may say nothing before it reads as idle.`,
          `- Claim (${claim.id}): Holding a capability while you build it.`,
        ].join("\n"),
      );
      assert.equal(await ask("claude-code", prompt, "cc-1"), undefined, "each once a session");
      assert.match((await ask("claude-code", prompt, "cc-2")) ?? "", /Quiet time/, "and again in another session");
      assert.equal(await ask("claude-code", `<task-notification>\nthe claim was released</task-notification>`, "cc-3"), undefined, "a harness's own notice");
      assert.equal(await ask("claude-code", prompt, "cc-4", storytreeHome(path.join(dir, "stopped"), false)), undefined, "storytree stopped");

      for (const term of ["Arc", "Story", "Capability", "Contract", "Increment"]) await define(term, `The ${term.toLowerCase()}.`);
      const named = await ask("codex", "Each arc, story, capability, contract, increment and front cover", "cx-1");
      assert.deepEqual(
        named?.split("\n").slice(1).map((line) => line.split(" (")[0]),
        ["- Front cover", "- Capability", "- Increment", "- Contract", "- Story"],
        "at most five, the longest terms first",
      );
    });
  } finally {
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("3.8 the status line shows what this session holds, how many other agents are working, and a warning when another is editing a file it edited; with storytree stopped it says so, and outside a project it shows nothing", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const emailForm = await library.addCapability({ title: "Email form", story: story.id });
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const home = storytreeHome(dir, true);
      const status = async (cwd: string, where = home) => {
        const input = JSON.stringify({ hook_event_name: "Status", session_id: "cc-1", cwd, workspace: { current_dir: cwd, project_dir: cwd } });
        const ran = await runHook("statusline", input, where);
        assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" });
        return ran.stdout;
      };
      const write = (line: NewLine) => log.append(project, { folder, ...line });

      await write({ session: "cc-1", harness: "claude-code", source: "hook", kind: "session-started", how: "startup" });
      assert.equal(await status(folder), "storytree · holds nothing · no other agents working");

      await write({ session: "cc-1", harness: "claude-code", source: "tool", kind: "claimed", capability: emailForm.id, reason: "building it" });
      await write({ session: "cc-1", harness: "claude-code", source: "hook", kind: "file-edited", files: [path.join(folder, "src", "signup.ts")] });
      await write({ session: "cx-1", harness: "codex", source: "hook", kind: "file-edited", files: ["src/other.ts"] });
      assert.equal(await status(folder), "storytree · holds Email form · 1 other agent working");

      // Codex names the files it edits relative to its folder: the same file, so a warning.
      await write({ session: "cx-1", harness: "codex", source: "hook", kind: "file-edited", files: ["src/signup.ts"] });
      await write({ session: "cx-2", harness: "codex", source: "hook", kind: "session-started", how: "startup" });
      assert.equal(await status(folder), "storytree · holds Email form · 2 other agents working · ⚠ src/signup.ts is being edited by Codex too");

      assert.equal(await status(folder, storytreeHome(path.join(dir, "stopped"), false)), "storytree isn't running");
      const outside = path.join(dir, "elsewhere");
      mkdirSync(outside);
      assert.equal(await status(outside), "");
    });
  } finally {
    await log.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});
