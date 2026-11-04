// Capability 8 · Storytree's own test and gate entries. increment_784959651b47 (friction_6f3521cbc465): the root
// typecheck script runs every package's typecheck, and a session that runs it quietly (`pnpm -s typecheck`) still
// sees the failing package's errors, not only pnpm's one-line summary.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

const checkout = fileURLToPath(new URL("../../..", import.meta.url));

test("8.7 pnpm -s typecheck prints a failing package's type errors and exits nonzero", (t) => {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm !== undefined, "run these tests through pnpm (pnpm test), which names itself in npm_execpath");
  const root = mkdtempSync(path.join(tmpdir(), "storytree-8-7-"));
  t.after(() => removeTemp(root));
  // A workspace with this checkout's typecheck script and settings: one package passes its typecheck, and one fails it
  // as tsc does (with one package alone, pnpm streams its output whatever the reporter).
  const { packageManager, scripts } = JSON.parse(readFileSync(path.join(checkout, "package.json"), "utf8"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", private: true, packageManager, scripts: { typecheck: scripts.typecheck } }));
  writeFileSync(path.join(root, ".npmrc"), readFileSync(path.join(checkout, ".npmrc")));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  for (const [name, check] of [["sound", "process.exit(0);\n"], ["broken", "console.log(\"src/broken.ts(1,14): error TS2322: probe-8-7\");\nprocess.exit(2);\n"]]) {
    const folder = path.join(root, "packages", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, private: true, scripts: { typecheck: "node check.mjs" } }));
    writeFileSync(path.join(folder, "check.mjs"), check);
  }
  assert.equal(spawnSync(process.execPath, [pnpm, "install"], { cwd: root, encoding: "utf8", timeout: 60_000 }).status, 0);

  const ran = spawnSync(process.execPath, [pnpm, "-s", "typecheck"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.notEqual(ran.status, 0);
  assert.match(`${ran.stdout}${ran.stderr}`, /src\/broken\.ts\(1,14\): error TS2322: probe-8-7/);
});
