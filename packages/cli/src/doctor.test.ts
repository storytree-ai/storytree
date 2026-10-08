/**
 * Capability 8 · Doctor: one test per contract 8.1-8.4 in the command line story, each running the real,
 * built `storytree doctor`.
 *
 * Every run is in a throwaway user home: HOME and USERPROFILE, Claude Code's and Codex's settings
 * folders, and a folder of the user's own on the PATH, all under the test's folder, so the check
 * never touches this machine's settings. A stand-in hook script sits beside the built command, as
 * storytree's hook sits beside it once installed, so the check registers hooks and puts the command
 * on the path as it does for a user. First on the PATH is a `gh` that is signed out: a copy of Node,
 * which `gh auth status` runs, and which fails as a signed-out gh does. The user's folder holds a
 * signed-in Claude Code and Codex that only answer, so the check never reaches the developer's own,
 * which write files of their own into the throwaway home.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { probeProcess, readProcess, type ProcessIdentity } from "@storytree/processes";
import { BuiltCommand, dropTestProjects, inWorld, placeHandoff, storytree, testServerDataDir, uniqueProjectName, type World } from "./testing/cli.js";

const STUB_APP = fileURLToPath(new URL("./testing/stub-app.mjs", import.meta.url));

const command = new BuiltCommand();
/** A folder holding a signed-out `gh`, made once for every test. */
let ghFolder: string;
/**
 * A folder standing in for the developer's own PATH, after the user's: its `claude` writes a file of
 * its own into Claude Code's settings folder whenever it runs, as the real Claude Code does.
 */
let developerFolder: string;

before(async () => {
  await command.build();
  writeFileSync(path.join(command.dir, "storytree-hook.mjs"), "// a stand-in for storytree's hook: the doctor only registers it\n");
  ghFolder = mkdtempSync(path.join(tmpdir(), "storytree-cli-gh-"));
  const gh = path.join(ghFolder, process.platform === "win32" ? "gh.exe" : "gh");
  if (process.platform === "win32") {
    try {
      linkSync(process.execPath, gh);
    } catch {
      copyFileSync(process.execPath, gh);
    }
  } else {
    symlinkSync(process.execPath, gh);
  }
  developerFolder = mkdtempSync(path.join(tmpdir(), "storytree-cli-developer-"));
  if (process.platform === "win32") {
    writeFileSync(path.join(developerFolder, "claude.cmd"), "@echo off\r\ntype nul > \"%CLAUDE_CONFIG_DIR%\\.claude.json.tmp.%RANDOM%%RANDOM%\"\r\nexit /b 0\r\n");
  } else {
    writeFileSync(path.join(developerFolder, "claude"), "#!/bin/sh\n: > \"$CLAUDE_CONFIG_DIR/.claude.json.tmp.$$\"\nexit 0\n");
    chmodSync(path.join(developerFolder, "claude"), 0o755);
  }
});

