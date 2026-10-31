// The fresh-worktree install (packages/base-dev-loop/src/provision-worktree.mjs): at session start, a 0.3 worktree that
// cannot run its own code gets `pnpm install`, retried once, and the agent is told plainly when it
// still cannot. The three conditions are 0.2's (ADR-0636 D1, ported per ADR-0633 D2): FRESH (no
// install ever completed), STALE (pnpm-lock.yaml moved past the install, as after merging main) and
// UNLINKED (an install reported success but linked no workspace package).
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { quietFor, removeTemp } from "@storytree/test-waits";

import { check, connectCloud, hookOutput, installEnvironment, pnpmInstall, provision, serve } from "./provision-worktree.mjs";

const script = fileURLToPath(new URL("./provision-worktree.mjs", import.meta.url));

/**
 * Run a child to its end without blocking this process. On Windows a test file's reports reach the
 * runner through an asynchronous pipe, so a file that only blocks in spawnSync reports nothing, and
 * past 20 s the runner's exit watch kills it as hung (friction_d9a154e094e1).
 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr: stderr || (error?.message ?? "") });
    });
  });
}

/** A worktree on disk: one workspace package, and node_modules as the named condition leaves it. */
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
  assert.ok(text.indexOf("/packages/repo-checks/src/push-check.mjs") < text.indexOf("/packages/dev-loop/src/push-check.mjs"), "a branch from before the move is the fallback, not the first choice");
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

  // A retry that succeeds is a success.
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

/**
 * An Electron package in root's virtual store, as Electron 44 is installed: no binary until its
 * install.js runs. This install.js counts its runs, and writes what Electron's own does (dist/ and
 * path.txt) unless told to fail.
 */
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

/** A fake `pnpm install` that leaves root as a completed install with every workspace link made. */
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

/** packages/library now depends on packages/keys, which landed after the install. */
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
  // An install that reports success but still links nothing is refused too, naming the missing link.
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

  // Only the root's link is missing, although the lockfile still matches the last install.
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
  // The session-start hook's install completes.
  mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(path.join(root, "packages", "library", "node_modules"));
  writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
  assert.equal(await serving, 0);
  assert.equal(started, 1);
});

async function git(root, ...args) {
  const result = await run("git", ["-c", "user.name=Provision test", "-c", "user.email=provision@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** Two real repositories: origin can advance independently of the installed primary checkout. */
async function repoPair(t) {
  const remote = worktree(t, "current");
  await git(remote, "init", "--initial-branch=main");
  writeFileSync(path.join(remote, "version.txt"), "one\n");
  await git(remote, "add", "version.txt");
  await git(remote, "commit", "-m", "initial");
  const root = worktree(t, "current");
  await git(root, "init", "--initial-branch=main");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "fetch", "origin", "main");
  await git(root, "reset", "--hard", "origin/main");
  return { root, remote };
}

test("3.4 a stale primary names the gap at session start and refuses to serve until updated", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  await git(root, "fetch", "origin", "main");
  const before = await git(root, "rev-parse", "HEAD");
  const hook = await run(process.execPath, [script, "--hook", "--root", root]);
  assert.equal(hook.status, 0, "a warning must leave the session able to repair its checkout");
  assert.notEqual(hook.stdout, "", "the session is told about its stale checkout");
  const warning = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.ok(warning.includes(root));
  assert.match(warning, /1 commit behind.*origin\/main/);
  assert.match(warning, /git pull --ff-only origin main && pnpm install/);
  assert.match(warning, /restart/i);
  const messages = [];
  const code = await serve({ root, start: () => assert.fail("a stale server must not start"), log: (message) => messages.push(message) });
  assert.equal(code, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /1 commit behind/);
  assert.equal(await git(root, "rev-parse", "HEAD"), before, "startup never moves the checkout");

  await git(root, "merge", "--ff-only", "origin/main");
  assert.equal(hookOutput(provision({ root }), root), "", "an updated primary is silent");
  assert.equal(await serve({ root, start: async () => 17 }), 17, "the updated server can start");
});

test("3.4 a stale dirty or diverged primary keeps its edits and names local commits to reconcile", async (t) => {
  const { root, remote } = await repoPair(t);
  await git(root, "commit", "--allow-empty", "-m", "local work");
  writeFileSync(path.join(root, "version.txt"), "local edits\n");
  await git(remote, "commit", "--allow-empty", "-m", "new record schema");
  await git(root, "fetch", "origin", "main");
  const before = await git(root, "rev-parse", "HEAD");
  const result = provision({ root, install: () => assert.fail("updating the checkout comes first") });
  assert.equal(result.ok, false);
  const warning = JSON.parse(hookOutput(result, root)).hookSpecificOutput.additionalContext;
  assert.match(warning, /1 commit behind/);
  assert.match(warning, /1 local commit/);
  assert.match(warning, /reconcile/i);
  assert.equal(await git(root, "rev-parse", "HEAD"), before);
  assert.equal(readFileSync(path.join(root, "version.txt"), "utf8"), "local edits\n");
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

/** A cloud container's checkout and storytree home, with nothing of storytree's set up in the home. */
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
