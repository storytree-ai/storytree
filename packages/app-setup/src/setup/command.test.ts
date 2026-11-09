/**
 * Capability 18 · Built commands: the `storytree` command put on the user's path and taken off it (18.1), and the hooks
 * and command registered from a build of origin/main on a machine with no desktop app (18.2).
 *
 * Each test works in a throwaway home (../testing/homes.ts).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { waitUntil } from "@storytree/test-waits";

import { buildBins } from "../bins/build.js";
import { runSetupCheck } from "./index.js";
import { builtFromMain, launcherFile, putCommandOnPath, registerHooks, removeCommand, type HookCommand } from "./index.js";
import { ANSWERED, CLAUDE_SETTINGS, CODEX_CONFIG, readJson, storytreeHooks, throwawayHome } from "../testing/homes.js";

let bins: string;
let hookScript: string;

before(async () => {
  bins = mkdtempSync(path.join(tmpdir(), "storytree-link-bins-"));
  hookScript = (await buildBins(bins))["storytree-hook"]!;
});

after(() => {
  rmSync(bins, { recursive: true, force: true });
});

test("18.1 in a throwaway home, the first start puts a storytree command on the path, a second changes nothing, and removing storytree takes it out", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const command = { path: bin, home: dir };
    const hook: HookCommand = { node: process.execPath, script: hookScript };
    const start = () => runSetupCheck({ ...ANSWERED, folder: dir, hook, homes: home.homes, storytreeHome: home.storytreeHome, command });
    const file = path.join(bin, launcherFile());

    assert.equal((await start()).command, "installed");
    // It runs as the user would run it: by its name, through their shell, found on the path.
    const ran = spawnSync("storytree", [], { shell: true, encoding: "utf8", env: { ...process.env, PATH: bin, Path: bin } });
    assert.match(`${ran.stdout}${ran.stderr}`, /storytree: read and change your project's records/, `it is storytree's command: ${ran.stdout}${ran.stderr}`);
    const first = readFileSync(file);

    assert.equal((await start()).command, "already installed");
    assert.deepEqual(readFileSync(file), first, "not a byte changed");

    assert.equal(removeCommand(command), "removed");
    assert.equal(existsSync(file), false);
    assert.equal(removeCommand(command), "none", "and removing again finds nothing");

    writeFileSync(file, "a storytree of the user's own\n");
    assert.equal((await start()).command, "another storytree kept");
    assert.equal(removeCommand(command), "none");
    assert.equal(readFileSync(file, "utf8"), "a storytree of the user's own\n", "theirs, untouched");
  });
});

test("18.1 storytree's own command in a folder outside the home is never touched: the command goes into the home's folder, and removing takes out only that one (regression: launcher.test rewrote developers' real command, 2026-09-29)", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const bin = path.join(home, ".local", "bin");
    const elsewhere = path.join(dir, "elsewhere", "bin");
    for (const folder of [bin, elsewhere]) mkdirSync(folder, { recursive: true });
    const name = launcherFile();
    // Another home's install of storytree, left by the setup check under a different HOME.
    const theirs = path.join(elsewhere, name);
    const hook: HookCommand = { node: process.execPath, script: hookScript };
    putCommandOnPath({ path: elsewhere, home: path.dirname(elsewhere) }, hook.node, path.join(path.dirname(hookScript), "an older storytree.mjs"));
    const before = readFileSync(theirs);
    const command = { path: [bin, elsewhere].join(path.delimiter), home };

    assert.equal(putCommandOnPath(command, hook.node, path.join(path.dirname(hookScript), "storytree.mjs")), "installed");
    assert.ok(existsSync(path.join(bin, name)), "put in the home's folder");
    assert.deepEqual(readFileSync(theirs), before, "the one outside the home, untouched");

    assert.equal(removeCommand(command), "removed");
    assert.equal(existsSync(path.join(bin, name)), false);
    assert.deepEqual(readFileSync(theirs), before, "and still there after removing");
  });
});

test("18.1 an older storytree launcher in the home that runs another build is repointed, and the check names it and what it ran before", async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const command = { path: bin, home: dir };
    const older = path.join(dir, "an older storytree.mjs");
    // On Windows an older install's launcher is the batch file storytree wrote before ADR-0854.
    const file = path.join(bin, process.platform === "win32" ? "storytree.cmd" : "storytree");
    if (process.platform === "win32") {
      writeFileSync(file, `@echo off\r\nrem storytree 0.3's command (put here by its setup check)\r\ngoto #_storytree_handoff_# 2>nul || "${process.execPath}" "${older}" %*\r\n`);
    } else {
      putCommandOnPath(command, process.execPath, older);
    }

    const said = putCommandOnPath(command, process.execPath, path.join(path.dirname(hookScript), "storytree.mjs"));
    assert.equal(said, `installed (replaced ${file}, which ran ${older})`);
    assert.deepEqual(readdirSync(bin), [launcherFile()], "the launcher takes the older one's place in its folder");
  });
});

test("18.1 setup remove exits cleanly through the Windows launcher it removes: the launcher is off the path when the command returns, and deleted once it has exited (regression: storytree#83; ADR-0854)", {
  skip: process.platform !== "win32" && "platform:win32: only Windows refuses to delete the running program that setup remove runs through",
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
    const launcher = path.join(bin, "storytree.exe");
    assert.ok(existsSync(launcher), "the real launcher is installed on the path");

    const invalid = spawnSync("storytree setup invalid", { shell: true, env, cwd: profile, encoding: "utf8" });
    assert.equal(invalid.status, 2, "the launcher preserves a failing command's exit code");
    const removed = spawnSync("storytree setup remove", { shell: true, env, cwd: profile, encoding: "utf8" });
    assert.equal(removed.status, 0, `${removed.stdout}${removed.stderr}`);
    assert.equal(existsSync(launcher), false, "the launcher is off the path when the command returns");
    await waitUntil(() => readdirSync(bin).length === 0, 10_000, "the launcher to be deleted once it has exited");
    assert.deepEqual(readdirSync(bin), [], "and deleted once it has exited");
    assert.deepEqual(readJson(home.claudeSettings), CLAUDE_SETTINGS);
    assert.equal(existsSync(home.codexHooks), false);
    assert.equal(readFileSync(home.codexConfig, "utf8"), CODEX_CONFIG);
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

test("18.2 with no desktop app, a session whose tool server runs from a checkout at origin/main registers the hooks from a build of that commit kept in the storytree home; a checkout off main, or hooks the app installed, are left as they are (regression: the Mint box's hooks ran a build from 746caf1, 2026-09-30)", async () => {
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
    await runSetupCheck({ ...ANSWERED, folder: dir, hook, homes: home.homes, storytreeHome: home.storytreeHome, calling: "claude-code" });
    assert.ok(Object.keys(storytreeHooks(readJson(home.claudeSettings), hook.script, "claude-code")).length > 0, "Claude Code runs that build");

    // A branch with work on it is not main: its hooks are not what every session on the machine should run.
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "branch work"], { cwd: folder });
    assert.equal(await builtFromMain(options), undefined, "a checkout off main registers nothing");

    // Where the desktop app installed the hooks, its updater keeps them current: they stay the app's.
    spawnSync("git", ["reset", "-q", "--hard", commit], { cwd: folder });
    const app: HookCommand = { node: process.execPath, script: path.join(dir, "Programs", "storytree-0.3", "resources", "agent-tools", "storytree-hook.mjs") };
    registerHooks(home.homes, app);
    assert.equal(await builtFromMain(options), undefined, "hooks the app installed are kept");
    // On Windows the app's hooks run its build's copy under the home (Get storytree 1.19): those stay the app's too.
    registerHooks(home.homes, { node: process.execPath, script: path.join(home.storytreeHome, "app-tools", "0123456789abcdef", "storytree-hook.mjs") });
    assert.equal(await builtFromMain(options), undefined, "hooks running the app's copy are kept");
  });
});

test("18.2 a checkout at origin's main registers that build even when its own origin/main ref is older, as a cloud container's cached clone leaves it; a branch with work on it still registers nothing (regression: 29 of 31 cloud sessions wrote no hook line, 2026-11-02)", async () => {
  await withTempDir(async (dir) => {
    const home = throwawayHome(dir);
    const origin = path.join(dir, "origin.git");
    spawnSync("git", ["init", "-q", "--bare", origin]);
    const { folder, commit: old } = checkoutOfMain(dir);
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, encoding: "utf8" }).stdout.trim();
    git("remote", "add", "origin", origin);
    // Main moves on after the clone was cached; the session's branch is cut from main as it is now, and only it is fetched.
    git("commit", "-q", "--allow-empty", "-m", "main, later");
    git("push", "-q", "origin", "HEAD:refs/heads/main");
    git("update-ref", "refs/remotes/origin/main", old);
    const commit = git("rev-parse", "HEAD");
    const build = async (outdir: string) => {
      mkdirSync(outdir, { recursive: true });
      writeFileSync(path.join(outdir, "storytree-hook.mjs"), "");
    };
    const options = { checkout: folder, storytreeHome: home.storytreeHome, homes: home.homes, build };

    const hook = await builtFromMain(options);
    assert.ok(hook !== undefined, "a checkout at origin's main gives a hook to register, whatever its own ref says");
    assert.equal(path.dirname(hook.script), path.join(home.storytreeHome, "agent-tools", commit), "built from main's commit as origin has it");

    git("commit", "-q", "--allow-empty", "-m", "branch work");
    assert.equal(await builtFromMain(options), undefined, "a branch with work on it is still not main");
  });
});

test("18.2 a build of main, run from outside the checkout, loads the embedding runtime its library search ranks by meaning with (regression: the Mint box's installed tools ranked by words, 2026-10-02)", { timeout: 120_000 }, async () => {
  await withTempDir(async (dir) => {
    const { folder } = checkoutOfMain(dir);
    const hook = await builtFromMain({ checkout: folder, storytreeHome: path.join(dir, ".storytree", "0.3"), homes: { claude: path.join(dir, ".claude") } });
    assert.ok(hook !== undefined);
    const probe = path.join(path.dirname(hook.script), "embedding-probe.mjs");
    writeFileSync(probe, 'const { pipeline } = await import("@huggingface/transformers"); console.log(typeof pipeline);');
    const run = spawnSync(process.execPath, [probe], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.stdout.trim(), "function", run.stderr);
  });
});

