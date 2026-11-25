import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { quietFor, removeTemp } from "@storytree/test-waits";

import * as provisionWorktree from "./provision-worktree.mjs";
import { check, cloudMain, cloudNode, connectCloud, hookOutput, installEnvironment, installedNodes, pinnedNode, pnpmInstall, provision, serve } from "./provision-worktree.mjs";

const script = fileURLToPath(new URL("./provision-worktree.mjs", import.meta.url));

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({
        status: error ? (typeof error.code === "number" ? error.code : 1) : 0, signal: error?.signal ?? null, stdout, stderr: stderr || (error?.message ?? ""),
      });
    });
  });
}

function worktree(t, condition) {
  const root = mkdtempSync(path.join(tmpdir(), "provision-"));
  t.after(() => removeTemp(root));
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(path.join(root, "packages", "library"), { recursive: true });
  writeFileSync(path.join(root, "packages", "library", "package.json"), "{}");
  if (condition === "fresh") return root;
  mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
  const installedFrom = condition === "stale" ? "lockfileVersion: '8.0'\n" : "lockfileVersion: '9.0'\n";
  writeFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), installedFrom);
  if (condition !== "unlinked") mkdirSync(path.join(root, "packages", "library", "node_modules"));
  return root;
}

test("3.1 a worktree that is installed and current is left alone", (t) => {
  const root = worktree(t, "current");
  let calls = 0;
  const result = provision({ root, install: () => (calls++, { ok: true }) });
  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(hookOutput(result, root), "", "a healthy session is told nothing");
});

test("3.7 a worktree gets the push check as the pre-push hook its repository's worktrees share, and a pre-push hook someone else installed is left as it was", (t) => {
  const root = worktree(t, "current");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "start");
  const hook = path.resolve(root, git("rev-parse", "--git-path", "hooks"), "pre-push");
  const lines = [];
  assert.equal(provision({ root, install: () => ({ ok: true }), log: (line) => lines.push(line) }).ok, true);
  const text = readFileSync(hook, "utf8");
  assert.ok(text.indexOf("/packages/repo-checks/src/push-check.mjs") !== -1, "the hook runs the pushing checkout's push check, in the repository checks' package");
  assert.ok(lines.some((line) => line.includes("push check installed")), lines.join("\n"));
  const installed = readFileSync(hook, "utf8");
  const said = lines.length;
  provision({ root, install: () => ({ ok: true }), log: (line) => lines.push(line) });
  assert.equal(lines.length, said, "a current hook is left alone, and nothing is said");
  assert.equal(readFileSync(hook, "utf8"), installed);
  const linked = `${root}-linked`;
  t.after(() => removeTemp(linked));
  git("worktree", "add", "-q", linked);
  const shared = path.resolve(linked, execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: linked, encoding: "utf8" }).trim(), "pre-push");
  assert.equal(realpathSync.native(shared), realpathSync.native(hook), "a linked worktree runs the same hook");
  writeFileSync(hook, "#!/bin/sh\necho someone else's\n");
  provision({ root, install: () => ({ ok: true }), log: (line) => lines.push(line) });
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\necho someone else's\n");
  assert.ok(lines.at(-1)?.includes("someone else's"), lines.join("\n"));
  assert.ok(existsSync(hook));
});

test("3.13 · a worktree gets the commit check as the pre-commit hook its repository's worktrees share, leaving someone else's pre-commit hook as it was", (t) => {
  assert.equal(typeof provisionWorktree.installCommitHook, "function", "provision-worktree.mjs exports installCommitHook");
  const root = worktree(t, "current");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  git("commit", "-q", "--allow-empty", "-m", "start");
  const hook = path.resolve(root, git("rev-parse", "--git-path", "hooks"), "pre-commit");
  assert.equal(provision({ root, install: () => ({ ok: true }) }).ok, true);
  assert.ok(existsSync(hook), "provisioning installs the pre-commit hook");
  assert.match(readFileSync(hook, "utf8"), /# storytree commit check/);

  mkdirSync(path.join(root, "docs", "design", "x"), { recursive: true });
  writeFileSync(path.join(root, "docs", "design", "x", "tree.png"), "bytes");
  git("add", "docs/design/x/tree.png");
  const refused = spawnSync("git", ["commit", "-q", "-m", "evidence"], { cwd: root, encoding: "utf8" });
  assert.notEqual(refused.status, 0, "the installed hook refuses a commit staging evidence media");
  assert.match(refused.stderr, /evidence bucket/, refused.stderr);
  assert.equal(git("rev-list", "--count", "HEAD"), "1", "nothing was committed");
  git("rm", "-q", "--cached", "docs/design/x/tree.png");
  mkdirSync(path.join(root, "docs", "design", "x", "inputs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "design", "x", "inputs", "frame.png"), "bytes");
  git("add", "docs/design/x/inputs/frame.png");
  const passed = spawnSync("git", ["commit", "-q", "-m", "input"], { cwd: root, encoding: "utf8" });
  assert.equal(passed.status, 0, passed.stderr);

  const linked = `${root}-linked`;
  t.after(() => removeTemp(linked));
  git("worktree", "add", "-q", linked);
  const shared = path.resolve(linked, execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: linked, encoding: "utf8" }).trim(), "pre-commit");
  assert.equal(realpathSync.native(shared), realpathSync.native(hook), "a linked worktree runs the same hook");

  rmSync(hook);
  const fallback = path.join(root, "elsewhere", "evidence-check.mjs");
  const installed = provisionWorktree.installCommitHook({ root, fallback });
  assert.match(installed, /installed/);
  const text = readFileSync(hook, "utf8");
  assert.ok(text.includes("/packages/repo-checks/src/evidence-check.mjs"), "the hook runs the committing checkout's evidence check");
  assert.ok(text.includes(fallback.replaceAll("\\", "/")), "and falls back to the path it was given");
  assert.match(text, /--staged/);

  writeFileSync(hook, "#!/bin/sh\necho someone else's\n");
  const left = provisionWorktree.installCommitHook({ root, fallback });
  assert.match(left, /someone else's/);
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\necho someone else's\n");
});

test("3.2 a fresh, a stale and an unlinked worktree each get installed", (t) => {
  for (const condition of ["fresh", "stale", "unlinked"]) {
    const root = worktree(t, condition);
    const ran = [];
    const result = provision({ root, install: (where) => (ran.push(where), { ok: true }) });
    assert.deepEqual(ran, [root], `${condition}: one install, in the worktree`);
    assert.equal(result.ok, true, condition);
    assert.equal(result.condition, condition);
    assert.equal(hookOutput(result, root), "", `${condition}: a successful install is silent`);
  }
});

test("3.3 a failed install is retried once, and if it still fails the agent is told which condition and where to run pnpm install", (t) => {
  for (const condition of ["fresh", "stale", "unlinked"]) {
    const root = worktree(t, condition);
    let calls = 0;
    const result = provision({ root, install: () => (calls++, { ok: false, code: 1 }) });
    assert.equal(calls, 2, `${condition}: tried twice`);
    assert.equal(result.ok, false);
    const context = JSON.parse(hookOutput(result, root)).hookSpecificOutput;
    assert.equal(context.hookEventName, "SessionStart");
    assert.ok(context.additionalContext.includes(root), "it names the worktree");
    assert.match(context.additionalContext, /pnpm install/);
    assert.match(context.additionalContext, new RegExp(condition, "i"), `it names the condition: ${condition}`);
  }

  const root = worktree(t, "fresh");
  let calls = 0;
  const result = provision({ root, install: () => ({ ok: ++calls === 2, code: 1 }) });
  assert.equal(result.ok, true);
});

test("3.1 as a session-start hook it exits 0 and says nothing on a healthy worktree", async (t) => {
  const root = worktree(t, "current");
  const hook = await run(process.execPath, [script, "--hook", "--root", root]);
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.stdout, "");
});

function electronPackage(root, { fails = false } = {}) {
  const dir = path.join(root, "node_modules", ".pnpm", "electron@44.4.5", "node_modules", "electron");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "electron", version: "44.4.5" }));
  writeFileSync(
    path.join(dir, "install.js"),
    `const fs = require("node:fs"), path = require("node:path");
fs.appendFileSync(path.join(__dirname, "runs"), "x");
${fails ? 'console.error("download failed"); process.exit(1);' : ""}
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "electron"), "");
fs.writeFileSync(path.join(__dirname, "path.txt"), "electron");
`,
  );
  return dir;
}

