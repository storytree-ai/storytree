/** Capability 3 · Arm repositories: no repository is made; a fake `gh` records each call, and the seed it is handed is read as it stands. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { archiveArmRepositories, ARM_WORKFLOW_PATH, armWorkflow, makeArmRepository, type ArmCi, type Gh } from "./index.js";

const CI: ArmCi = { checks: "npm test", verifier: { testsRepository: "storytree-ai/x-twin-build-tests", command: "bash .hidden-tests/run.sh" } };

interface Job { readonly "runs-on": string; readonly if?: string; readonly environment?: string; readonly steps: readonly { readonly uses?: string; readonly with?: Record<string, string>; readonly env?: Record<string, string>; readonly run?: string }[] }

test("3.1 · an arm's CI runs on Linux only: its own checks gate every pull request and merge-queue entry, and the task's hidden tests run only on each merge to main, fetched with a secret, reporting counts alone", async () => {
  const workflow = armWorkflow(CI) as { on: Record<string, unknown>; jobs: Record<string, Job> };
  assert.deepEqual(Object.keys(workflow.on).sort(), ["merge_group", "pull_request", "push"]);
  for (const [name, job] of Object.entries(workflow.jobs)) assert.equal(job["runs-on"], "ubuntu-latest", `${name} runs on Linux`);

  const verify = workflow.jobs.verify!;
  assert.equal(verify.if, "github.event_name != 'push'", "verify runs on pull requests and queue entries");
  assert.ok(verify.steps.some((step) => step.run === CI.checks), "verify runs the arm's checks");

  const hidden = workflow.jobs["hidden-tests"]!;
  assert.equal(hidden.if, "github.event_name == 'push'", "the hidden tests run only on a merge to main");
  assert.equal(hidden.environment, "hidden-tests", "their token is the main-only environment's");
  const fetch = hidden.steps.find((step) => step.with?.repository === CI.verifier.testsRepository);
  assert.equal(fetch?.with?.token, "${{ secrets.EXPERIMENT_TESTS_TOKEN }}");

  // The verifier step itself, run here: whatever the tests print stays out of the log; only the counts reach it.
  const run = hidden.steps.at(-1)!;
  await withTempDir((dir) => {
    const result = path.join(dir, "result.json");
    const summary = path.join(dir, "summary.md");
    const verifier = path.join(dir, "verifier.cjs");
    writeFileSync(verifier, `console.log("ok - renders the secret page"); require("fs").writeFileSync(process.env.VERIFIER_RESULT, JSON.stringify({ passed: 41, total: 370 }));`);
    const env: NodeJS.ProcessEnv = { ...process.env, ...run.env, VERIFIER_COMMAND: `node "${verifier}"`, VERIFIER_RESULT: result, GITHUB_STEP_SUMMARY: summary };
    const log = execFileSync(process.execPath, ["-e", env.REPORT_COUNTS!], { env, encoding: "utf8" });
    assert.equal(log.trim(), "passed=41 total=370");
    assert.equal(readFileSync(summary, "utf8").trim(), "passed=41 total=370");

    writeFileSync(verifier, `console.log("ok - renders the secret page");`);
    assert.throws(() => execFileSync(process.execPath, ["-e", env.REPORT_COUNTS!], { env: { ...env, VERIFIER_RESULT: path.join(dir, "none.json") }, encoding: "utf8", stdio: "pipe" }), "no result fails the run");
  });
});

test("3.2 · making an arm's repository creates it public in storytree-ai, seeded from the starting tree with the arm's CI, sets its secrets through stdin, and turns the merge queue on for main", async () => {
  await withTempDir((dir) => {
    const startingTree = path.join(dir, "start");
    mkdirSync(path.join(startingTree, "src"), { recursive: true });
    writeFileSync(path.join(startingTree, "package.json"), "{}");
    writeFileSync(path.join(startingTree, "src", "index.ts"), "export {};");

    const calls: { args: readonly string[]; input?: string | undefined }[] = [];
    let seeded: { files: string[]; commits: string } | undefined;
    const gh: Gh = (args, input) => {
      calls.push({ args, input });
      if (args[0] === "repo" && args[1] === "create") {
        const seed = args[args.indexOf("--source") + 1]!;
        seeded = {
          files: execFileSync("git", ["ls-files"], { cwd: seed, encoding: "utf8" }).trim().split("\n").sort(),
          commits: execFileSync("git", ["rev-list", "--count", "main"], { cwd: seed, encoding: "utf8" }).trim(),
        };
        assert.deepEqual(JSON.parse(readFileSync(path.join(seed, ARM_WORKFLOW_PATH), "utf8")), armWorkflow(CI), "the seed carries the arm's CI");
      }
      return "";
    };

    const secrets = { testsToken: "github_pat_tests_value", mergeQueueToken: "github_pat_queue_value" };
    const repository = makeArmRepository({ experiment: "twin-build", arm: "map-reads-off", startingTree, ci: CI, secrets }, gh);
    assert.equal(repository, "storytree-ai/x-twin-build-map-reads-off");

    const create = calls.find((call) => call.args[0] === "repo" && call.args[1] === "create")!;
    assert.equal(create.args[2], repository);
    assert.ok(create.args.includes("--public") && create.args.includes("--push"));
    assert.deepEqual(seeded, { files: [ARM_WORKFLOW_PATH, "package.json", "src/index.ts"], commits: "1" });
    assert.deepEqual(readdirSync(startingTree).sort(), ["package.json", "src"], "the starting tree is left as it was");

    for (const value of Object.values(secrets)) {
      assert.ok(calls.every((call) => !call.args.some((arg) => arg.includes(value))), "no secret is an argument");
    }
    const secret = (name: string) => calls.find((call) => call.args[0] === "secret" && call.args[2] === name);
    assert.equal(secret("EXPERIMENT_TESTS_TOKEN")?.input, secrets.testsToken);
    assert.ok(secret("EXPERIMENT_TESTS_TOKEN")!.args.includes("hidden-tests"), "the tests' token belongs to the main-only environment");
    assert.equal(secret("MERGE_QUEUE_TOKEN")?.input, secrets.mergeQueueToken);
    const policy = calls.find((call) => call.args.some((arg) => arg.endsWith("/environments/hidden-tests/deployment-branch-policies")));
    assert.deepEqual(JSON.parse(policy!.input!), { name: "main", type: "branch" });

    const ruleset = calls.find((call) => call.args.includes(`repos/${repository}/rulesets`));
    const rules = (JSON.parse(ruleset!.input!) as { rules: { type: string; parameters: { required_status_checks?: { context: string }[] } }[] }).rules;
    assert.ok(rules.some((rule) => rule.type === "merge_queue"), "main is behind the merge queue");
    assert.deepEqual(rules.find((rule) => rule.type === "required_status_checks")?.parameters.required_status_checks, [{ context: "verify" }]);
    assert.ok(calls.indexOf(create) < calls.indexOf(ruleset!), "the seed is pushed before main is protected");

    const before = calls.length;
    assert.throws(() => makeArmRepository({ experiment: "Twin Build", arm: "map-reads-off", startingTree, ci: CI, secrets }, gh), /Twin Build/);
    assert.equal(calls.length, before, "a malformed name makes nothing");
    assert.ok(!existsSync(path.join(startingTree, ".git")));
  });
});

test("3.3 · ending an experiment archives each of its arms' repositories", () => {
  const calls: (readonly string[])[] = [];
  const archived = archiveArmRepositories("twin-build", ["map-reads-on", "map-reads-off"], (args) => (calls.push(args), ""));
  assert.deepEqual(archived, ["storytree-ai/x-twin-build-map-reads-on", "storytree-ai/x-twin-build-map-reads-off"]);
  assert.deepEqual(calls, archived.map((repository) => ["repo", "archive", repository, "--yes"]));
});
