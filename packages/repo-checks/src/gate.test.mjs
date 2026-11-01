// Capability 8 · Storytree's own test and gate entries. ADR-0716 / increment_bc6346078e4d: one foreground gate runs
// typecheck, the existing scoped test runner and the steps parts contribute, continuing past failures with honest rows.
// The guidance check's own tests moved with it into Mick's factory plugin micks-dev-loop (ADR-1192 D2).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { gateSteps as repoSteps } from "./gate-steps.mjs";

import { runGate } from "./gate.mjs";

// The gate's own steps as the checkout's manifests contribute them (the repository checks'), with nothing switched off:
// the temporary folders below have no package.json to compose them from.
const own = { steps: async () => ({ parts: repoSteps, owners: repoSteps.map(() => "repo-checks"), graph: { "repo-checks": [] } }), partsOff: () => [], hold: async () => () => {} };
const gate = (options) => runGate({ ...own, ...options });

function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), "gate-"));
  t.after(() => removeTemp(root));
  return { root };
}

test("8.1 the gate installs an uninstalled worktree before its first check, and one it cannot install leaves every check NOT RUN", async (t) => {
  const { root } = checkout(t);
  const calls = [];
  const code = await gate({ root, provision: () => (calls.push("install"), 0), run: async (step) => (calls.push(step), 0), log: () => {} });
  assert.deepEqual(calls, ["install", "typecheck", "test", "lint", "check:seed-records", "check:leaks", "check:secrets"]);
  assert.equal(code, 0);

  const ran = [];
  const output = [];
  const refused = await gate({ root, provision: (log) => (log("this worktree is FRESH, not installed"), 1), run: async (step) => (ran.push(step), 0), log: (line) => output.push(line) });
  assert.deepEqual(ran, [], "no check runs against a worktree with no modules");
  assert.equal(refused, 1);
  assert.match(output.at(-1), /NOT RUN\s+typecheck.*worktree not installed/);
  assert.match(output.at(-1), /NOT RUN\s+test.*worktree not installed/);
});

test("8.3 the gate takes its hold once installed, before its first check, and lets it go after its table; a worktree it cannot install takes none", async (t) => {
  const { root } = checkout(t);
  const calls = [];
  const hold = async ({ what }) => (calls.push(`take for ${what}`), () => calls.push("release"));
  await gate({ root, hold, provision: () => (calls.push("install"), 0), run: async (step) => (calls.push(step), 0), log: (line) => line.includes("results:") && calls.push("table") });
  assert.deepEqual(calls.slice(0, 3), ["install", "take for pnpm gate", "typecheck"]);
  assert.deepEqual(calls.slice(-2), ["table", "release"]);

  calls.length = 0;
  await gate({ root, hold, provision: () => 1, run: async (step) => (calls.push(step), 0), log: () => {} });
  assert.deepEqual(calls, []);
});

test("8.4 the gate hands its steps --guidance only when given it", async (t) => {
  const { root } = checkout(t);
  const seen = [];
  const step = { name: "check:reads-guidance", when: ({ guidance }) => (seen.push(guidance), { run: false, reason: "only read" }), command: () => ({ command: process.execPath, args: [], shell: false }) };
  const steps = async () => ({ parts: [step], owners: ["reader"], graph: { reader: [] } });
  for (const guidance of [undefined, true]) await gate({ root, steps, guidance, run: async () => 0, log: () => {} });
  assert.deepEqual(seen, [false, true]);
});