const runsOf = (dir) => {
  try {
    return readFileSync(path.join(dir, "runs"), "utf8").length;
  } catch {
    return 0;
  }
};

test("3.5 an installed worktree whose Electron has no binary gets it from Electron's installer, once", (t) => {
  const root = worktree(t, "current");
  const electron = electronPackage(root);
  let installs = 0;
  const result = provision({ root, install: () => (installs++, { ok: true }) });
  assert.equal(result.ok, true);
  assert.equal(installs, 0, "the worktree is current: no pnpm install");
  assert.equal(runsOf(electron), 1, "Electron's install.js ran");
  assert.equal(readFileSync(path.join(electron, "path.txt"), "utf8"), "electron");
  assert.equal(hookOutput(result, root), "", "a fetched binary is silent");

  provision({ root });
  assert.equal(runsOf(electron), 1, "a binary already there is left alone");
});

test("3.5 a failed Electron fetch is named in the log but never fails the session", (t) => {
  const root = worktree(t, "current");
  const electron = electronPackage(root, { fails: true });
  const lines = [];
  const result = provision({ root, log: (line) => lines.push(line) });
  assert.equal(runsOf(electron), 1);
  assert.equal(result.ok, true);
  assert.equal(hookOutput(result, root), "");
  assert.ok(lines.some((line) => line.includes(electron) && /electron/i.test(line)), lines.join("\n"));
});

function linkingInstall(calls) {
  return (root) => {
    calls.push(root);
    mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
    writeFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), readFileSync(path.join(root, "pnpm-lock.yaml")));
    for (const dir of [root, ...["library", "keys"].map((name) => path.join(root, "packages", name))]) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      } catch {
        continue;
      }
      mkdirSync(path.join(dir, "node_modules"), { recursive: true });
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
        mkdirSync(path.join(dir, "node_modules", name), { recursive: true });
      }
    }
    return { ok: true, code: 0 };
  };
}

function addKeysDependency(root) {
  mkdirSync(path.join(root, "packages", "keys"));
  writeFileSync(path.join(root, "packages", "keys", "package.json"), JSON.stringify({ name: "@storytree/keys" }));
  const library = { name: "@storytree/library", dependencies: { "@storytree/keys": "workspace:*" } };
  writeFileSync(path.join(root, "packages", "library", "package.json"), JSON.stringify(library));
}

test("3.2 before a storytree command, an uninstalled worktree is installed and the command runs", async (t) => {
  for (const condition of ["fresh", "unlinked"]) {
    const root = worktree(t, condition);
    const ran = [];
    assert.equal(check({ root, install: linkingInstall(ran) }), 0, condition);
    assert.deepEqual(ran, [root], `${condition}: one install, in the worktree`);
  }
  const current = await run(process.execPath, [script, "--check", "--root", worktree(t, "current")]);
  assert.equal(current.status, 0);
  assert.equal(current.stdout + current.stderr, "", "an installed worktree runs the command with nothing said");
});

test("3.3 before a storytree command, a worktree its install cannot fix is refused in one line with the command that installs it", (t) => {
  for (const condition of ["fresh", "unlinked"]) {
    const root = worktree(t, condition);
    const lines = [];
    assert.equal(check({ root, install: () => ({ ok: false, code: 1 }), log: (line) => lines.push(line) }), 1, condition);
    const refusal = lines.at(-1);
    assert.ok(refusal.includes(root), `${condition}: it names the worktree`);
    assert.match(refusal, /node packages\/base-dev-loop\/src\/provision-worktree\.mjs/, `${condition}: it names the fix`);
    assert.equal(refusal.split("\n").length, 1, `${condition}: in one line`);
  }
  const root = worktree(t, "current");
  addKeysDependency(root);
  const lines = [];
  assert.equal(check({ root, install: () => ({ ok: true, code: 0 }), log: (line) => lines.push(line) }), 1);
  assert.ok(lines.at(-1).includes("@storytree/keys"), "it names the package the install lacks");
});

