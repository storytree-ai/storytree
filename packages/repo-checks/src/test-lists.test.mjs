// Capability 8 · Storytree's own test and gate entries. increment_333dd2946299: the base runner names no file of storytree's
// own, so storytree's `pnpm test` hands it its lists; and it holds what this computer's parts contribute (8.3).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify, planRun, readWorkspace } from "@storytree/base-dev-loop/test-scope";
import { removeTemp } from "@storytree/test-waits";

import { ALWAYS_RUN } from "./test.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("8.2 storytree's pnpm test carries its package-boundary and allocation checks in every scoped run, and runs its browser proofs alone", (t) => {
  const workspace = readWorkspace(root);
  const { units } = planRun({ root, workspace, decision: classify(["packages/mark/src/x.ts"], workspace), alwaysRun: ALWAYS_RUN });
  for (const check of ["packages/repo-checks/src/package-boundaries.test.mjs", "packages/repo-checks/src/allocation.test.mjs"]) assert.ok(units.includes(check), `${check}: ${units.join(", ")}`);

  const home = mkdtempSync(path.join(tmpdir(), "test-lists-"));
  t.after(() => removeTemp(home));
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/repo-checks/src/test.mjs", "--only=forest", "--scope"], { cwd: root, env: { ...process.env, STORYTREE_HOME: home }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^units: packages\/forest, packages\/forest\/src\/view\/desktop-renderer-smoke\.test\.ts$/m, run.stdout);
});

test("8.3 storytree's pnpm test takes the run hold a plugin this computer names contributes, past its scope decision, and lets it go once its run has ended", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "test-hold-"));
  t.after(() => removeTemp(dir));
  const home = path.join(dir, "home");
  const factory = path.join(dir, "factory");
  const plugin = path.join(factory, "plugins", "my-lock");
  const events = path.join(dir, "events");
  mkdirSync(home, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ factory, "parts-off": ["my-lock"], "stand-ins": { "my-lock": "my-lock" } }));
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-lock", storytree: { interface: 1, runHolds: [{ from: "./holds", export: "runHolds" }] }, exports: { "./holds": "./holds.cjs" } }));
  writeFileSync(path.join(plugin, "holds.cjs"), `const { appendFileSync } = require("node:fs"); const log = ${JSON.stringify(events)};
exports.runHolds = [{ name: "my lock", take: async ({ what }) => (appendFileSync(log, "take for " + what + "\\n"), () => appendFileSync(log, "release\\n")) }];`);
  const file = path.join(dir, "held.test.mjs");
  writeFileSync(file, `import { appendFileSync } from "node:fs"; import { test } from "node:test";
test("runs under the hold", () => appendFileSync(${JSON.stringify(events)}, "test\\n"));`);
  const env = { ...process.env, STORYTREE_HOME: home, STORYTREE_TEST_PG_URL: "postgres://unused" };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER;
  const run = (...args) => spawnSync(process.execPath, ["--import", "tsx", "packages/repo-checks/src/test.mjs", ...args], { cwd: root, env, encoding: "utf8" });

  const asked = run("--help");
  assert.equal(asked.status, 0, asked.stderr);
  const ran = run(file);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(readFileSync(events, "utf8"), "take for pnpm test\ntest\nrelease\n", "taken once, by the run and not by asking its usage, around its tests");
});
