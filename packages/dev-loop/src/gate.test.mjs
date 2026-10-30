// ADR-0716 / increment_bc6346078e4d: one foreground gate runs typecheck, the existing
// scoped test runner and guidance when touched, continuing past failures with honest rows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { contributedSteps } from "@storytree/base-dev-loop";

import { runGate } from "./gate.mjs";
import { gateSteps, guidanceFor } from "./gate-steps.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// The gate's own steps as the checkout's manifest contributes them, with nothing switched off: the temporary
// checkouts below have no package.json to compose them from.
const own = { steps: async () => ({ parts: gateSteps, owners: gateSteps.map(() => "dev-loop"), graph: { "dev-loop": [] } }), partsOff: () => [] };
const gate = (options) => runGate({ ...own, ...options });

function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), "gate-"));
  t.after(() => removeTemp(root));
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
  const code = await gate({ root, run: async (step) => { calls.push(step); return 0; }, log: (line) => output.push(line) });
  assert.deepEqual(calls, ["typecheck", "test", "check:plan-edges", "check:type-imports", "check:seed-records", "check:leaks", "check:secrets"]);
  assert.equal(code, 0);
  const table = output.at(-1);
  assert.match(table, /PASS\s+typecheck/);
  assert.match(table, /PASS\s+test/);
  assert.match(table, /NOT RUN\s+check:guidance.*no role or note change/);
  assert.match(table, /--guidance/, "library-only edits need an explicit way to request the check");
  assert.doesNotMatch(table, /rerun-failed/);
});

test("7.5 the gate installs an uninstalled worktree before its first check, and one it cannot install leaves every check NOT RUN", async (t) => {
  const { root } = checkout(t);
  const calls = [];
  const code = await gate({ root, provision: () => (calls.push("install"), 0), run: async (step) => (calls.push(step), 0), log: () => {} });
  assert.deepEqual(calls, ["install", "typecheck", "test", "check:plan-edges", "check:type-imports", "check:seed-records", "check:leaks", "check:secrets"]);
  assert.equal(code, 0);

  const ran = [];
  const output = [];
  const refused = await gate({ root, provision: (log) => (log("this worktree is FRESH, not installed"), 1), run: async (step) => (ran.push(step), 0), log: (line) => output.push(line) });
  assert.deepEqual(ran, [], "no check runs against a worktree with no modules");
  assert.equal(refused, 1);
  assert.match(output.at(-1), /NOT RUN\s+typecheck.*worktree not installed/);
  assert.match(output.at(-1), /NOT RUN\s+test.*worktree not installed/);
});

test("library-only guidance edits can request every check, plan edges included (3.7), continuing past failure or launch error", async (t) => {
  const { root } = checkout(t);
  for (const broken of ["typecheck", "test", "check:guidance", "check:plan-edges", "check:type-imports", "check:seed-records", "check:leaks", "check:secrets"]) {
    const calls = [];
    const output = [];
    const code = await gate({ root, guidance: true, log: (line) => output.push(line), run: async (step) => {
      calls.push(step);
      if (step === broken && step === "typecheck") throw new Error("cannot start typechecker");
      return step === broken ? 2 : 0;
    } });
    assert.deepEqual(calls, ["typecheck", "test", "check:guidance", "check:plan-edges", "check:type-imports", "check:seed-records", "check:leaks", "check:secrets"]);
    assert.equal(code, 1);
    assert.ok(output.at(-1).includes(`FAIL    ${broken}`));
    assert.match(output.at(-1), /rerun: pnpm run gate --guidance/);
    assert.doesNotMatch(output.at(-1), /rerun-failed/);
  }
});

test("guidance follows branch and working-tree role edits, including added and deleted role files", (t) => {
  const { root, write, git, claude } = checkout(t);
  assert.equal(guidanceFor(root).run, false);
  write("CLAUDE.md", claude.replace("Hand-written header", "pnpm gate"));
  assert.equal(guidanceFor(root).run, false, "the hand-written header is not a library role");
  write("CLAUDE.md", claude.replace("\nrole\n", "\nnew role\n"));
  assert.equal(guidanceFor(root).run, true);
  write("CLAUDE.md", claude.replace("\nrole\n", "\nRole\n"));
  assert.equal(guidanceFor(root).run, true, "an edit that keeps the role's length still counts");
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

test("7.11 on an increment's branch the gate writes the change's risk line through quality risk, after the capability list; a branch naming none leaves it NOT RUN", async (t) => {
  const { root, git } = checkout(t);
  const gateHere = async () => {
    const calls = [];
    const output = [];
    const code = await gate({ root, run: async (step, { command }) => { calls.push([step, command.args.at(-1)]); return 0; }, log: (line) => output.push(line) });
    return { code, steps: calls.map(([step]) => step), calls, table: output.at(-1) };
  };
  git("checkout", "-q", "-b", "claude/dazzling-jones-f96c61");
  const unnamed = await gateHere();
  assert.ok(!unnamed.steps.includes("check:risk"));
  assert.match(unnamed.table, /NOT RUN\s+check:risk.*names no increment/);

  git("checkout", "-q", "-b", "claude/increment-ca8ba53211b7-f8f424");
  const named = await gateHere();
  assert.equal(named.code, 0);
  assert.deepEqual(named.steps.slice(-2), ["check:capability-list", "check:risk"]);
  assert.equal(named.calls.at(-1)[0], "check:risk");
  assert.match(named.table, /PASS\s+check:risk/);
  const risk = gateSteps.find((step) => step.name === "check:risk").command({ root });
  assert.deepEqual(risk.args.slice(-6, -2), ["packages/cli/src/bins/storytree.ts", "quality", "risk", "increment_ca8ba53211b7"]);
});

test("7.1 storytree's checkout contributes its nine checks to the base dev loop's gate from dev-loop's manifest, in today's order", async () => {
  const { parts, owners } = await contributedSteps(repoRoot);
  assert.deepEqual(parts.map((step) => step.name), ["check:guidance", "check:plan-edges", "check:type-imports", "check:seed-records", "check:leaks", "check:secrets", "check:owner-applies", "check:capability-list", "check:risk"]);
  assert.deepEqual([...new Set(owners)], ["dev-loop"]);
});

test("7.11 a branch renamed after review to name its increment runs check:capability-list, and check:risk reads that checkout's own change, not the branch its claim recorded", async (t) => {
  const { root, git, write } = checkout(t);
  git("checkout", "-q", "-b", "claude/frosty-northcutt-e52ff6");
  write("packages/a/src/a.mjs", "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "the increment's change");
  git("branch", "-m", "claude/increment-b962bb8544d2-e52ff6");
  write("packages/a/src/b.mjs", "export const b = 2;\n");

  const calls = [];
  const output = [];
  await gate({ root, run: async (step) => { calls.push(step); return 0; }, log: (line) => output.push(line) });
  assert.deepEqual(calls.slice(-2), ["check:capability-list", "check:risk"]);

  const { args } = gateSteps.find((step) => step.name === "check:risk").command({ root });
  assert.deepEqual(args.slice(-5, -2), ["quality", "risk", "increment_b962bb8544d2"]);
  assert.equal(args.at(-2), "--diff");
  const diff = readFileSync(args.at(-1).slice(1), "utf8");
  assert.match(diff, /^\+export const a = 1;$/m, "the committed change is read from this checkout");
  assert.match(diff, /^\+export const b = 2;$/m, "and so is a file not yet committed");
});