for (const condition of ["current", "stale"]) {
  test(`3.2 before a storytree command, a ${condition} worktree missing a package's workspace link is reinstalled and the command runs`, (t) => {
    const root = worktree(t, condition);
    addKeysDependency(root);
    const ran = [];
    assert.equal(check({ root, install: linkingInstall(ran) }), 0);
    assert.deepEqual(ran, [root], "one install, in the worktree");
    let calls = 0;
    provision({ root, install: () => (calls++, { ok: true }) });
    assert.equal(calls, 0, "the next session-start hook finds nothing to do");
  });
}

test("3.2 missing root workspace links are reinstalled even after a package's missing link is repaired", async (t) => {
  const root = worktree(t, "current");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "storytree", devDependencies: { "@storytree/library": "workspace:*" },
  }));
  addKeysDependency(root);
  mkdirSync(path.join(root, "packages", "library", "node_modules", "@storytree", "keys"), { recursive: true });

  const lines = [];
  assert.equal(check({ root, install: () => ({ ok: true }), log: (line) => lines.push(line) }), 1, "an install that links nothing leaves it refused");
  assert.match(lines.at(-1), /storytree → @storytree\/library/);

  let calls = 0;
  const result = provision({ root, install: (where) => {
    assert.equal(where, root);
    calls++;
    mkdirSync(path.join(root, "node_modules", "@storytree", "library"), { recursive: true });
    return { ok: true };
  } });
  assert.equal(calls, 1, "the session-start hook reinstalls the missing root link");
  assert.equal(result.condition, "behind");
  assert.equal(hookOutput(result, root), "");
  const repaired = await run(process.execPath, [script, "--check", "--root", root]);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(repaired.stdout + repaired.stderr, "");
});

test("the tool server starts in a fresh worktree once the session-start install has finished", async (t) => {
  const root = worktree(t, "fresh");
  let started = 0;
  const serving = serve({ root, start: () => (started++, Promise.resolve(0)), pollMs: 5 });
  await quietFor(() => started > 0, 50, "the tool server starting before the install");
  mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(path.join(root, "packages", "library", "node_modules"));
  writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
  assert.equal(await serving, 0);
  assert.equal(started, 1);
});

async function git(root, ...args) {
  const timeout = 60_000;
  const once = () => run("git", ["-c", "user.name=Provision test", "-c", "user.email=provision@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, timeout,
  });
  let result = await once();
  if (result.status !== 0 && !result.signal && args[0] === "fetch") result = await once();
  const ended = result.signal ? `killed by ${result.signal}, its limit ${timeout / 1000} s` : `exit ${result.status}`;
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${ended}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result.stdout.trim();
}

async function repoPair(t) {
  const remote = worktree(t, "current");
  await git(remote, "init", "--initial-branch=main");
  writeFileSync(path.join(remote, "version.txt"), "one\n");
  await git(remote, "add", "version.txt");
  await git(remote, "commit", "-m", "initial");
  const root = worktree(t, "current");
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "core.autocrlf", "false");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "fetch", "origin", "main");
  await git(root, "reset", "--hard", "origin/main");
  return { root, remote };
}

test("3.4 a clean primary behind origin is fetched and fast-forwarded at session start, then installed, so the tool server starts on current code", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "add", "pnpm-lock.yaml");
  await git(remote, "commit", "-m", "lockfile");
  await git(root, "fetch", "origin", "main");
  await git(root, "reset", "--hard", "origin/main");
  writeFileSync(path.join(remote, "version.txt"), "two\n");
  writeFileSync(path.join(remote, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");
  await git(remote, "commit", "-am", "new record schema and a dependency");
  const head = await git(remote, "rev-parse", "HEAD");
  let installs = 0;
  const result = provision({ root, install: () => (installs++, { ok: true }) });
  assert.equal(hookOutput(result, root), "", "the session is told nothing: it starts current");
  assert.equal(await git(root, "rev-parse", "HEAD"), head, "the never-fetched remote commit is fetched and fast-forwarded to");
  assert.equal(readFileSync(path.join(root, "version.txt"), "utf8"), "two\n");
  assert.equal(installs, 1, "the fast-forward's new lockfile is installed");
});

test("3.4 the tool server, started beside the hook, fast-forwards a clean primary behind origin itself and starts", async (t) => {
  const { root, remote } = await repoPair(t);
  writeFileSync(path.join(remote, "version.txt"), "two\n");
  await git(remote, "commit", "-am", "new record schema");
  assert.equal(await serve({ root, start: async () => 17, log: () => {} }), 17);
  assert.equal(await git(root, "rev-parse", "HEAD"), await git(remote, "rev-parse", "HEAD"));
});

test("3.4 a held update lock makes the hook wait, then bring the primary up to date", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  const before = await git(root, "rev-parse", "HEAD");
  const lock = path.join(root, ".git", "storytree-fast-forward.lock");
  mkdirSync(lock);
  const hook = run(process.execPath, [script, "--hook", "--root", root]);
  let done = false;
  hook.then(() => (done = true));
  await quietFor(() => done, 400, "the hook finishing while the server's update holds the lock");
  assert.equal(await git(root, "rev-parse", "HEAD"), before, "nothing merges while the lock is held");
  rmSync(lock, { recursive: true });
  const finished = await hook;
  assert.equal(finished.stdout, "", finished.stdout);
  assert.equal(await git(root, "rev-parse", "HEAD"), await git(remote, "rev-parse", "HEAD"));
});

test("3.4 an update lock left by a crashed start is taken over, so the primary is still brought up to date", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  const lock = path.join(root, ".git", "storytree-fast-forward.lock");
  mkdirSync(lock);
  const crashed = new Date(Date.now() - 10 * 60_000);
  utimesSync(lock, crashed, crashed);
  assert.equal(hookOutput(provision({ root }), root), "");
  assert.equal(await git(root, "rev-parse", "HEAD"), await git(remote, "rev-parse", "HEAD"));
  assert.equal(existsSync(lock), false, "the lock is released after the update");
});

test("3.4 a clean primary whose fast-forward git refuses is left as it was and refused, saying why", async (t) => {
  const { root, remote } = await repoPair(t);
  writeFileSync(path.join(remote, "notes.txt"), "origin's\n");
  await git(remote, "add", "notes.txt");
  await git(remote, "commit", "-m", "notes");
  writeFileSync(path.join(root, "notes.txt"), "an untracked file the merge would overwrite\n");
  await git(root, "fetch", "origin", "main");
  const before = await git(root, "rev-parse", "HEAD");
  const result = provision({ root, install: () => assert.fail("updating the checkout comes first") });
  assert.match(result.message, /1 commit behind.*fast-forward failed/);
  assert.equal(await git(root, "rev-parse", "HEAD"), before);
  assert.equal(readFileSync(path.join(root, "notes.txt"), "utf8"), "an untracked file the merge would overwrite\n");
});

