// increment_333dd2946299: the base runner names no file of storytree's own, so storytree's `pnpm test` hands it its lists.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify, planRun, readWorkspace } from "@storytree/base-dev-loop/test-scope";
import { removeTemp } from "@storytree/test-waits";

import { ALWAYS_RUN } from "./test.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("13.5 storytree's pnpm test carries its package-boundary and allocation checks in every scoped run, and runs its browser proofs alone", (t) => {
  const workspace = readWorkspace(root);
  const { units } = planRun({ root, workspace, decision: classify(["packages/mark/src/x.ts"], workspace), alwaysRun: ALWAYS_RUN });
  for (const check of ["packages/dev-loop/src/package-boundaries.test.mjs", "packages/dev-loop/src/allocation.test.mjs"]) assert.ok(units.includes(check), `${check}: ${units.join(", ")}`);

  const home = mkdtempSync(path.join(tmpdir(), "test-lists-"));
  t.after(() => removeTemp(home));
  const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", "--only=forest", "--scope"], { cwd: root, env: { ...process.env, STORYTREE_HOME: home }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^units: packages\/forest, packages\/forest\/src\/view\/desktop-renderer-smoke\.test\.ts$/m, run.stdout);
});
