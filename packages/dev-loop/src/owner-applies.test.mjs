// A change to a folder the owner applies by hand lands with an owner wait to apply it (increment_0269b5e07872):
// the rules live in packages/dev-loop/src/owner-applies.mjs; `pnpm gate` runs them as check:owner-applies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { runGate } from "./gate.mjs";
import { gateSteps } from "./gate-steps.mjs";
import { checkOwnerApplies, ownerAppliedChanges, ownerAppliesFor, ownerAppliesReport, unwaitedApplies } from "./owner-applies.mjs";

const owner = (note, holds = true) => ({ releaser: "owner", note, holds });

test("7.17 a change to an owner-applied folder fails until an owner wait names it; Markdown alone, an event wait or another folder's wait does not count", () => {
  const changes = ownerAppliedChanges(["infra/ci-health/main.tf", "infra/ci-health/README.md", "infra/website-publish/README.md", "infra/library-host/host.mjs", "packages/till/src/drawer.ts"]);
  assert.deepEqual(changes, [{ folder: "infra/ci-health", files: ["infra/ci-health/main.tf"] }]);
  assert.deepEqual(unwaitedApplies(changes, {}), changes);
  assert.deepEqual(unwaitedApplies(changes, {
    increment_a: [{ releaser: "event", note: "infra/ci-health applied by CI", holds: true }],
    increment_b: [owner("apply infra/website-publish")],
    increment_c: [owner("apply infra/ci-health", false)],
  }), changes, "an event wait, a wait naming another folder and one no longer holding leave the apply unwaited");
  assert.deepEqual(unwaitedApplies(changes, { increment_d: [owner("After the branch merges, apply infra/ci-health: terraform plan, then apply")] }), []);

  const unwaited = ownerAppliesReport(changes, changes);
  assert.equal(unwaited.code, 1);
  assert.match(unwaited.error, /infra\/ci-health: infra\/ci-health\/main\.tf/);
  assert.match(unwaited.error, /--wait-for owner --wait-note "After <branch> merges, apply infra\/ci-health/);
  assert.equal(ownerAppliesReport(changes, []).code, 0, "an owner wait names every folder");
  assert.equal(ownerAppliesReport(changes, undefined).code, 1, "a library that could not be read fails");
  assert.equal(ownerAppliesReport([], undefined).code, 0, "a branch changing no such folder needs no library");
  assert.equal(ownerAppliesReport(undefined, []).code, 1, "Git that cannot say fails");
});

test("7.17 the gate runs check:owner-applies on a branch changing an owner-applied folder, and leaves it NOT RUN with its reason otherwise", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "owner-applies-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, stdio: "pipe" });
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write("infra/website-publish/main.tf", "resource {}\n");
  write("infra/website-publish/README.md", "readme\n");
  git("init", "-q", "-b", "claude/dazzling-jones-f96c61");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const gate = async () => {
    const calls = [];
    const output = [];
    // The temporary checkout has no package.json to compose the gate's steps from, so it is handed dev-loop's.
    const steps = async () => ({ parts: gateSteps, owners: gateSteps.map(() => "dev-loop"), graph: { "dev-loop": [] } });
    const code = await runGate({ root, steps, partsOff: () => [], run: async (step) => { calls.push(step); return step === "check:owner-applies" ? 1 : 0; }, log: (line) => output.push(line) });
    return { code, calls, table: output.at(-1) };
  };

  write("infra/website-publish/README.md", "readme, reworded\n");
  const prose = await gate();
  assert.equal(prose.code, 0);
  assert.ok(!prose.calls.includes("check:owner-applies"));
  assert.match(prose.table, /NOT RUN\s+check:owner-applies.*no owner-applied infra folder changed/);

  write("infra/website-publish/main.tf", "resource { changed = true }\n");
  const applied = await gate();
  assert.equal(applied.code, 1);
  assert.ok(applied.calls.includes("check:owner-applies"));
  assert.match(applied.table, /FAIL\s+check:owner-applies/);

  const said = [];
  const asked = [];
  const say = { log: (line) => said.push(["log", line]), error: (line) => said.push(["error", line]) };
  const waits = (waitsFor) => async (read) => (asked.push(true), read(waitsFor));
  assert.equal(await checkOwnerApplies(root, waits({}), say), 1);
  assert.match(said.at(-1)[1], /^This branch changes folders the owner applies by hand[^]*infra\/website-publish\/main\.tf/);
  assert.equal(said.at(-1)[0], "error");
  assert.equal(await checkOwnerApplies(root, waits({ increment_a: [owner("apply infra/website-publish")] }), say), 0);
  assert.deepEqual(said.at(-1), ["log", "an owner wait names each owner-applied folder this branch changes (infra/website-publish)"]);
  assert.equal(await checkOwnerApplies(root, async () => undefined, say), 1, "a library that cannot be read fails");
  git("checkout", "--", "infra/website-publish/main.tf");
  asked.length = 0;
  assert.equal(await checkOwnerApplies(root, waits({}), say), 0);
  assert.deepEqual(asked, [], "a branch changing no owner-applied folder reads no library");
  assert.deepEqual(said.at(-1), ["log", "this branch changes no owner-applied infra folder"]);

  const bare = mkdtempSync(path.join(tmpdir(), "owner-applies-bare-"));
  t.after(() => removeTemp(bare));
  assert.equal(ownerAppliesFor(bare).run, true, "a checkout Git cannot read is checked, not passed");
});