test("3.4 a storytree command's pre-command install never fast-forwards the primary", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  await git(root, "fetch", "origin", "main");
  rmSync(path.join(root, "packages", "library", "node_modules"), { recursive: true });
  const before = await git(root, "rev-parse", "HEAD");
  check({ root, install: () => assert.fail("a behind primary is not installed") });
  assert.equal(await git(root, "rev-parse", "HEAD"), before);
});

test("3.4 a primary whose fetch fails names the gap at session start and refuses to serve until updated", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  await git(root, "fetch", "origin", "main");
  await git(root, "remote", "set-url", "origin", path.join(root, "no-such-remote"));
  const before = await git(root, "rev-parse", "HEAD");
  const hook = await run(process.execPath, [script, "--hook", "--root", root]);
  assert.equal(hook.status, 0, "a warning must leave the session able to repair its checkout");
  assert.notEqual(hook.stdout, "", "the session is told about its stale checkout");
  const warning = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.ok(warning.includes(root));
  assert.match(warning, /1 commit behind.*origin\/main/);
  assert.match(warning, /fetching origin failed/i);
  assert.match(warning, /git pull --ff-only origin main && pnpm install/);
  assert.match(warning, /restart/i);
  const messages = [];
  const code = await serve({ root, start: () => assert.fail("a stale server must not start"), log: (message) => messages.push(message) });
  assert.equal(code, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /1 commit behind/);
  assert.equal(await git(root, "rev-parse", "HEAD"), before, "a failed fetch never moves the checkout");

  await git(root, "merge", "--ff-only", "origin/main");
  assert.equal(hookOutput(provision({ root }), root), "", "an updated primary is silent");
  assert.equal(await serve({ root, start: async () => 17 }), 17, "the updated server can start");
});

test("3.4 a primary behind origin with local edits keeps them and is refused, saying why", async (t) => {
  const { root, remote } = await repoPair(t);
  writeFileSync(path.join(root, "version.txt"), "local edits\n");
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  const before = await git(root, "rev-parse", "HEAD");
  const result = provision({ root, install: () => assert.fail("updating the checkout comes first") });
  assert.equal(result.ok, false);
  const warning = JSON.parse(hookOutput(result, root)).hookSpecificOutput.additionalContext;
  assert.match(warning, /1 commit behind/);
  assert.match(warning, /local edits, so it was not brought up to date/);
  assert.equal(await git(root, "rev-parse", "HEAD"), before);
  assert.equal(readFileSync(path.join(root, "version.txt"), "utf8"), "local edits\n");
});

test("3.4 a diverged primary keeps its edits and names local commits to reconcile", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(root, "commit", "--allow-empty", "-m", "local work");
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  const before = await git(root, "rev-parse", "HEAD");
  const result = provision({ root, install: () => assert.fail("updating the checkout comes first") });
  assert.equal(result.ok, false);
  const warning = JSON.parse(hookOutput(result, root)).hookSpecificOutput.additionalContext;
  assert.match(warning, /1 commit behind/);
  assert.match(warning, /1 local commit/);
  assert.match(warning, /reconcile/i);
  assert.equal(await git(root, "rev-parse", "HEAD"), before);
});

test("3.4 a feature branch or linked worktree can serve while the primary is behind", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  await git(root, "fetch", "origin", "main");
  await git(root, "switch", "-c", "feature");
  assert.equal(hookOutput(provision({ root }), root), "");
  assert.equal(await serve({ root, start: async () => 19 }), 19);

  const linked = path.join(root, "linked");
  await git(root, "worktree", "add", linked, "main");
  assert.equal(await serve({ root: linked, waitMs: 0, start: async () => 23 }), 23, "even a linked worktree on main is left alone");
});

async function submodule(t) {
  const { remote } = await repoPair(t);
  await git(remote, "add", "pnpm-lock.yaml", "packages");
  await git(remote, "commit", "-m", "the workspace");
  const outer = mkdtempSync(path.join(tmpdir(), "provision-outer-"));
  t.after(() => removeTemp(outer));
  await git(outer, "init", "--initial-branch=main");
  await git(outer, "-c", "protocol.file.allow=always", "submodule", "add", "-b", "main", remote, "storytree");
  await git(remote, "commit", "--allow-empty", "-m", "past the pin");
  return { root: path.join(outer, "storytree"), outer };
}

test("3.11 a storytree checkout that is another repository's submodule is never installed, updated or given the push check, and a storytree command there is refused in one line", async (t) => {
  const { root, outer } = await submodule(t);
  const pinned = await git(root, "rev-parse", "HEAD");
  const hooks = path.resolve(root, await git(root, "rev-parse", "--git-path", "hooks"), "pre-push");
  let installs = 0;
  const install = linkingInstall([]);
  const counted = (where) => (installs++, install(where));
  const result = provision({ root, install: counted });
  assert.equal(hookOutput(result, root), "", "the session start says nothing");
  const lines = [];
  assert.equal(check({ root, install: counted, log: (line) => lines.push(line) }), 1);
  assert.equal(installs, 0, "neither the session start nor the storytree command installs it");
  assert.equal(existsSync(path.join(root, "node_modules")), false);
  assert.equal(await serve({ root, waitMs: 0, start: async () => 29, log: () => {} }), 29, "the tool server starts without updating it");
  assert.equal(await git(root, "rev-parse", "HEAD"), pinned, "the pinned commit is not fast-forwarded");
  assert.equal(existsSync(hooks), false, "no push check is installed in it");
  const refusal = lines.at(-1);
  assert.ok(refusal.includes(root) && refusal.includes(path.basename(outer)), `it names the checkout and the repository holding it: ${refusal}`);
  assert.match(refusal, /submodule/);
  assert.equal(refusal.split("\n").length, 1);
});

