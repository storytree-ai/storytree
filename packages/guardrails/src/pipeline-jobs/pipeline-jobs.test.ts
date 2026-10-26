/**
 * Capability 3 · The check command: what the `storytree check` job Guardrails contributes to a user's pipeline
 * installs, and the commit it fetches. The job fetches storytree's source and installs from its lockfile, so what it takes is what this
 * checkout's packages declare; the test asks pnpm for the same selection here, with no network.
 */
import assert from "node:assert/strict";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { pipelineJobs } from "./pipeline-jobs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

type Listed = { name?: string; dependencies?: Record<string, Listed> };

test("3.9 · the storytree check job Guardrails contributes installs only what the check runs on, runs no install script, so a download it never uses cannot fail it, and asks for the checkout's history", () => {
  const [job] = pipelineJobs;
  assert.equal(job?.name, "storytree check");
  assert.equal(job.needsHistory, true, "the self-equal assertion check compares the change with origin/main");
  const install = job.commands("main", "$GITHUB_WORKSPACE").find((line) => line.startsWith("pnpm install"));
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

const posix = { skip: process.platform === "win32" ? "platform:posix: the job runs in bash on GitHub's Linux runners" : false };

test("3.10 · the storytree check job fetches storytree's source at exactly the commit it is given, and stops before installing when what it checked out is any other commit", posix, (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "storytree-job-"));
  t.after(() => removeTemp(temp));
  const source = path.join(temp, "source");
  const git = (...args: string[]): string => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "--quiet", source]);
  git("config", "uploadpack.allowAnySHA1InWant", "true");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "--allow-empty", "-m", "older");
  const older = git("rev-parse", "HEAD");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "--allow-empty", "-m", "newer");
  const newer = git("rev-parse", "HEAD");

  // storytree's GitHub address answered by the local source, so the job's own lines run with no network.
  const env = { ...process.env, RUNNER_TEMP: temp, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${pathToFileURL(source).href}.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/storytree-ai/storytree.git" };
  const [job] = pipelineJobs;
  const lines = (ref: string): string[] => {
    const all = [...job!.commands(ref, "$GITHUB_WORKSPACE")];
    return all.slice(0, all.indexOf("corepack enable"));
  };
  const run = (script: string[], cwd = temp) => spawnSync("bash", ["-e", "-c", script.join("\n")], { cwd, env, encoding: "utf8" });

  const fetched = run(lines(older));
  assert.equal(fetched.status, 0, fetched.stderr);
  const checkout = path.join(temp, "storytree");
  assert.equal(execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), older, "it checks out the commit given, not the newest");

  const verifying = (ref: string): string[] => {
    const before = lines(ref);
    return before.slice(before.findIndex((line) => line.includes("FETCH_HEAD")) + 1);
  };
  const matched = run(verifying(older), checkout);
  assert.equal(matched.status, 0, `the check passes in this checkout at the commit given: ${matched.stderr}`);
  const mismatched = run(verifying(newer), checkout);
  assert.notEqual(mismatched.status, 0, "the same check, given any other commit, stops the job");
});