after(() => {
  command.remove();
  rmSync(ghFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(developerFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A throwaway user: their home, the harnesses' settings folders, and a folder of their own on the PATH. */
interface User {
  readonly home: string;
  readonly env: Record<string, string>;
}

function aUser(world: World): User {
  const home = path.join(path.dirname(world.folder), "user");
  const bin = path.join(home, "bin");
  const claude = path.join(home, ".claude");
  const codex = path.join(home, ".codex");
  for (const folder of [bin, claude, codex]) mkdirSync(folder, { recursive: true });
  agentCli(bin, "claude", ["--version", "auth status"]);
  agentCli(bin, "codex", ["--version", "login status"]);
  const env = {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: claude,
    CODEX_HOME: codex,
    PATH: [ghFolder, bin, developerFolder, process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter),
  };
  return { home, env };
}

/** A stand-in agent CLI named `name` in `bin`: it answers each of `answers` as signed in, and fails anything else. */
function agentCli(bin: string, name: string, answers: readonly string[]): void {
  if (process.platform === "win32") {
    const cases = answers.map((args) => `if "%*"=="${args}" exit /b 0`);
    writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\n${cases.join("\r\n")}\r\nexit /b 1\r\n`);
  } else {
    const cases = answers.map((args) => `if [ "$*" = "${args}" ]; then exit 0; fi`);
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${cases.join("\n")}\nexit 1\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
}

/** Every file under `folders`, by path, with its text: what a run may change. */
function snapshot(...folders: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string): void => {
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name);
      if (statSync(file).isDirectory()) walk(file);
      else files[file] = readFileSync(file, "utf8");
    }
  };
  for (const folder of folders) walk(folder);
  return files;
}

for (const interrupted of [false, true]) test(`8.1 with storytree closed, it opens it; its test stand-in ends after ${interrupted ? "interruption" : "completion"}`, async () => {
  await inWorld(command, async (world) => {
    const user = aUser(world);
    const closedHome = world.stoppedHome;
    const dataDir = path.join(closedHome, "pgdata");
    // The stand-in writes the owner record; the sign-in handoff the app would keep beside it is placed now.
    placeHandoff(dataDir);
    // Run the proof in its own process, so killing it really skips its teardown. The real doctor
    // launches the detached app; this owner must outlive that short-lived command.
    const owner = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
      import { writeFileSync } from "node:fs";
      import { storytree } from ${JSON.stringify(new URL("./testing/cli.ts", import.meta.url).href)};
      const { script, stub, dataDir, server, options, parent } = JSON.parse(process.argv[1]);
      setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(); } }, 250);
      process.on("message", () => process.exit());
      writeFileSync(options.home + "/app.json", JSON.stringify({ command: process.execPath, args: [stub, dataDir, server, String(process.pid)] }));
      process.send(await storytree(script, ["doctor"], options));
    `, JSON.stringify({ script: command.script, stub: STUB_APP, dataDir, server: testServerDataDir(),
      options: { cwd: world.folder, home: closedHome, env: user.env }, parent: process.pid })], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    owner.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const ownerExited = once(owner, "exit");
    let app: ProcessIdentity | undefined;
    try {
      const [ran] = await Promise.race([
        once(owner, "message"),
        ownerExited.then(() => { throw new Error(`Doctor test owner exited before its result: ${stderr}`); }),
      ]);

      assert.equal(ran.code, 0, ran.stderr);
      assert.match(ran.stdout, /storytree was closed, so it has been opened/);
      const { pid } = JSON.parse(readFileSync(`${dataDir}.owner.json`, "utf8")) as { pid: number };
      const reading = await readProcess(pid);
      assert.equal(reading.state, "live", "storytree is running after the doctor command exits");
      if (reading.state !== "live") throw new Error("the stand-in did not stay alive");
      app = reading.identity;

      if (interrupted) owner.kill("SIGKILL");
      else owner.send("done");
      await ownerExited;
      await appEnded(app);
      assert.equal(existsSync(closedHome), false, "the stand-in removed its disposable home");
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
      await ownerExited;
      // Clean even a failing proof, checking lifetime identity before killing a possibly reused PID.
      if (app === undefined && existsSync(`${dataDir}.owner.json`)) {
        const reading = await readProcess(JSON.parse(readFileSync(`${dataDir}.owner.json`, "utf8")).pid);
        if (reading.state === "live") app = reading.identity;
      }
      if (app !== undefined && (await probeProcess(app)).state === "live") {
        process.kill(app.pid, "SIGKILL");
        await appEnded(app);
      }
    }
  });
});

async function appEnded(app: ProcessIdentity): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await probeProcess(app)).state === "gone") return;
    await pause(50);
  }
  assert.fail("the Doctor app stand-in outlived its test owner by five seconds");
}

test("8.2 with `gh` signed out, it notes what gh is for and names no fix for it", async () => {
  await inWorld(command, async (world) => {
    const user = aUser(world);

    const ran = await world.run(["doctor"], user.env);

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /gh command is not (signed in|installed)\. storytree works without it/);
    assert.doesNotMatch(ran.stdout, /gh auth login/);
  });
});

test("8.3 in a folder that is not a project, it creates nothing unless told to", async () => {
  await inWorld(command, async (world) => {
    const user = aUser(world);
    const before = snapshot(world.elsewhere);

    const asked = await storytree(command.script, ["doctor"], { cwd: world.elsewhere, home: world.home, env: user.env });

    assert.equal(asked.code, 0, asked.stderr);
    assert.match(asked.stdout, /not a storytree project/);
    assert.match(asked.stdout, /storytree doctor --set-up /);
    assert.deepEqual(snapshot(world.elsewhere), before);

    const project = uniqueProjectName();
    try {
      const told = await storytree(command.script, ["doctor", "--set-up", project], { cwd: world.elsewhere, home: world.home, env: user.env });
      assert.equal(told.code, 0, told.stderr);
      assert.equal(JSON.parse(readFileSync(path.join(world.elsewhere, ".storytree.json"), "utf8")).project, project);
    } finally {
      await dropTestProjects([project]);
    }
  });
});

test("8.6 with Codex's hooks registered and none of them run yet, it names the one step that lets Codex run them (agent link 8.16)", async () => {
  await inWorld(command, async (world) => {
    const user = aUser(world);

    const ran = await world.run(["doctor"], user.env);

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /Codex has storytree's hooks but has not run one yet[^\n]*Fix: In Codex, type \/hooks/);
  });
});

test("8.4 a second run changes nothing", async () => {
  await inWorld(command, async (world) => {
    const user = aUser(world);
    const first = await world.run(["doctor"], user.env);
    assert.equal(first.code, 0, first.stderr);
    assert.ok(existsSync(path.join(user.home, ".claude", "settings.json")), `the first run registered storytree's hooks:\n${first.stdout}`);
    const after = snapshot(user.home, world.folder);

    const second = await world.run(["doctor"], user.env);

    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(snapshot(user.home, world.folder), after);
  });
});