function cloud(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cloud-root-"));
  const home = mkdtempSync(path.join(tmpdir(), "cloud-home-"));
  t.after(async () => {
    await removeTemp(root);
    await removeTemp(home);
  });
  writeFileSync(path.join(root, ".storytree.json"), JSON.stringify({ project: "storytree" }));
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return { ok: true, code: 0 };
  };
  return { root, home, calls, run };
}

const CLOUD = { CLAUDE_CODE_REMOTE: "true", CF_ACCESS_CLIENT_ID: "id" };

test("3.6 pnpm install skips onnxruntime's download in every environment, unless the environment names its own choice", () => {
  assert.equal(installEnvironment({ ...CLOUD }).ONNXRUNTIME_NODE_INSTALL, "skip");
  assert.equal(installEnvironment({ PATH: "/bin" }).ONNXRUNTIME_NODE_INSTALL, "skip");
  assert.equal(installEnvironment({ ...CLOUD, ONNXRUNTIME_NODE_INSTALL: "force" }).ONNXRUNTIME_NODE_INSTALL, "force");
  assert.equal(installEnvironment({ PATH: "/bin", ONNXRUNTIME_NODE_INSTALL: "force" }).ONNXRUNTIME_NODE_INSTALL, "force");
});

test("3.2 the install is pnpm's, from the lockfile unchanged, falling back to corepack's pnpm where pnpm is not on PATH", () => {
  for (const platform of ["linux", "win32"]) {
    const ran = [];
    const spawn = (command, args, options) => {
      const line = Array.isArray(args) ? [command, ...args].join(" ") : command;
      ran.push(line);
      if (platform === "win32") assert.equal(args.shell, true);
      return line.startsWith("pnpm") ? { error: { code: "ENOENT" }, status: null } : { status: 0 };
    };
    assert.deepEqual(pnpmInstall("/repo", { spawn, platform }), { ok: true, code: 0 });
    assert.deepEqual(ran, ["pnpm install --frozen-lockfile", "corepack pnpm install --frozen-lockfile"], platform);
  }
});

const DEFAULT_ADDRESS = "wss://storytree_library@library.storytree.dev/postgres";

test("3.6 a fresh cloud container is given the library's HTTPS address and approves its checkout, once", (t) => {
  const { root, home, calls, run } = cloud(t);
  connectCloud({ root, home, env: { ...CLOUD }, run });
  assert.deepEqual(calls, [
    ["settings", "set", "library", "postgres", DEFAULT_ADDRESS],
    ["doctor", "--join", "storytree"],
  ], "with PGUSER unset, the address names the storytree_library user");

  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ library: { location: "postgres", address: DEFAULT_ADDRESS } }));
  calls.length = 0;
  connectCloud({ root, home, env: { ...CLOUD }, run });
  assert.deepEqual(calls, [], "a container whose library is already set is left alone");
});

test("3.6 the cloud environment's PGUSER, when set, is the user the library's address names", (t) => {
  const { root, home, calls, run } = cloud(t);
  connectCloud({ root, home, env: { ...CLOUD, PGUSER: "storytree_cloud" }, run });
  assert.deepEqual(calls[0], ["settings", "set", "library", "postgres", "wss://storytree_cloud@library.storytree.dev/postgres"]);
});

test("3.6 the cloud environment's STORYTREE_LIBRARY_ADDRESS, when set, is the address given", (t) => {
  const { root, home, calls, run } = cloud(t);
  connectCloud({ root, home, env: { ...CLOUD, STORYTREE_LIBRARY_ADDRESS: "wss://someone@elsewhere.example/db" }, run });
  assert.deepEqual(calls[0], ["settings", "set", "library", "postgres", "wss://someone@elsewhere.example/db"]);
});

test("3.6 outside a cloud container, or in one without the route's Access token, no setting is touched", (t) => {
  const { root, home, calls, run } = cloud(t);
  connectCloud({ root, home, env: { CF_ACCESS_CLIENT_ID: "id" }, run });
  connectCloud({ root, home, env: { CLAUDE_CODE_REMOTE: "true" }, run });
  assert.deepEqual(calls, []);
});

test("3.6 a setting that cannot be made is logged and stops the rest, never failing the session", (t) => {
  const { root, home } = cloud(t);
  const calls = [];
  const lines = [];
  const result = connectCloud({ root, home, env: { ...CLOUD }, run: (args) => (calls.push(args), { ok: false, code: 3 }), log: (line) => lines.push(line) });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1, "no approval is tried once the address could not be set");
  assert.match(lines.join("\n"), /storytree settings set library .* failed \(exit 3\)/);
});

test("3.6 approving a cloud container's checkout leaves its committed .storytree.json as it was, and takes away the .storytree files joining wrote", (t) => {
  const { root, home } = cloud(t);
  const marker = path.join(root, ".storytree.json");
  const before = readFileSync(marker, "utf8");
  const run = (args) => {
    if (args[0] === "doctor") {
      mkdirSync(path.join(root, ".storytree"), { recursive: true });
      writeFileSync(path.join(root, ".storytree", "project.json"), JSON.stringify({ project: "storytree", identity: "604280" }, null, 2));
      writeFileSync(path.join(root, ".storytree", ".gitignore"), "*.local.json\n");
    }
    return { ok: true, code: 0 };
  };
  connectCloud({ root, home, env: { ...CLOUD }, run });
  assert.equal(readFileSync(marker, "utf8"), before);
  assert.equal(existsSync(path.join(root, ".storytree")), false, "the folder joining made is gone");
});

function floored(t, floor = ">=24.20.0") {
  const root = mkdtempSync(path.join(tmpdir(), "cloud-node-"));
  t.after(() => removeTemp(root));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: floor } }));
  return { root, envFile: path.join(root, "claude-env.sh") };
}

const INSTALLED = new Map([
  [path.join("/opt", "node22", "bin", "node"), "v22.23.4"],
  [path.join("/opt", "node24", "bin", "node"), "v24.22.2"],
  [path.join("/opt", "node24old", "bin", "node"), "v24.19.0"],
  [path.join("/opt", "node26", "bin", "node"), "v26.1.0"],
]);
const versionOf = (bin) => INSTALLED.get(bin);

