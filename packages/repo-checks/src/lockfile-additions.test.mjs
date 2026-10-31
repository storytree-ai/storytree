import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { reportLockfileAdditions } from "./lockfile-additions.mjs";

const lock = (...keys) => ["lockfileVersion: '9.0'", "", "importers:", "", "  .:", "    devDependencies:", "      tsx:", "        specifier: ^4", "", "packages:", "", ...keys.flatMap((key) => [`  ${key}:`, "    resolution: {integrity: sha512-x}", ""]), "snapshots:", "", "  ignored@9.9.9: {}", ""].join("\n");
const workspace = (...built) => ["packages:", '  - "packages/*"', "onlyBuiltDependencies:", ...built.map((name) => `  - ${name}`), "ignoredBuiltDependencies:", "  - protobufjs", ""].join("\n");

test("3.1 · CI's lockfile report lists each external package a branch adds to pnpm-lock.yaml, saying whether its name is new, and each dependency newly allowed to run its install script, against origin/main", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "lockfile-additions-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  writeFileSync(path.join(root, "pnpm-lock.yaml"), lock("tsx@4.20.0", "'@types/node@24.1.0'"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), workspace('"esbuild"'));
  git("add", ".");
  git("commit", "-q", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const lines = [];
  const summary = path.join(root, "summary.md");
  const report = () => reportLockfileAdditions({ root, summary, log: (line) => lines.push(line) });

  await report();
  assert.match(lines.join("\n"), /adds no external package and allows no new install script/);

  writeFileSync(path.join(root, "pnpm-lock.yaml"), lock("tsx@4.20.0", "tsx@4.21.0", "'@types/node@24.1.0'", "'@scope/left-pad@1.0.0'"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), workspace('"esbuild"', "koffi"));
  git("commit", "-qam", "branch");
  lines.length = 0;
  writeFileSync(summary, "");
  await report();
  const text = lines.join("\n");
  assert.match(text, /2 external packages added to pnpm-lock\.yaml/);
  assert.match(text, /@scope\/left-pad@1\.0\.0 \(new package\)/);
  assert.match(text, /tsx@4\.21\.0 \(another version of tsx\)/);
  assert.doesNotMatch(text, /tsx@4\.20\.0|@types\/node|ignored/, "a package main already has, or a snapshot, is not an addition");
  assert.match(text, /newly allowed to run their install scripts: koffi/);
  assert.doesNotMatch(text, /esbuild|protobufjs/);
  assert.equal(readFileSync(summary, "utf8").trim(), text.trim(), "the report is also the run's summary");
});
