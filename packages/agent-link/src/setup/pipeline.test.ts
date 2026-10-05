/**
 * Capability 11 · Pipeline wiring: what the workflow's storytree check step installs. The step clones
 * storytree's source and installs from its lockfile, so what it takes is what this checkout's packages
 * declare; the test asks pnpm for the same selection here, with no network.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkCommands } from "./pipeline.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

type Listed = { name?: string; dependencies?: Record<string, Listed> };

test("11.4 the storytree check step installs only what the check runs on, and runs no install script, so a download it never uses cannot fail it", () => {
  const install = checkCommands("main", "$GITHUB_WORKSPACE").find((line) => line.startsWith("pnpm install"));
  assert.ok(install !== undefined);
  assert.match(install, / --prod\b/, install);
  assert.match(install, / --ignore-scripts\b/, install);
  const filter = /--filter-prod ("[^"]+")/.exec(install)?.[1];
  assert.ok(filter !== undefined, install);

  const listed = JSON.parse(execSync(`pnpm list --prod --depth Infinity --json --filter-prod ${filter}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Listed[];
  const taken = new Set<string>();
  const walk = (dependencies: Record<string, Listed> | undefined): void => {
    for (const [name, listing] of Object.entries(dependencies ?? {})) {
      if (taken.has(name)) continue;
      taken.add(name);
      walk(listing.dependencies);
    }
  };
  for (const project of listed) walk(project.dependencies);

  for (const needed of ["@storytree/map", "@babel/parser", "tsx"]) assert.ok(taken.has(needed), `the check runs on ${needed}`);
  for (const unused of ["onnxruntime-node", "@storytree/library"]) assert.equal(taken.has(unused), false, `the check never uses ${unused}`);
});
