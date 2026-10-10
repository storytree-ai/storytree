// The fresh-worktree install (packages/dev-loop/src/provision-worktree.mjs): at session start, a 0.3 worktree that
// cannot run its own code gets `pnpm install`, retried once, and the agent is told plainly when it
// still cannot. The three conditions are 0.2's (ADR-0636 D1, ported per ADR-0633 D2): FRESH (no
// install ever completed), STALE (pnpm-lock.yaml moved past the install, as after merging main) and
// UNLINKED (an install reported success but linked no workspace package).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { check, hookOutput, provision, serve } from "./provision-worktree.mjs";

const script = fileURLToPath(new URL("./provision-worktree.mjs", import.meta.url));

/** A worktree on disk: one workspace package, and node_modules as the named condition leaves it. */
function worktree(t, condition) {
  const root = mkdtempSync(path.join(tmpdir(), "provision-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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

test("2.1 a worktree that is installed and current is left alone", (t) => {
  const root = worktree(t, "current");
  let calls = 0;
  const result = provision({ root, install: () => (calls++, { ok: true }) });
  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(hookOutput(result, root), "", "a healthy session is told nothing");
});

test("2.2 a fresh, a stale and an unlinked worktree each get installed", (t) => {
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

test("2.3 a failed install is retried once, and if it still fails the agent is told which condition and where to run pnpm install", (t) => {
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

test("2.1 as a session-start hook it exits 0 and says nothing on a healthy worktree", (t) => {
  const root = worktree(t, "current");
  const run = spawnSync(process.execPath, [script, "--hook", "--root", root], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
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

test("2.2 before a storytree command, an uninstalled worktree is installed and the command runs", (t) => {
  for (const condition of ["fresh", "unlinked"]) {
    const root = worktree(t, condition);
    const ran = [];
    assert.equal(check({ root, install: linkingInstall(ran) }), 0, condition);
    assert.deepEqual(ran, [root], `${condition}: one install, in the worktree`);
  }
  const current = spawnSync(process.execPath, [script, "--check", "--root", worktree(t, "current")], { encoding: "utf8" });
  assert.equal(current.status, 0);
  assert.equal(current.stdout + current.stderr, "", "an installed worktree runs the command with nothing said");
});

test("2.3 before a storytree command, a worktree its install cannot fix is refused in one line with the command that installs it", (t) => {
  for (const condition of ["fresh", "unlinked"]) {
    const root = worktree(t, condition);
    const lines = [];
    assert.equal(check({ root, install: () => ({ ok: false, code: 1 }), log: (line) => lines.push(line) }), 1, condition);
    const refusal = lines.at(-1);
    assert.ok(refusal.includes(root), `${condition}: it names the worktree`);
    assert.match(refusal, /node packages\/dev-loop\/src\/provision-worktree\.mjs/, `${condition}: it names the fix`);
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
  test(`2.2 before a storytree command, a ${condition} worktree missing a package's workspace link is reinstalled and the command runs`, (t) => {
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

test("2.2 missing root workspace links are reinstalled even after a package's missing link is repaired", (t) => {
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
  const repaired = spawnSync(process.execPath, [script, "--check", "--root", root], { encoding: "utf8" });
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(repaired.stdout + repaired.stderr, "");
});

test("the tool server starts in a fresh worktree once the session-start install has finished", async (t) => {
  const root = worktree(t, "fresh");
  let started = 0;
  const serving = serve({ root, start: () => (started++, Promise.resolve(0)), pollMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(started, 0, "not before the install");
  // The session-start hook's install completes.
  mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(path.join(root, "packages", "library", "node_modules"));
  writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
  assert.equal(await serving, 0);
  assert.equal(started, 1);
});

function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Provision test", "-c", "user.email=provision@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** Two real repositories: origin can advance independently of the installed primary checkout. */
function repoPair(t) {
  const remote = worktree(t, "current");
  git(remote, "init", "--initial-branch=main");
  writeFileSync(path.join(remote, "version.txt"), "one\n");
  git(remote, "add", "version.txt");
  git(remote, "commit", "-m", "initial");
  const root = worktree(t, "current");
  git(root, "init", "--initial-branch=main");
  git(root, "remote", "add", "origin", remote);
  git(root, "fetch", "origin", "main");
  git(root, "reset", "--hard", "origin/main");
  return { root, remote };
}

test("2.4 a stale primary names the gap at session start and refuses to serve until updated", async (t) => {
  const { root, remote } = repoPair(t);
  git(remote, "commit", "--allow-empty", "-m", "new record schema");
  git(root, "fetch", "origin", "main");
  const before = git(root, "rev-parse", "HEAD");
  const hook = spawnSync(process.execPath, [script, "--hook", "--root", root], { encoding: "utf8" });
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
  assert.equal(git(root, "rev-parse", "HEAD"), before, "startup never moves the checkout");

  git(root, "merge", "--ff-only", "origin/main");
  assert.equal(hookOutput(provision({ root }), root), "", "an updated primary is silent");
  assert.equal(await serve({ root, start: async () => 17 }), 17, "the updated server can start");
});

test("2.4 a stale dirty or diverged primary keeps its edits and names local commits to reconcile", (t) => {
  const { root, remote } = repoPair(t);
  git(root, "commit", "--allow-empty", "-m", "local work");
  writeFileSync(path.join(root, "version.txt"), "local edits\n");
  git(remote, "commit", "--allow-empty", "-m", "new record schema");
  git(root, "fetch", "origin", "main");
  const before = git(root, "rev-parse", "HEAD");
  const result = provision({ root, install: () => assert.fail("updating the checkout comes first") });
  assert.equal(result.ok, false);
  const warning = JSON.parse(hookOutput(result, root)).hookSpecificOutput.additionalContext;
  assert.match(warning, /1 commit behind/);
  assert.match(warning, /1 local commit/);
  assert.match(warning, /reconcile/i);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(readFileSync(path.join(root, "version.txt"), "utf8"), "local edits\n");
});

test("2.4 a feature branch or linked worktree can serve while the primary is behind", async (t) => {
  const { root, remote } = repoPair(t);
  git(remote, "commit", "--allow-empty", "-m", "new record schema");
  git(root, "fetch", "origin", "main");
  git(root, "switch", "-c", "feature");
  assert.equal(hookOutput(provision({ root }), root), "");
  assert.equal(await serve({ root, start: async () => 19 }), 19);

  const linked = path.join(root, "linked");
  git(root, "worktree", "add", linked, "main");
  assert.equal(await serve({ root: linked, waitMs: 0, start: async () => 23 }), 23, "even a linked worktree on main is left alone");
});