test("3.8 a cloud container whose Node is below the engines floor gets the newest installed Node meeting it first on the session's path, once", (t) => {
  const { root, envFile } = floored(t);
  const env = { CLAUDE_CODE_REMOTE: "true", CLAUDE_ENV_FILE: envFile };
  const result = cloudNode({ root, env, version: "v22.23.4", nodes: [...INSTALLED.keys()], versionOf });
  const dir = path.join("/opt", "node26", "bin");
  assert.equal(result.dir, dir);
  assert.equal(readFileSync(envFile, "utf8"), `export PATH='${dir}':"$PATH"\n`);

  cloudNode({ root, env, version: "v22.23.4", nodes: [...INSTALLED.keys()], versionOf });
  assert.equal(readFileSync(envFile, "utf8"), `export PATH='${dir}':"$PATH"\n`, "a second session start adds no second line");
});

test("3.8 with no installed Node meeting the floor, the cloud session is told the floor and the Node it has, and its path is left as it was", (t) => {
  const { root, envFile } = floored(t);
  const nodes = [path.join("/opt", "node22", "bin", "node"), path.join("/opt", "node24old", "bin", "node")];
  const result = cloudNode({ root, env: { CLAUDE_CODE_REMOTE: "true", CLAUDE_ENV_FILE: envFile }, version: "v22.23.4", nodes, versionOf });
  assert.equal(result.dir, undefined);
  assert.match(result.message, /v22\.23\.4 is below this project's floor, node >=24\.20\.0/);
  assert.match(result.message, /no installed Node\.js meets it/);
  assert.equal(existsSync(envFile), false);
});

test("3.8 a found Node with no CLAUDE_ENV_FILE to write is named to the session to put first on its path", (t) => {
  const { root } = floored(t);
  const result = cloudNode({ root, env: { CLAUDE_CODE_REMOTE: "true" }, version: "v22.23.4", nodes: [...INSTALLED.keys()], versionOf });
  assert.match(result.message, new RegExp(`export PATH='${path.join("/opt", "node26", "bin").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}':"\\$PATH"`));
});

test("3.8 outside a cloud container, or at the floor, the session's path is left as it was", (t) => {
  const { root, envFile } = floored(t);
  const nodes = [...INSTALLED.keys()];
  assert.deepEqual(cloudNode({ root, env: { CLAUDE_ENV_FILE: envFile }, version: "v22.23.4", nodes, versionOf }), {});
  assert.deepEqual(cloudNode({ root, env: { CLAUDE_CODE_REMOTE: "true", CLAUDE_ENV_FILE: envFile }, version: "v24.20.0", nodes, versionOf }), {});
  assert.equal(existsSync(envFile), false);
});

test("3.8 each installed Node's version is read by running it", (t) => {
  const { root, envFile } = floored(t, ">=1.0.0");
  const result = cloudNode({ root, env: { CLAUDE_CODE_REMOTE: "true", CLAUDE_ENV_FILE: envFile }, version: "v0.12.0", nodes: [process.execPath, path.join(root, "no-node-here")] });
  assert.equal(result.dir, path.dirname(process.execPath));
});

test("3.8 the session-start hook's heads-up carries what the Node check found, even when the install succeeded", () => {
  const output = JSON.parse(hookOutput({ ok: true, code: 0 }, "/repo", ["no Node meets the floor"]));
  assert.equal(output.hookSpecificOutput.additionalContext, "no Node meets the floor");
  assert.equal(hookOutput({ ok: true, code: 0 }, "/repo", []), "");
});

test("3.8 the Node.js binaries searched are each /opt/<name>/bin/node, then each on the path, once each and only those that exist", (t) => {
  const { root } = floored(t);
  const opt = path.join(root, "opt");
  for (const name of ["node24", "empty"]) mkdirSync(path.join(opt, name, "bin"), { recursive: true });
  writeFileSync(path.join(opt, "node24", "bin", "node"), "");
  const onPath = path.join(root, "bin");
  mkdirSync(onPath);
  writeFileSync(path.join(onPath, "node"), "");
  const PATH = ["", onPath, path.join(opt, "node24", "bin"), onPath, path.join(root, "nowhere")].join(path.delimiter);
  assert.deepEqual(installedNodes({ PATH }, opt), [path.join(opt, "node24", "bin", "node"), path.join(onPath, "node")]);
  assert.deepEqual(installedNodes({}, path.join(root, "no-opt")), [], "no /opt and no PATH finds none");
});

function cloudEnv() {
  const env = { ...process.env, CLAUDE_CODE_REMOTE: "true" };
  delete env.CF_ACCESS_CLIENT_ID;
  delete env.CLAUDE_ENV_FILE;
  return env;
}

test("3.9 a cloud container's session-start hook fetches origin's main, without its tags, whatever branch the checkout is on", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(root, "switch", "-c", "claude/session");
  await git(remote, "commit", "--allow-empty", "-m", "main moved on");
  await git(remote, "tag", "v9");
  const head = await git(remote, "rev-parse", "HEAD");
  const hook = await run(process.execPath, [script, "--hook", "--root", root], { env: cloudEnv() });
  assert.equal(hook.status, 0);
  assert.equal(await git(root, "rev-parse", "refs/remotes/origin/main"), head, "origin/main is today's main");
  assert.equal(await git(root, "tag", "--list"), "", "no tags are fetched");
  assert.equal(await git(root, "branch", "--show-current"), "claude/session", "the checkout is left on its branch");
});

test("3.9 outside a cloud container origin/main is not fetched", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(root, "switch", "-c", "feature");
  const before = await git(root, "rev-parse", "refs/remotes/origin/main");
  await git(remote, "commit", "--allow-empty", "-m", "main moved on");
  assert.deepEqual(cloudMain({ root, env: {} }), { fetched: false });
  assert.equal(await git(root, "rev-parse", "refs/remotes/origin/main"), before);
});

