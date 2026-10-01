// The plan's edges between stories follow the code (ADR-0840 D2): the rules live in
// packages/dev-loop/src/plan-edges.mjs; `pnpm gate` runs them against the library, which CI cannot read.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { planEdgeProblems, planEdgeVerdict } from "./plan-edges.mjs";

/** A repo whose shop depends on the till, the till on the bank, and the frame's desktop on the ledger. */
function plant(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-edges-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifests = {
    "packages/shop": { name: "@storytree/shop", dependencies: { "@storytree/till": "workspace:*" } },
    "packages/till": { name: "@storytree/till", devDependencies: { "@storytree/bank": "workspace:*" } },
    "packages/bank": { name: "@storytree/bank" },
    "packages/app": { name: "@storytree/app" },
    "packages/processes": { name: "@storytree/processes" },
    "apps/desktop": { name: "@storytree/desktop", devDependencies: { "@storytree/processes": "workspace:*" } },
  };
  for (const [at, manifest] of Object.entries(manifests)) {
    mkdirSync(path.join(dir, at), { recursive: true });
    writeFileSync(path.join(dir, at, "package.json"), JSON.stringify(manifest));
  }
  return dir;
}

/** A plan whose stories each have one capability, depending on the capabilities of the stories named. */
function plan(dependsOn) {
  return { stories: Object.entries(dependsOn).map(([title, on]) => ({ id: `story-${title}`, title, capabilities: [{ id: `cap-${title}`, title: `1 · ${title}'s part`, dependsOn: on.map((other) => `cap-${other}`) }] })) };
}

test("3.7 a capability depending on another story's against the code's direction is refused; with it, directly or not, it passes", (t) => {
  const root = plant(t);
  assert.deepEqual(planEdgeProblems(root, plan({ "The shop": ["The till", "The bank"], "The till": [], "The bank": [], "The app": ["Process ledger"], "Process ledger": [] })), []);
  const problems = planEdgeProblems(root, plan({ "The shop": [], "The till": [], "The bank": ["The shop"], "The app": [], "Process ledger": ["The app"] }));
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /The bank.*The shop.*@storytree\/bank.*@storytree\/shop/);
  assert.match(problems.join("\n"), /Process ledger.*The app/);
});

// increment_dbe087a55e1b: another lane's plan edge, mid-way to its code, does not fail a branch that touches neither story.
test("3.7 a branch fails only on edges between stories whose packages it changes; any other edge is a note naming it", (t) => {
  const root = plant(t);
  const tree = plan({ "The shop": [], "The till": [], "The bank": ["The shop"], "The app": [], "Process ledger": ["The app"] });
  const verdict = planEdgeVerdict(root, tree, ["packages/bank/src/vault.ts", "packages/shop/package.json", "README.md"]);
  assert.equal(verdict.failing.length, 1, verdict.failing.join("\n"));
  assert.match(verdict.failing[0], /The bank.*The shop/);
  assert.equal(verdict.notes.length, 1, verdict.notes.join("\n"));
  assert.match(verdict.notes[0], /Process ledger.*The app/);
  const elsewhere = planEdgeVerdict(root, tree, ["packages/till/src/drawer.ts"]);
  assert.deepEqual(elsewhere.failing, []);
  assert.equal(elsewhere.notes.length, 2);
  assert.equal(planEdgeVerdict(root, tree, undefined).failing.length, 2, "a branch git cannot read is held to every edge");
});
