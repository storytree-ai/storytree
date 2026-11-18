// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

const checkout = fileURLToPath(new URL("../../..", import.meta.url));

function probe(root) {
  const { packageManager, scripts } = JSON.parse(readFileSync(path.join(checkout, "package.json"), "utf8"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", private: true, packageManager, scripts: { typecheck: scripts.typecheck } }));
  writeFileSync(path.join(root, ".npmrc"), readFileSync(path.join(checkout, ".npmrc")));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const provisioner = path.join(root, "packages", "base-dev-loop", "src");
  mkdirSync(provisioner, { recursive: true });
  for (const file of ["provision-worktree.mjs", "node-runtime.mjs"]) {
    cpSync(path.join(checkout, "packages", "base-dev-loop", "src", file), path.join(provisioner, file));
  }
}

test("8.7 pnpm -s typecheck prints a failing package's type errors and exits nonzero", (t) => {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm !== undefined, "run these tests through pnpm (pnpm test), which names itself in npm_execpath");
  const root = mkdtempSync(path.join(tmpdir(), "storytree-8-7-"));
  t.after(() => removeTemp(root));
  probe(root);
  for (const [name, check] of [["sound", "process.exit(0);\n"], ["broken", "console.log(\"src/broken.ts(1,14): error TS2322: probe-8-7\");\nprocess.exit(2);\n"]]) {
    const folder = path.join(root, "packages", name);
    mkdirSync(folder, { recursive: true });
    const dependencies = name === "broken" ? { sound: "workspace:*" } : {};
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, private: true, dependencies, scripts: { typecheck: "node check.mjs" } }));
    writeFileSync(path.join(folder, "check.mjs"), check);
  }
  assert.equal(spawnSync(process.execPath, [pnpm, "install"], { cwd: root, encoding: "utf8", timeout: 60_000 }).status, 0);

  const ran = spawnSync(process.execPath, [pnpm, "-s", "typecheck"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.notEqual(ran.status, 0);
  assert.match(`${ran.stdout}${ran.stderr}`, /src\/broken\.ts\(1,14\): error TS2322: probe-8-7/);
});

test("8.8 pnpm typecheck in a fresh worktree installs it before typechecking, as pnpm test does", (t) => {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm !== undefined, "run these tests through pnpm (pnpm test), which names itself in npm_execpath");
  const root = mkdtempSync(path.join(tmpdir(), "storytree-8-8-"));
  t.after(() => removeTemp(root));
  probe(root);
  for (const [name, manifest] of [
    ["dep", { name: "dep", private: true, type: "module", exports: "./index.mjs" }],
    ["checked", { name: "checked", private: true, type: "module", dependencies: { dep: "workspace:*" }, scripts: { typecheck: "node check.mjs" } }],
  ]) {
    const folder = path.join(root, "packages", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "package.json"), JSON.stringify(manifest));
  }
  writeFileSync(path.join(root, "packages", "dep", "index.mjs"), "export default 1;\n");
  writeFileSync(path.join(root, "packages", "checked", "check.mjs"), "import dep from \"dep\";\nprocess.exit(dep === 1 ? 0 : 2);\n");
  assert.equal(spawnSync(process.execPath, [pnpm, "install"], { cwd: root, encoding: "utf8", timeout: 60_000 }).status, 0);
  for (const dir of [root, path.join(root, "packages", "dep"), path.join(root, "packages", "checked")]) {
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  }

  const ran = spawnSync(process.execPath, [pnpm, "-s", "typecheck"], { cwd: root, encoding: "utf8", timeout: 120_000 });
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(existsSync(path.join(root, "packages", "checked", "node_modules", "dep")), "the workspace was installed");
});
