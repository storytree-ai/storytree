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
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as connectTcp, createServer, type AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import pg from "pg";

import { openActivityLog, type Line, type NewLine } from "../activity/index.js";
import { buildBins } from "../bins/build.js";
import { readContext } from "../context/index.js";
import { MARKER_FILE, setUpProject } from "../routing/index.js";
import { leaveNotice } from "../claims/notices.js";
import { claimFromEdits } from "../claims/edit-claims.js";
import { readClaims } from "../claims/index.js";
import { hookFailures, hookFailuresFile } from "./failures.js";
import { hookLines } from "./hooks.js";
import { queueFolder } from "./queue.js";
import { readSettings, setSetting } from "../settings/settings.js";
import { registerHooks } from "../setup/hooks-config.js";
import { countingStore, longHistory } from "../testing/egress.js";
import { git, withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
/** The name of the machine the tests run on, as every line a hook writes names it. */
const MACHINE = hostname().trim();
/** "Under half a second", as the tests hold it. */
const QUICK_MS = 500;
/** A bare Node's start on an idle machine, at most: about 0.11 s on Windows, 0.02 s on Linux. */
const IDLE_NODE_START_MS = 110;

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
function runHook(harness: string, input: string, storytreeHome: string, flags: readonly string[] = [], env: NodeJS.ProcessEnv = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [hook, harness, ...flags], {
      env: { ...process.env, ...env, STORYTREE_HOME: storytreeHome },
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

/** `project`'s lines, less the machine's start the first hook to reach it records (4.30), unless `starts` asks for those too. */
async function linesOf(project: string, { starts = false } = {}): Promise<Line[]> {
  const log = await openActivityLog(testServerUrl());
  try {
    return (await log.since(project, 0)).lines.filter((line) => starts || line.kind !== "machine-started");
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

/** The line's own fields, without the number and time the log gives it, nor the transcript every line carries (3.12 pins that). */
function written(line: Line): Omit<Line, "seq" | "at" | "transcript"> {
  const { seq: _seq, at: _at, transcript: _transcript, ...rest } = line;
  return rest;
}

test("3.1 recorded Claude Code hook inputs (a start, a file edit, a shell command, an end) make four lines on that session, carrying the file path, the command and the machine's name; the first of them also records when the machine started, once (4.29)", async () => {
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
    const starts = (await linesOf(project, { starts: true })).filter((line) => line.kind === "machine-started");
    assert.deepEqual(starts.map((line) => line.kind === "machine-started" && { session: line.session, machine: line.machine, before: Date.parse(line.startedAt) < Date.now() }),
      [{ session, machine: MACHINE, before: true }]);
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

for (const harness of ["claude-code", "codex"] as const) test(`3.22 ${harness} shell writes survive offline hooks and claim their capability, without attributing existing dirt or read-only commands`, async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, false);
    const session = `shell-${project}`;
    const file = "packages/sign-up/src/email.ts";
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), "export const email = 1;\n");
    writeFileSync(path.join(folder, "packages/sign-up/package.json"), '{"name":"sign-up"}');
    writeFileSync(path.join(folder, "packages/sign-up/src/email.test.ts"), 'import { email } from "./email.js";\ntest("1.1 email", () => email);\n');
    writeFileSync(path.join(folder, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(folder, ".gitattributes"), "*.ts text\n");
    git(folder, "init", "-b", "shell-test");
    git(folder, "config", "core.autocrlf", "false");
    git(folder, "add", ".");
    git(folder, "commit", "-m", "baseline");
    writeFileSync(path.join(folder, "existing.txt"), "pre-existing dirt");
    writeFileSync(path.join(folder, file), "export const email = 0;\r\n");
    const input = (event: string, extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: session, cwd: folder, hook_event_name: event, ...extra });
    const fire = async (event: string, extra: Record<string, unknown> = {}) => {
      const ran = await runHook(harness, input(event, extra), home);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" });
    };
    let call = 0;
    const command = async (script: string, fails = false) => {
      const detail = { tool_name: harness === "claude-code" ? "PowerShell" : "Bash", tool_input: { command: `node -e ${JSON.stringify(script)}` }, tool_use_id: `shell-${++call}` };
      await fire("PreToolUse", detail);
      const run = () => execFileSync(process.execPath, ["-e", script], { cwd: folder, stdio: "ignore" });
      if (fails) assert.throws(run); else run();
      await fire(fails && harness === "claude-code" ? "PostToolUseFailure" : "PostToolUse", detail);
    };
    const write = (name: string, content: string) => `require('node:fs').writeFileSync(${JSON.stringify(name)}, ${JSON.stringify(content)});`;
    const expected: string[][] = [];
    await fire("SessionStart", { source: "startup" });
    await command("0");
    await command(write(file, "export const email = 2;\n")); expected.push([file]);
    await command(write(file, "export const email = 3;\r\n")); expected.push([file]);
    await command("0");
    // Staging and committing leave the file's bytes alone.
    git(folder, "add", ".");
    git(folder, "commit", "-m", "edited");
    await command("0");
    await command(`require('node:fs').unlinkSync(${JSON.stringify(file)});`); expected.push([file]);
    await command(write(file, "export const email = 3;\n")); expected.push([file]);
    const added = "new ü file.txt";
    await command(write(added, "new") + write("ignored.txt", "ignored")); expected.push([added]);
    await command(`require('node:fs').renameSync(${JSON.stringify(added)}, 'moved.txt');`); expected.push(["moved.txt", added].sort());
    await command("require('node:fs').unlinkSync('moved.txt');"); expected.push(["moved.txt"]);
    await command(write(file, "export const email = 4;\n") + "process.exit(1);", true); expected.push([file]);
    // The explicit edit hook already records this write; the next command must not repeat it.
    writeFileSync(path.join(folder, file), "export const email = 5;\n");
    await fire("PostToolUse", harness === "codex"
      ? { tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n*** End Patch` } }
      : { tool_name: "Write", tool_input: { file_path: file } });
    expected.push([file]);
    await command("0");
    // A command may write and commit before its after-hook; it is still an edit.
    await command(write(file, "export const email = 6;\n") + "const {execFileSync:g}=require('node:child_process');g('git',['add','.']);g('git',['-c','user.name=test','-c','user.email=test@storytree.invalid','commit','-m','write and commit']);"); expected.push([file]);

    copyFileSync(`${testServerDataDir()}.owner.json`, path.join(home, "pgdata.owner.json"));
    await command("0"); // The next connected hook uploads the offline lines.
    const edits = (await linesOf(project)).filter((line) => line.kind === "file-edited");
    assert.deepEqual(edits.map((line) => line.files.map((name) => path.relative(folder, path.resolve(folder, name)).split(path.sep).join("/")).sort()), expected);
    assert.ok(edits.every((line) => line.session === session && line.folder === folder && line.branch === "shell-test"));

    const storytree = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      const library = await storytree.openProject(project);
      const story = await library.addStory({ title: "Sign up" });
      const cap = await library.addCapability({ story: story.id, title: "1 · Email" });
      await claimFromEdits({ log, library, project, home });
      assert.deepEqual((await readClaims(log, project)).map(({ session, capability }) => ({ session, capability })), [{ session, capability: cap.id }]);
    } finally {
      await log.close();
      await storytree.close();
      await dropTestProjects([project]);
    }
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
      // Each case five times, each run paired with a bare Node started just after it the same way:
      // every run must exit cleanly and silently, and in at least one pair the command must exit in
      // under half a second. When that pair's bare Node was slower than on an idle machine (a whole
      // test suite, or several, sharing it: one full run on Windows took 1.7 s for a command that
      // takes 0.13 s), what is held to half a second is what the command added to that start,
      // scaled back by how much slower than idle it was: load slows both by a like factor, in bursts.
      const pairs: { ran: Ran; bare: number }[] = [];
      for (let run = 0; run < 5; run++) pairs.push({ ran: await runHook("claude-code", input, home), bare: await runNode() });
      for (const { ran } of pairs) assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, what);
      const added = ({ ran, bare }: { ran: Ran; bare: number }): number =>
        bare <= IDLE_NODE_START_MS ? ran.ms : ((ran.ms - bare) * IDLE_NODE_START_MS) / bare;
      const best = pairs.reduce((a, b) => (added(b) < added(a) ? b : a));
      assert.ok(
        added(best) < QUICK_MS,
        `${what}: at best exited in ${best.ran.ms.toFixed(0)} ms where a bare Node took ${best.bare.toFixed(0)} ms (${pairs.map((pair) => `${pair.ran.ms.toFixed(0)}/${pair.bare.toFixed(0)}`).join(", ")})`,
      );
    }
    assert.deepEqual(await linesOf(project), [], "nothing written for the project");
    assert.equal(await linesAnywhereFor(session), 0, "nothing written anywhere for the session");
  });
});

test("a folder set up for a project that was then deleted writes no lines under its name: not while it is gone, nor into a new project of that name set up since (app setup 3.6)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = storytreeHome(dir, true);
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    const storytree = await connect({ url: testServerUrl() });
    try {
      await setUpProject({ folder, project, storytree, storytreeHome: home });
      await storytree.dropProject(project); // deleted from another computer; this folder still names it
      const start = recorded("claude-code", "session-start-startup", folder);
      assert.equal((await runHook("claude-code", start, home)).code, 0);
      assert.deepEqual(await linesOf(project), [], "nothing written while it is gone");
      await (await storytree.openProject(project)).close(); // a new project of that name, set up elsewhere
      assert.equal((await runHook("claude-code", start, home)).code, 0);
      assert.deepEqual(await linesOf(project), [], "nothing written into the new project");
    } finally {
      await storytree.close();
      await dropTestProjects([project]);
    }
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

test("3.6 where Claude Code's limit on a command is raised (BASH_MAX_TIMEOUT_MS, in the environment its hooks share), the command's started line records it, so the command counts as running until then", () => {
  const input = JSON.parse(recorded("claude-code", "pre-tool-use-bash", "/work/site")) as unknown;
  const before = process.env.BASH_MAX_TIMEOUT_MS;
  try {
    delete process.env.BASH_MAX_TIMEOUT_MS;
    assert.equal((hookLines("claude-code", input)?.lines[0] as { limitMs?: number } | undefined)?.limitMs, undefined, "Claude Code's default limit is the reading's own");
    process.env.BASH_MAX_TIMEOUT_MS = "1800000";
    assert.equal((hookLines("claude-code", input)?.lines[0] as { limitMs?: number } | undefined)?.limitMs, 1_800_000);
  } finally {
    if (before === undefined) delete process.env.BASH_MAX_TIMEOUT_MS;
    else process.env.BASH_MAX_TIMEOUT_MS = before;
  }
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
      { ...claude, kind: "turn-ended", background: 0 },
    ]);

    // On Windows without Git, Claude Code has no Bash tool and runs the command with its PowerShell tool.
    const powerShell = { ...claude, session: "5d0c1f7e-6a2b-4c55-9f0e-0c9d3b1e7a42" } as const;
    for (const name of ["pre-tool-use-bash", "post-tool-use-failure-bash", "post-tool-use-bash"]) {
      const input = { ...JSON.parse(recorded("claude-code", name, folder)), session_id: powerShell.session, tool_name: "PowerShell" };
      const ran = await runHook("claude-code", JSON.stringify(input), home);
      assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, `PowerShell ${name}`);
    }
    assert.deepEqual((await linesOf(project)).filter((line) => line.session === powerShell.session).map(written), [
      { ...powerShell, kind: "command-started", command, call: "toolu_01Kjexd4yP2myMhXEATFdm25" },
      { ...powerShell, kind: "command-run", command, call: "toolu_01Kjexd4yP2myMhXEATFdm25" },
      { ...powerShell, kind: "command-run", command: "echo probe-command", call: "toolu_0198fGg1AbRnVBG34suBFFTy" },
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

test("3.20 at a session's next prompt, the prompt hook adds what storytree left it about claims made from edits, each once, for Claude Code and Codex alike, read from this machine with storytree stopped; another session gets none of it", async () => {
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, uniqueProjectName());
    const home = storytreeHome(dir, false);
    leaveNotice(home, "cc-edits", "[storytree] Your edit claimed \"Email form\" for you.");
    leaveNotice(home, "cx-edits", "[storytree] Claude Code session cc-edits edited a file you hold.");
    const ask = async (harness: "claude-code" | "codex", session: string) => {
      const ran = await runHook(harness, prompted(harness, folder, "go on", session), home);
      assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" });
      return addedContext(ran);
    };
    assert.equal(await ask("claude-code", "cc-other"), undefined, "another session gets none");
    assert.equal(await ask("claude-code", "cc-edits"), "[storytree] Your edit claimed \"Email form\" for you.");
    assert.equal(await ask("claude-code", "cc-edits"), undefined, "each once");
    assert.equal(await ask("codex", "cx-edits"), "[storytree] Claude Code session cc-edits edited a file you hold.");
  });
});

test("3.7 at each prompt, every matching project definition is added for the agent: whole words in any case or plural, longest first, each once a session, meanings cut to 200 characters; a harness's own notice gets none, and with storytree stopped nothing is printed", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    const define = (term: string, meaning: string) => library.defineTerm({ term, meaning });
    const claim = await define("Claim", "Holding a capability while you build it.\nA second agent is refused.");
    const quiet = await define("Quiet time", "How long a session may say nothing before it reads as idle.");
    await define("Id", "Too short to look for.");
    const frontMeaning = "A decision that is the way into a story's knowledge. ".repeat(5);
    const front = await define("Front cover", frontMeaning);
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
          "[storytree] Definitions from this project's library for terms in this prompt (open an artifact by its id to read all of it):",
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
        ["- Front cover", "- Capability", "- Increment", "- Contract", "- Story", "- Arc"],
        "every matching definition, the longest terms first",
      );
      assert.equal(named?.split("\n")[1], `- Front cover (${front.id}): ${frontMeaning.slice(0, 199)}…`, "meanings cut to 200 characters");
      assert.equal(await ask("codex", "Each arc, story, capability, contract, increment and front cover", "cx-1"), undefined, "all six remembered for the session");
    });
  } finally {
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("9.9 past context guidance, the Claude Code prompt hook advises handing off and starting fresh once per session; it never refuses a prompt, and Codex or absent readings get no advice", async (t) => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    await library.defineTerm({ term: "Claim", meaning: "Holding a capability while you build it." });
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const home = storytreeHome(dir, true);
      const transcript = path.join(dir, "session.jsonl");
      const writeTokens = (tokens: number, harness: "claude-code" | "codex" = "claude-code") => writeFileSync(transcript, JSON.stringify(harness === "codex"
        ? { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens } } } }
        : { type: "assistant", requestId: "request-1", message: { model: "claude-opus-5-5", usage: { input_tokens: 1, cache_read_input_tokens: tokens - 1, cache_creation_input_tokens: 0 } } }) + "\n");
      const start = async (session: string, harness: "claude-code" | "codex" = "claude-code") => {
        const input = { ...JSON.parse(recorded(harness, "session-start-startup", folder)), session_id: `${project}-${session}`, transcript_path: transcript };
        const ran = await runHook(harness, JSON.stringify(input), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" });
      };
      const ask = async (session: string, harness: "claude-code" | "codex" = "claude-code", prompt = "Continue", where = home) => {
        const input = { ...JSON.parse(prompted(harness, folder, prompt, `${project}-${session}`)), transcript_path: transcript };
        const ran = await runHook(harness, JSON.stringify(input), where);
        assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" }, "the prompt is never refused");
        const context = addedContext(ran);
        if (context !== undefined) assert.deepEqual(JSON.parse(ran.stdout), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }, "only advice, no blocking decision");
        t.diagnostic(`${harness} ${session}: ${context ?? "(no additional context)"}`);
        return context;
      };
      const advice = (context: string | undefined, tokens: number, guidance: number) => {
        assert.match(context ?? "", /hand off/i);
        assert.match(context ?? "", /fresh session/i);
        assert.ok(context?.includes(tokens.toLocaleString("en-US")), "names tokens used");
        assert.ok(context?.includes(guidance.toLocaleString("en-US")), "names current guidance");
      };

      await t.test("under and at the default add none; past it adds advice once, alongside definitions", async () => {
        const guidance = readSettings(home)["context-guidance"].value;
        await start("default");
        writeTokens(guidance - 1);
        assert.equal(await ask("default"), undefined);
        writeTokens(guidance);
        assert.equal(await ask("default"), undefined);
        writeTokens(guidance + 1);
        const context = await ask("default", "claude-code", "Continue with the claim");
        advice(context, guidance + 1, guidance);
        assert.match(context!, /Claim .*Holding a capability/);
        assert.equal(await ask("default", "claude-code", "Continue with the claim"), undefined, "remembered across separate hook processes");
        writeTokens(guidance - 1);
        assert.equal(await ask("default"), undefined);
        writeTokens(guidance + 2);
        assert.equal(await ask("default"), undefined, "crossing again does not repeat advice");
      });
      await t.test("a changed setting is read afresh and a fresh session gets its own advice", async () => {
        setSetting("context-guidance", "123456", home);
        await start("changed");
        writeTokens(123_456);
        assert.equal(await ask("changed"), undefined);
        setSetting("context-guidance", "123455", home);
        advice(await ask("changed"), 123_456, 123_455);
        assert.equal(await ask("changed"), undefined);
      });
      await t.test("Codex past guidance still gets definitions without advice", async () => {
        writeTokens(900_000, "codex");
        await start("codex", "codex");
        const context = await ask("codex", "codex", "Continue with the claim");
        assert.match(context ?? "", /Claim .*Holding a capability/);
        assert.doesNotMatch(context!, /hand off|fresh session/i);
      });
      await t.test("no reading, an unreadable transcript, stopped storytree, and unreadable settings add none", async () => {
        writeTokens(900_000);
        // No reading: the transcript its hooks name (the recorded one's) is not on this machine.
        const unrecorded = await runHook("claude-code", prompted("claude-code", folder, "Continue", `${project}-unrecorded`), home);
        assert.equal(addedContext(unrecorded), undefined);
        await start("missing");
        rmSync(transcript);
        assert.equal(await ask("missing"), undefined);
        writeTokens(900_000);
        assert.equal(await ask("missing", "claude-code", "Continue", storytreeHome(path.join(dir, "stopped"), false)), undefined);
        writeFileSync(path.join(home, "settings.json"), "{ broken");
        assert.equal(await ask("missing"), undefined);
        rmSync(path.join(home, "settings.json"));
        setSetting("context-guidance", "123455", home);
        advice(await ask("missing"), 900_000, 123_455);
      });
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
      assert.equal(await status(folder), "storytree · holds 1 · Email form · 1 other agent working");

      // Codex names the files it edits relative to its folder: the same file, so a warning.
      await write({ session: "cx-1", harness: "codex", source: "hook", kind: "file-edited", files: ["src/signup.ts"] });
      await write({ session: "cx-2", harness: "codex", source: "hook", kind: "session-started", how: "startup" });
      assert.equal(await status(folder), "storytree · holds 1 · Email form · 2 other agents working · ⚠ src/signup.ts is being edited by Codex too");

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

test("3.12 recorded Claude Code and Codex hook inputs record on their session the transcript the harness named, the latest one recorded being the session's: a `claude -p` run's transcript under an unrelated project directory, and a session moved into worktree B whose transcript is under folder A's, are read from exactly that path, with no folder searched", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (dir) => {
      const home = storytreeHome(dir, true);
      // Worktree B is the project folder the session now works in; its transcripts sit elsewhere.
      const worktreeB = projectFolder(dir, project);
      const usage = (tokens: number) => `${JSON.stringify({ type: "assistant", requestId: `req_${tokens}`, message: { model: "claude-opus-5-5", usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}
`;
      const transcriptIn = (folder: string, name: string, text: string): string => {
        mkdirSync(folder, { recursive: true });
        const file = path.join(folder, name);
        writeFileSync(file, text);
        return file;
      };
      const hookWith = async (harness: "claude-code" | "codex", name: string, transcript: string, session?: string) => {
        const input = { ...JSON.parse(recorded(harness, name, worktreeB)), transcript_path: transcript, ...(session === undefined ? {} : { session_id: session }) };
        const ran = await runHook(harness, JSON.stringify(input), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
      };

      // A `claude -p` run: its transcript is under a project directory unrelated to its folder.
      const batch = transcriptIn(path.join(dir, "claude", "projects", "C--elsewhere-main-checkout"), "batch.jsonl", usage(21_000));
      await hookWith("claude-code", "session-start-startup", batch, "batch-session");
      const batchReading = await readContext(log, project, "batch-session");
      assert.deepEqual({ tokens: "tokens" in batchReading ? batchReading.tokens : undefined, source: batchReading.source }, { tokens: 21_000, source: batch });

      // A session that started in folder A and moved into worktree B: the transcript stays under A's directory.
      const fromA = transcriptIn(path.join(dir, "claude", "projects", "C--work-folder-A"), "moved.jsonl", usage(43_000));
      await hookWith("claude-code", "post-tool-use-bash", fromA, "moved-session");
      // Another session, more recently active and working in B too, is never read for it.
      const other = transcriptIn(path.join(dir, "claude", "projects", "C--work-folder-B"), "other.jsonl", usage(99_000));
      await hookWith("claude-code", "post-tool-use-write", other, "other-session");
      const moved = await readContext(log, project, "moved-session");
      assert.equal("tokens" in moved && moved.tokens, 43_000);
      assert.equal(moved.source, fromA);

      // The latest transcript recorded for a session is its transcript.
      const later = transcriptIn(path.join(dir, "claude", "projects", "C--work-folder-A"), "later.jsonl", usage(7_000));
      await hookWith("claude-code", "session-end", later, "moved-session");
      assert.equal((await readContext(log, project, "moved-session")).source, later);

      // Codex names its rollout the same way.
      const rollout = transcriptIn(path.join(dir, "codex", "sessions"), "rollout.jsonl", `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 12_348 } } } })}
`);
      await hookWith("codex", "post-tool-use-bash", rollout, "codex-session");
      const codex = await readContext(log, project, "codex-session");
      assert.deepEqual({ harness: codex.harness, tokens: "tokens" in codex ? codex.tokens : undefined, source: codex.source }, { harness: "codex", tokens: 12_348, source: rollout });
    });
  } finally {
    await log.close();
    await dropTestProjects([project]);
  }
});

test("3.14 lines a hook writes while storytree cannot be reached wait on this machine; the next hook that reaches it uploads them first, at their own times and in order, exactly once", async () => {
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const home = storytreeHome(dir, false);
      const folder = projectFolder(dir, project);
      const session = `${project}-queued`;
      const hookRun = async (name: string) => {
        const input = { ...JSON.parse(recorded("claude-code", name, folder)), session_id: session };
        const ran = await runHook("claude-code", JSON.stringify(input), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, name);
      };
      await hookRun("session-start-startup");
      await hookRun("post-tool-use-bash");
      assert.equal(await linesAnywhereFor(session), 0, "nothing reaches the log while storytree is stopped");
      const back = new Date();

      copyFileSync(`${testServerDataDir()}.owner.json`, path.join(home, "pgdata.owner.json")); // storytree is back
      await hookRun("stop");
      await hookRun("stop");
      const lines = await linesOf(project);
      assert.deepEqual(lines.map((line) => line.kind), ["session-started", "command-run", "turn-ended", "turn-ended"], "the waiting lines first, in order, once");
      assert.ok(Date.parse(lines[1]!.at) < back.getTime(), "each at the time its hook wrote it");
      assert.equal(lines[0]!.machine, MACHINE);
    });
  } finally {
    await dropTestProjects([project]);
  }
});

test("3.23 a hook whose writing throws, or that cannot reach storytree, leaves one local trace of why (harness, event, session, tool call, error), still silent and exiting cleanly; a healthy hook leaves none (regression: the laptop's storytree tool calls went unrecorded for seven minutes with no evidence why, 2026-10-06)", async () => {
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const call = (session: string) => JSON.stringify({ ...JSON.parse(recorded("claude-code", "pre-tool-use-storytree", folder)), session_id: session });
      const traced = (home: string, session: string) => hookFailures(home, session).map(({ harness, event, session, toolUseId, stage, error }) => ({ harness, event, session, toolUseId, stage, class: error.class }));
      const silent = (ran: Ran, what: string) => assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" }, what);

      // Healthy: storytree running, the line written, nothing traced.
      const healthy = storytreeHome(path.join(dir, "healthy"), true);
      silent(await runHook("claude-code", call(`${project}-healthy`), healthy), "healthy");
      assert.equal((await linesOf(project)).length, 1, "the healthy hook's line is written");
      assert.equal(existsSync(hookFailuresFile(healthy)), false, "a healthy hook leaves no trace");

      // The writing throws: storytree stopped, and the place lines wait on this machine cannot be made.
      const blocked = storytreeHome(path.join(dir, "blocked"), false);
      writeFileSync(queueFolder(blocked), "not a folder");
      silent(await runHook("claude-code", call(`${project}-blocked`), blocked), "blocked");
      assert.deepEqual(traced(blocked, `${project}-blocked`), [
        { harness: "claude-code", event: "PreToolUse", session: `${project}-blocked`, toolUseId: "toolu_018cKhhRDozwv48NrNJx8p4z", stage: "write", class: "Error EEXIST" },
      ]);

      // Storytree's database does not answer: the line waits on this machine, and why is traced.
      const unreachable = storytreeHome(path.join(dir, "unreachable"), true);
      const record = path.join(unreachable, "pgdata.owner.json");
      writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), port: await closedPort() }));
      silent(await runHook("claude-code", call(`${project}-unreachable`), unreachable), "unreachable");
      assert.deepEqual(traced(unreachable, `${project}-unreachable`).map(({ stage, session }) => ({ stage, session })), [{ stage: "reach", session: `${project}-unreachable` }]);
      assert.equal(readdirSync(queueFolder(unreachable)).length, 1, "the line waits for the next hook");
      assert.deepEqual(hookFailures(unreachable, "another-session"), [], "another session's trace is its own");
    });
  } finally {
    await dropTestProjects([project]);
  }
});

/** A port on this machine nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("3.13 each hook streams its session's new transcript records, and each subagent's under its parent, into the shared log, secrets scrubbed, from where the last hook left off and never twice (ADR-0749 D3, D4)", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (dir) => {
      const home = storytreeHome(dir, true);
      const folder = projectFolder(dir, project);
      const session = `${project}-streamed`;
      const transcript = path.join(dir, "claude", `${session}.jsonl`);
      mkdirSync(path.join(dir, "claude", session, "subagents"), { recursive: true });
      // A fake key built at run time, so no scanner mistakes this file for a leak.
      const key = `sk-${"ant-api03-"}${"x".repeat(40)}`;
      const first = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: `ANTHROPIC_API_KEY=${key}` }] } });
      const second = JSON.stringify({ type: "assistant", requestId: "r2", message: { model: "claude-opus-5-5", usage: { input_tokens: 5 } } });
      const child = JSON.stringify({ type: "assistant", isSidechain: true, message: { content: "reading" } });
      writeFileSync(transcript, `${first}\n${second.slice(0, 10)}`); // the second record is still being written
      writeFileSync(path.join(dir, "claude", session, "subagents", "agent-a1b2.jsonl"), `${child}\n`);
      const hookRun = async () => {
        const input = { ...JSON.parse(recorded("claude-code", "post-tool-use-bash", folder)), session_id: session, transcript_path: transcript };
        const ran = await runHook("claude-code", JSON.stringify(input), home);
        assert.deepEqual({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr }, { code: 0, stdout: "", stderr: "" });
      };
      await hookRun();
      const scrubbed = first.replace(key, "[scrubbed: API key]");
      assert.equal(await log.transcripts.text(project, session), scrubbed, "only whole records, the key stored as its marker");
      assert.equal(await log.transcripts.text(project, session, "a1b2"), child, "a subagent's transcript is stored under its parent session, by its id");

      writeFileSync(transcript, `${first}\n${second}\n`);
      await hookRun();
      await hookRun();
      assert.equal(await log.transcripts.text(project, session), `${scrubbed}\n${second}`, "the next hook ships only what is new, once");
    });
  } finally {
    await log.close();
    await dropTestProjects([project]);
  }
});

test("3.15 recorded prompt inputs make a prompt line on their session, for Claude Code and Codex alike, and a Claude Code turn that ends with background tasks still running writes its end line with how many (ADR-0754 D5)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    for (const harness of ["claude-code", "codex"] as const) {
      const ran = await runHook(harness, recorded(harness, "user-prompt-submit", folder), home);
      assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" }, harness);
    }
    const stop = { ...JSON.parse(recorded("claude-code", "stop", folder)), background_tasks: [{ id: "b1", type: "shell" }] };
    await runHook("claude-code", JSON.stringify(stop), home);
    const common = { project, source: "hook", folder, machine: MACHINE } as const;
    assert.deepEqual((await linesOf(project)).map(written), [
      { ...common, session: "f0451558-ef9c-4014-b2cd-1edeb2de7682", harness: "claude-code", kind: "prompt-submitted" },
      { ...common, session: "01a0de50-e5be-7731-8e02-d411fd8845fe", harness: "codex", kind: "prompt-submitted" },
      { ...common, session: "b4f8eff5-05ab-4ef2-b070-78375e2a5deb", harness: "claude-code", kind: "turn-ended", background: 1 },
    ]);
  });
});

test("3.16 every line a hook writes records the git branch its folder is on, beside the folder; a folder on no branch records none (ADR-0754 D4)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, stdio: "ignore" });
    git("init", "-q", "-b", "claude/fix-login");
    for (const name of ["session-start-startup", "post-tool-use-bash"]) await runHook("claude-code", recorded("claude-code", name, folder), home);
    rmSync(path.join(folder, ".git"), { recursive: true, force: true });
    await runHook("claude-code", recorded("claude-code", "session-end", folder), home);
    // The look around the machine a hook hands on (4.10) writes at its own time what it finds of the branch: not a line of the hooks'.
    assert.deepEqual((await linesOf(project)).filter((line) => line.kind !== "branch-state").map((line) => [line.kind, line.branch]), [
      ["session-started", "claude/fix-login"],
      ["command-run", "claude/fix-login"],
      ["session-ended", undefined],
    ]);
  });
});

test("4.22 a hook run from a subfolder of a worktree records the worktree's root as its folder, so a session lists each worktree once (regression, 2026-10-02: package subfolders listed as worktrees)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    execFileSync("git", ["init", "-q", "-b", "claude/fix-login"], { cwd: folder, stdio: "ignore" });
    const inPackage = path.join(folder, "packages", "forest");
    mkdirSync(inPackage, { recursive: true });
    await runHook("claude-code", recorded("claude-code", "session-start-startup", folder), home);
    await runHook("claude-code", recorded("claude-code", "post-tool-use-bash", inPackage), home);
    assert.deepEqual((await linesOf(project)).filter((line) => line.kind !== "branch-state").map((line) => [line.kind, line.folder]), [
      ["session-started", folder],
      ["command-run", folder],
    ]);
  });
});

test("3.19 a Claude Code session's end is recorded though Claude Code stops its end hook after 1.5 s and the store takes longer than that to answer: the hook, run as setup registers it, hands its line to one that outlives it", async () => {
  const project = uniqueProjectName();
  const owner = JSON.parse(readFileSync(`${testServerDataDir()}.owner.json`, "utf8")) as { port: number };
  // A store that answers only after 1.6 s: every connection is passed on to the test Postgres late.
  const slow = createServer((client) => {
    client.pause();
    setTimeout(() => {
      const upstream = connectTcp(owner.port, "127.0.0.1", () => {
        client.pipe(upstream).pipe(client);
        client.resume();
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    }, 1_600);
  });
  await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
  try {
    await withTempDir(async (dir) => {
      const folder = projectFolder(dir, project);
      const home = path.join(dir, "slow-home");
      mkdirSync(home);
      writeFileSync(path.join(home, "pgdata.owner.json"), JSON.stringify({ ...owner, port: (slow.address() as AddressInfo).port }));
      const claude = path.join(dir, "claude-home");
      mkdirSync(claude);
      registerHooks({ claude }, { node: process.execPath, script: hook });
      const settings = JSON.parse(readFileSync(path.join(claude, "settings.json"), "utf8")) as { hooks: { SessionEnd: { hooks: { command: string; args: string[] }[] }[] } };
      const { command, args } = settings.hooks.SessionEnd[0]!.hooks[0]!;

      // Run as Claude Code runs it, and cut short at 1.5 s as Claude Code does (2.1.284: AbortSignal.timeout(1500)).
      const child = spawn(command, args, { env: { ...process.env, STORYTREE_HOME: home }, stdio: ["pipe", "ignore", "ignore"], shell: false });
      const cut = setTimeout(() => child.kill("SIGKILL"), 1_500);
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        child.stdin.end(recorded("claude-code", "session-end", folder));
      });
      clearTimeout(cut);

      const deadline = Date.now() + 8_000;
      while (!(await linesOf(project)).some((line) => line.kind === "session-ended") && Date.now() < deadline) await sleep(100);
      assert.deepEqual((await linesOf(project)).map((line) => line.kind), ["session-ended"]);
    });
  } finally {
    slow.close();
  }
});

test("4.10 a pull request's merge is recorded on its branch by the hooks though GitHub takes longer to answer than a hook may run (regression: no hook had ever recorded one, 2026-09-30)", { skip: process.platform === "win32" && "platform:posix: a stand-in gh on PATH must be an .exe on Windows", timeout: 30_000 }, async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = projectFolder(dir, project);
    const home = storytreeHome(dir, true);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args], { cwd: folder, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "first");
    git("switch", "-q", "-c", "claude/fix");
    git("commit", "-q", "--allow-empty", "-m", "work");
    // GitHub, as `gh` answers, but 6 s late: longer than a hook may run.
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const pulls = JSON.stringify([{ number: 7, mergedAt: "MERGED_AT", headRefName: "claude/fix" }]);
    writeFileSync(path.join(bin, "gh"), `#!${process.execPath}\nsetTimeout(() => console.log(${JSON.stringify(pulls)}.replace("MERGED_AT", new Date().toISOString())), 6_000);\n`, { mode: 0o755 });

    await runHook("claude-code", recorded("claude-code", "post-tool-use-write", folder), home, [], { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` });
    const deadline = Date.now() + 20_000;
    const merged = async () => (await linesOf(project)).flatMap((line) => (line.kind === "branch-state" ? [[line.of, line.open, line.how, line.pr]] : []));
    while ((await merged()).length === 0 && Date.now() < deadline) await sleep(250);
    assert.deepEqual(await merged(), [["claude/fix", false, "merged", 7]]);
  });
});

test("3.21 a hook's reads do not grow with the log's length: the same hooks (a command's finish, which also hands on the look around the machine, a prompt, and the status line) take about as much from the store in a project whose log holds weeks of history as in one whose log holds an hour's", { timeout: 120_000 }, async () => {
  const [short, long] = [uniqueProjectName(), uniqueProjectName()];
  const owner = JSON.parse(readFileSync(`${testServerDataDir()}.owner.json`, "utf8")) as Record<string, unknown>;
  const log = await openActivityLog(testServerUrl());
  try {
    const taken: Record<string, number> = {};
    let history = 0;
    for (const project of [short, long]) {
      await withTempDir(async (dir) => {
        const folder = projectFolder(dir, project);
        // The same last hour in both: two sessions working, one of them editing files.
        for (const session of ["now-1", "now-2"]) {
          const write = (line: Record<string, unknown>) => log.append(project, { session, harness: "claude-code", source: "hook", folder, ...line } as NewLine);
          await write({ kind: "session-started", how: "startup" });
          await write({ kind: "prompt-submitted" });
          await write({ kind: "file-edited", files: [path.join(folder, "src", `${session}.ts`)] });
          await write({ kind: "command-started", command: "pnpm test", call: `${session}-call` });
          await write({ kind: "command-run", command: "pnpm test", call: `${session}-call` });
          await write({ kind: "turn-ended" });
        }
        if (project === long) history = await longHistory(project, folder, 400, MACHINE);

        const store = await countingStore();
        try {
          const home = path.join(dir, "counted-home");
          mkdirSync(home);
          writeFileSync(path.join(home, "pgdata.owner.json"), JSON.stringify({ ...owner, port: store.port }));
          const status = JSON.stringify({ hook_event_name: "Status", session_id: "now-1", cwd: folder, workspace: { current_dir: folder, project_dir: folder } });
          for (const ran of [
            await runHook("claude-code", recorded("claude-code", "post-tool-use-bash", folder), home),
            await runHook("claude-code", recorded("claude-code", "user-prompt-submit", folder), home),
            await runHook("statusline", status, home),
          ]) assert.deepEqual({ code: ran.code, stderr: ran.stderr }, { code: 0, stderr: "" });
          // The look around the machine runs on in a copy of the hook: wait for it too.
          await store.settled(1_500, 60_000);
          taken[project] = store.received();
        } finally {
          await store.close();
        }
        assert.ok((await linesOf(project)).some((line) => line.kind === "command-run" && line.command === "echo probe-command"), "the hook wrote its line");
      });
    }
    assert.ok(history > 20_000_000, `the long history is weeks' worth: ${history} bytes`);
    assert.ok(taken[long]! - taken[short]! < 128 * 1024,
      `the hooks took ${taken[short]} bytes from a short log and ${taken[long]} from one ${history} bytes longer: no more than 128 KiB apart`);
  } finally {
    await log.close();
    await dropTestProjects([short, long]);
  }
});