test("3.9 a cloud fetch that fails or runs past its time limit is logged, never thrown, and the hook still exits 0", async (t) => {
  const { root } = await repoPair(t);
  await git(root, "switch", "-c", "claude/session");
  await git(root, "remote", "set-url", "origin", path.join(root, "no-such-remote"));
  const lines = [];
  assert.deepEqual(cloudMain({ root, env: { CLAUDE_CODE_REMOTE: "true" }, log: (line) => lines.push(line) }), { fetched: false });
  assert.match(lines.join("\n"), /could not fetch origin's main/);
  const slow = [];
  cloudMain({ root, env: { CLAUDE_CODE_REMOTE: "true" }, fetchMs: 1, log: (line) => slow.push(line) });
  assert.match(slow.join("\n"), /could not fetch origin's main.*1 ms/);
  const hook = await run(process.execPath, [script, "--hook", "--root", root], { env: cloudEnv() });
  assert.equal(hook.status, 0);
});

function pinned(t, pin) {
  const root = mkdtempSync(path.join(tmpdir(), "provision-pin-"));
  t.after(() => removeTemp(root));
  if (pin !== undefined) writeFileSync(path.join(root, ".node-version"), `${pin}\n`);
  return root;
}

test("3.10 on Windows a Node.js other than the pin is named with winget's command for exactly the pinned version, never a bare upgrade", (t) => {
  const root = pinned(t, "24.22.1");
  const message = pinnedNode({ root, version: "v24.19.0", platform: "win32", env: {} });
  assert.match(message, /Node\.js v24\.19\.0 runs here, but this project pins 24\.22\.1 \(\.node-version\)/);
  assert.match(message, /`winget install --id OpenJS\.NodeJS\.LTS --exact --version 24\.22\.1 --force`/);
  assert.doesNotMatch(message, /winget upgrade/);
});

test("3.10 where nvm is, the command installs the pinned version and makes it nvm's default", (t) => {
  const root = pinned(t, "24.22.1");
  const message = pinnedNode({ root, version: "v24.23.0", platform: "linux", env: { NVM_DIR: "/home/u/.nvm" } });
  assert.match(message, /Node\.js v24\.23\.0 runs here, but this project pins 24\.22\.1/);
  assert.match(message, /`nvm install 24\.22\.1 && nvm alias default 24\.22\.1`/);
});

test("3.10 with no version manager it knows, the session is told the exact version to install", (t) => {
  const root = pinned(t, "24.22.1");
  assert.match(pinnedNode({ root, version: "v26.13.0", platform: "darwin", env: {} }), /install Node\.js 24\.22\.1 exactly/);
});

test("3.10 the pinned Node.js, or a root with no pin, says nothing", (t) => {
  assert.equal(pinnedNode({ root: pinned(t, "24.22.1"), version: "v24.22.1", platform: "win32", env: {} }), undefined);
  assert.equal(pinnedNode({ root: pinned(t, undefined), version: "v24.19.0", platform: "win32", env: {} }), undefined);
});

const cloudFactory = (options) => provisionWorktree.cloudFactory(options);
const FACTORY_URL = "https://github.com/HuaMick/storytree-factory.git";
const FACTORY_TOKEN = "github_pat_11AAtestTOKEN0042";
const FACTORY_TOKEN_BASE64 = "eC1hY2Nlc3MtdG9rZW46Z2l0aHViX3BhdF8xMUFBdGVzdFRPS0VOMDA0Mg==";
const PLUGIN_NAMED = ["settings", "set", "module", "micks-dev-loop", "plugin", "micks-dev-loop"];

function linkTarget(file) {
  try {
    return lstatSync(file).isSymbolicLink() ? realpathSync(file) : undefined;
  } catch {
    return undefined;
  }
}

function factory(t, { gitStatus = 0, installOk = true, runOk = true, clones = true } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "cloud-factory-"));
  t.after(() => removeTemp(base));
  const root = path.join(base, "checkout");
  const home = path.join(base, ".storytree", "0.3");
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const folder = path.join(base, ".storytree", "your-factory");
  const steps = [];
  const lines = [];
  const git = (args, options = {}) => {
    steps.push({ step: "git", args, env: options.env });
    if (gitStatus === 0 && clones && args[0] === "clone") mkdirSync(path.join(args.at(-1), ".git"), { recursive: true });
    return { status: gitStatus };
  };
  const install = (dir) => {
    steps.push({ step: "install", args: [dir], linked: linkTarget(path.join(dir, "storytree")) });
    return installOk ? { ok: true, code: 0 } : { ok: false, code: 1 };
  };
  const run = (args) => {
    steps.push({ step: "run", args });
    return runOk ? { ok: true, code: 0 } : { ok: false, code: 2 };
  };
  const options = {
    root, home, env: { CLAUDE_CODE_REMOTE: "true", FACTORY_READ_TOKEN: FACTORY_TOKEN }, factory: FACTORY_URL,
    tokenVar: "FACTORY_READ_TOKEN", plugin: "micks-dev-loop", git, run, install, log: (line) => lines.push(line),
  };
  return { base, root, home, folder, steps, lines, options };
}

function assertTokenKeptOut({ steps, lines }, result) {
  const seen = [...steps.map((s) => JSON.stringify(s.args)), ...lines, result?.message ?? ""].join("\n");
  assert.equal(seen.includes(FACTORY_TOKEN), false, "the token is in an argument, a log line or the message");
  assert.equal(seen.includes(FACTORY_TOKEN_BASE64), false, "the token's base64 is in an argument, a log line or the message");
}

test("3.12 a cloud container clones the factory its hook names into the home's factory folder, the address and folder after -- so git never reads them as options, links the checkout as storytree, installs it, then names its plugin", (t) => {
  const f = factory(t);
  const result = cloudFactory(f.options);
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.deepEqual(f.steps.map((s) => s.step), ["git", "install", "run"]);
  assert.deepEqual(f.steps[0].args, ["clone", "--depth", "1", "--", FACTORY_URL, f.folder], "a home at .storytree/0.3 has its factory at .storytree/your-factory, the address and folder after -- so git never reads them as options");
  assert.deepEqual(f.steps[1].args, [f.folder]);
  assert.equal(f.steps[1].linked, realpathSync(f.root), "the checkout is linked into the factory before it is installed");
  assert.deepEqual(f.steps[2].args, PLUGIN_NAMED);
  assert.equal(linkTarget(path.join(f.folder, "storytree")), realpathSync(f.root));
  assertTokenKeptOut(f, result);
});

