// The fresh-worktree install (packages/dev-loop/src/provision-worktree.mjs): at session start, a 0.3 worktree that
// cannot run its own code gets `pnpm install`, retried once, and the agent is told plainly when it
// still cannot. The three conditions are 0.2's (ADR-0636 D1, ported per ADR-0633 D2): FRESH (no
// install ever completed), STALE (pnpm-lock.yaml moved past the install, as after merging main) and
// UNLINKED (an install reported success but linked no workspace package).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { hookOutput, provision, serve } from "./provision-worktree.mjs";

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

test("before a storytree command, an uninstalled worktree is refused with the command that installs it", (t) => {
  for (const condition of ["fresh", "unlinked"]) {
    const root = worktree(t, condition);
    const run = spawnSync(process.execPath, [script, "--check", "--root", root], { encoding: "utf8" });
    assert.equal(run.status, 1, condition);
    assert.equal(run.stdout, "");
    assert.ok(run.stderr.includes(root), `${condition}: it names the worktree`);
    assert.match(run.stderr, /node packages\/dev-loop\/src\/provision-worktree\.mjs/, `${condition}: it names the fix`);
    assert.equal(run.stderr.trim().split("\n").length, 1, `${condition}: in one line`);
  }
  const current = spawnSync(process.execPath, [script, "--check", "--root", worktree(t, "current")], { encoding: "utf8" });
  assert.equal(current.status, 0);
  assert.equal(current.stdout + current.stderr, "", "an installed worktree runs the command with nothing said");
});

test("before a storytree command, a worktree missing the link to a workspace package main added is refused with the fix", (t) => {
  // Installed and current, but packages/library now depends on packages/keys, which landed after the install.
  const root = worktree(t, "current");
  mkdirSync(path.join(root, "packages", "keys"));
  writeFileSync(path.join(root, "packages", "keys", "package.json"), JSON.stringify({ name: "@storytree/keys" }));
  const library = { name: "@storytree/library", dependencies: { "@storytree/keys": "workspace:*" } };
  writeFileSync(path.join(root, "packages", "library", "package.json"), JSON.stringify(library));
  const run = spawnSync(process.execPath, [script, "--check", "--root", root], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /node packages\/dev-loop\/src\/provision-worktree\.mjs/, "it names the fix");
  assert.ok(run.stderr.includes("@storytree/keys"), "it names the package the install lacks");
  let calls = 0;
  provision({ root, install: () => (calls++, { ok: true }) });
  assert.equal(calls, 1, "the session-start hook reinstalls it");

  // Once the install links it, the command runs.
  mkdirSync(path.join(root, "packages", "library", "node_modules", "@storytree", "keys"), { recursive: true });
  const linked = spawnSync(process.execPath, [script, "--check", "--root", root], { encoding: "utf8" });
  assert.equal(linked.status, 0, linked.stderr);
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
