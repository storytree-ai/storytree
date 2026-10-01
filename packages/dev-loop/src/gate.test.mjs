// ADR-0716 / increment_bc6346078e4d: one foreground gate runs typecheck, the existing
// scoped test runner and guidance when touched, continuing past failures with honest rows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { guidanceFor, runGate } from "./gate.mjs";

function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), "gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, stdio: "pipe" });
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const claude = "# Hand-written header\n<!-- storytree:guidance START -->\nrole\n<!-- storytree:guidance END -->\n";
  write("CLAUDE.md", claude);
  write("AGENTS.md", "role\n");
  write(".claude/agents/reader.md", "reader\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, git, write, claude };
}

test("7.1 the gate runs typecheck and scoped tests, and explains guidance NOT RUN without failing", async (t) => {
  const { root, write } = checkout(t);
  write("packages/example/src/change.ts", "changed\n");
  const calls = [];
  const output = [];
  const code = await runGate({ root, run: async (step) => { calls.push(step); return 0; }, log: (line) => output.push(line) });
  assert.deepEqual(calls, ["typecheck", "test", "check:plan-edges"]);
  assert.equal(code, 0);
  const table = output.at(-1);
  assert.match(table, /PASS\s+typecheck/);
  assert.match(table, /PASS\s+test/);
  assert.match(table, /NOT RUN\s+check:guidance.*no role or note change/);
  assert.match(table, /--guidance/, "library-only edits need an explicit way to request the check");
  assert.doesNotMatch(table, /rerun-failed/);
});

test("library-only guidance edits can request every check, plan edges included (3.7), continuing past failure or launch error", async (t) => {
  const { root } = checkout(t);
  for (const broken of ["typecheck", "test", "check:guidance", "check:plan-edges"]) {
    const calls = [];
    const output = [];
    const code = await runGate({ root, guidance: true, log: (line) => output.push(line), run: async (step) => {
      calls.push(step);
      if (step === broken && step === "typecheck") throw new Error("cannot start typechecker");
      return step === broken ? 2 : 0;
    } });
    assert.deepEqual(calls, ["typecheck", "test", "check:guidance", "check:plan-edges"]);
    assert.equal(code, 1);
    assert.ok(output.at(-1).includes(`FAIL    ${broken}`));
    assert.match(output.at(-1), /rerun: pnpm run gate --guidance/);
    assert.doesNotMatch(output.at(-1), /rerun-failed/);
  }
});

test("7.3 interruption leaves the current and remaining checks NOT RUN and exits nonzero", async (t) => {
  const { root } = checkout(t);
  const controller = new AbortController();
  const output = [];
  const calls = [];
  const code = await runGate({ root, guidance: true, signal: controller.signal, log: (line) => output.push(line), run: async (step) => {
    calls.push(step);
    controller.abort();
    return 0;
  } });
  assert.equal(code, 130);
  assert.deepEqual(calls, ["typecheck"]);
  assert.match(output.at(-1), /NOT RUN\s+typecheck.*interrupted/);
  assert.match(output.at(-1), /NOT RUN\s+test.*interrupted/);
  assert.match(output.at(-1), /NOT RUN\s+check:guidance.*interrupted/);
});

test("guidance follows branch and working-tree role edits, including added and deleted role files", (t) => {
  const { root, write, git, claude } = checkout(t);
  assert.equal(guidanceFor(root).run, false);
  write("CLAUDE.md", claude.replace("Hand-written header", "pnpm gate"));
  assert.equal(guidanceFor(root).run, false, "the hand-written header is not a library role");
  write("CLAUDE.md", claude.replace("\nrole\n", "\nnew role\n"));
  assert.equal(guidanceFor(root).run, true);
  git("add", "CLAUDE.md");
  git("commit", "-qm", "changed root role");
  assert.equal(guidanceFor(root).run, true, "committed role edits still count");
  write("CLAUDE.md", claude);
  assert.equal(guidanceFor(root).run, false);
  write(".codex/agents/new.toml", "new role");
  assert.equal(guidanceFor(root).run, true, "untracked generated roles count");
  rmSync(path.join(root, ".codex"), { recursive: true });
  rmSync(path.join(root, ".claude/agents/reader.md"));
  assert.equal(guidanceFor(root).run, true, "removed generated roles count");
  write(".claude/agents/reader.md", "reader\n");
  write("AGENTS.md", "new root role\n");
  assert.equal(guidanceFor(root).run, true);
});

test("7.2 unreadable change scope requires guidance instead of guessing that nothing changed", (t) => {
  const { root, git } = checkout(t);
  git("update-ref", "-d", "refs/remotes/origin/main");
  const decision = guidanceFor(root);
  assert.equal(decision.run, true);
  assert.match(decision.reason, /could not.*read/);
});

test("7.3 cancelling the foreground gate stops the typecheck process and its compiler descendant", { timeout: 15_000 }, async (t) => {
  const { root, write } = checkout(t);
  // A package manager starting a compiler, as pnpm typecheck does. Use real processes here:
  // a callback-only cancellation test cannot detect an abandoned compiler.
  write("manager.mjs", `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    writeFileSync('manager.pid', String(process.pid));
    spawn(process.execPath, ['compiler.mjs'], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `);
  write("compiler.mjs", `
    import { writeFileSync } from 'node:fs';
    writeFileSync('compiler.pid', String(process.pid));
    setInterval(() => {}, 1000);
  `);
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = path.join(root, "manager.mjs");
  const controller = new AbortController();
  const pids = [];
  t.after(() => {
    controller.abort();
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  });
  const running = runGate({ root, signal: controller.signal, log: () => {} });
  for (const file of ["manager.pid", "compiler.pid"]) {
    for (let i = 0; i < 200 && !existsSync(path.join(root, file)); i++) await delay(25);
    pids.push(Number(readFileSync(path.join(root, file), "utf8")));
  }
  controller.abort();
  assert.equal(await running, 130);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 100 && pids.some(alive); i++) await delay(25);
  assert.deepEqual(pids.filter(alive), [], "no typecheck child survives the completed gate");
});