test("3.12 the token reaches git only as an Authorization header in git's environment, never in an argument, a log line or the message", (t) => {
  const f = factory(t);
  const result = cloudFactory(f.options);
  const env = f.steps[0].env;
  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_KEY_0, "http.extraHeader");
  assert.equal(env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${FACTORY_TOKEN_BASE64}`);
  assertTokenKeptOut(f, result);

  const failing = factory(t, { gitStatus: 128 });
  const failed = cloudFactory(failing.options);
  assert.ok(failing.lines.length > 0, "the failed clone is logged");
  assertTokenKeptOut(failing, failed);
});

test("3.12 an already-cloned factory is fast-forwarded from the named repository's main, the address after -- so git never reads it as an option, and an existing storytree link is replaced by one to this checkout", (t) => {
  const f = factory(t);
  mkdirSync(path.join(f.folder, ".git"), { recursive: true });
  const old = path.join(f.base, "old-checkout");
  mkdirSync(old);
  symlinkSync(old, path.join(f.folder, "storytree"), "junction");
  const result = cloudFactory(f.options);
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.deepEqual(f.steps.map((s) => s.step), ["git", "install", "run"]);
  assert.deepEqual(f.steps[0].args, ["-C", f.folder, "pull", "--ff-only", "--", FACTORY_URL, "main"], "the address follows -- so git never reads it as an option");
  assert.equal(f.steps[0].env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${FACTORY_TOKEN_BASE64}`);
  assert.equal(linkTarget(path.join(f.folder, "storytree")), realpathSync(f.root));
  assert.equal(existsSync(old), true, "the old link's target is left alone");
  assertTokenKeptOut(f, result);
});

test("3.12 the factory folder is STORYTREE_FACTORY when set, else your-factory inside a home whose parent is not .storytree", (t) => {
  const named = factory(t);
  const elsewhere = path.join(named.base, "elsewhere-factory");
  cloudFactory({ ...named.options, env: { ...named.options.env, STORYTREE_FACTORY: elsewhere } });
  assert.deepEqual(named.steps[0].args, ["clone", "--depth", "1", "--", FACTORY_URL, elsewhere]);
  assert.equal(linkTarget(path.join(elsewhere, "storytree")), realpathSync(named.root));
  assert.equal(existsSync(named.folder), false, "the home's default folder is not used");

  const plain = factory(t);
  const home = path.join(plain.base, "plain-home");
  mkdirSync(home);
  cloudFactory({ ...plain.options, home });
  assert.deepEqual(plain.steps[0].args, ["clone", "--depth", "1", "--", FACTORY_URL, path.join(home, "your-factory")]);
});

test("3.12 outside a cloud container, or with no factory named, nothing runs and nothing is said", (t) => {
  const f = factory(t);
  for (const remote of [undefined, "false"]) {
    const env = { FACTORY_READ_TOKEN: FACTORY_TOKEN, ...(remote === undefined ? {} : { CLAUDE_CODE_REMOTE: remote }) };
    assert.deepEqual(cloudFactory({ ...f.options, env }), { ok: true, done: false }, `CLAUDE_CODE_REMOTE=${remote}`);
  }
  assert.deepEqual(cloudFactory({ ...f.options, factory: undefined }), { ok: true, done: false }, "in the cloud with no --factory");
  assert.deepEqual(f.steps, []);
  assert.deepEqual(f.lines, []);
  assert.equal(existsSync(f.folder), false);
});

test("3.12 in the cloud with the factory named but its token variable unset or empty, nothing runs and the session is told that variable is not set", (t) => {
  const f = factory(t);
  for (const env of [{ CLAUDE_CODE_REMOTE: "true" }, { CLAUDE_CODE_REMOTE: "true", OTHER_FACTORY_TOKEN: "" }]) {
    const result = cloudFactory({ ...f.options, env, tokenVar: "OTHER_FACTORY_TOKEN" });
    assert.equal(result.done, false);
    assert.match(result.message ?? "", /OTHER_FACTORY_TOKEN/, "the message names the variable the hook was given");
    assert.match(result.message ?? "", /not set|unset/i);
  }
  assert.deepEqual(f.steps, []);
  assert.equal(existsSync(f.folder), false);
});

test("3.12 a failed step is logged naming it and stops the rest, never failing the session", (t) => {
  const cases = [
    { step: /clone/, options: { gitStatus: 128 }, ran: ["git"] },
    { step: /pull/, options: { gitStatus: 1 }, cloned: true, ran: ["git"] },
    { step: /link/, options: { clones: false }, folderIsFile: true, ran: ["git"] },
    { step: /install/, options: { installOk: false }, ran: ["git", "install"] },
    { step: /settings set module micks-dev-loop plugin micks-dev-loop/, options: { runOk: false }, ran: ["git", "install", "run"] },
  ];
  for (const { step, options, cloned, folderIsFile, ran } of cases) {
    const f = factory(t, options);
    if (cloned) mkdirSync(path.join(f.folder, ".git"), { recursive: true });
    if (folderIsFile) writeFileSync(f.folder, "not a folder");
    const result = cloudFactory(f.options);
    assert.equal(result.ok, false, String(step));
    assert.equal(result.done, false, String(step));
    assert.deepEqual(f.steps.map((s) => s.step), ran, `nothing runs after the failed ${step}`);
    assert.ok(f.lines.some((line) => step.test(line) && /fail/i.test(line)), `a log line names the failed ${step}: ${f.lines.join(" | ")}`);
    assertTokenKeptOut(f, result);
  }
});

test("3.12 as a cloud session-start hook given --factory, --factory-token and --factory-plugin with that token variable unset, it exits 0 and tells the session that the factory at that address was not loaded because that variable is not set", async (t) => {
  const root = worktree(t, "current");
  const home = mkdtempSync(path.join(tmpdir(), "cloud-factory-home-"));
  t.after(() => removeTemp(home));
  const env = { ...cloudEnv(), STORYTREE_HOME: home, GIT_CEILING_DIRECTORIES: path.dirname(root) };
  delete env.ST_TEST_FACTORY_TOKEN;
  delete env.STORYTREE_FACTORY;
  const address = "https://factory.invalid/storytree-factory.git";
  const hook = await run(process.execPath, [
    script, "--hook", "--root", root, "--factory", address, "--factory-token", "ST_TEST_FACTORY_TOKEN", "--factory-plugin", "p",
  ], { env });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "SessionStart");
  assert.equal(
    output.additionalContext,
    "The factory https://factory.invalid/storytree-factory.git was not loaded: its token variable ST_TEST_FACTORY_TOKEN is not set in this cloud session.",
  );
  assert.equal(existsSync(path.join(home, "your-factory")), false, "nothing is cloned into the home");
});
