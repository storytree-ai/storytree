/**
 * Capability 8 · Harbor task adapter: no repository is made; a fake `gh` records each call and reads each seed as it
 * stands, a fake `docker` stands in for the task image, and an arm's library is a real one on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolveKey, saveKey } from "@storytree/keys";
import { connect } from "@storytree/library";
import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { EXPERIMENT_FAMILIES } from "../record/verbs.js";
import { armWorkflow, type Gh } from "../repositories.js";
import { armWorkspace, makeArm } from "../workspaces.js";
import { testAdminUrl, withAdmin } from "../testing/pg.js";
import { COUNTS_SCRIPT, COUNTS_SOURCE, importHarborTask, parkInArmLibrary, readHarborTask, verifierCommand } from "./harbor.js";
import { MERGE_QUEUE_TOKEN_KEY, TASK_FAMILY, TESTS_TOKEN_KEY } from "./verbs.js";

const posix = { skip: process.platform === "win32" ? "platform:posix: the verifier runs in bash on GitHub's Linux runners" : false };

/** A Harbor task in `dir`, shaped as SWE-Marathon's are. */
function writeTask(dir: string): string {
  const task = path.join(dir, "task");
  mkdirSync(path.join(task, "environment", "apps"), { recursive: true });
  mkdirSync(path.join(task, "tests"), { recursive: true });
  writeFileSync(path.join(task, "task.toml"), [
    `# harbor-canary`, `version = "1.0"`, ``, `[task]`, `name = "abundant/nextjs-vite-rewrite"`, ``,
    `[metadata]`, `tags = ["nextjs", "vite"]`, `expert_time_estimate_hours = 400`, ``,
    `[verifier]`, `network_mode = "no-network"`, `timeout_sec = 3600.0`, ``, `[verifier.env]`, `NPM_CONFIG_OFFLINE = "true"`, ``,
    `[agent]`, `network_mode = "allowlist"`,
  ].join("\n"));
  writeFileSync(path.join(task, "instruction.md"), "Implement a Vite replacement for Next.js.\n");
  writeFileSync(path.join(task, "environment", "Dockerfile"), "FROM node:22-bookworm\n");
  writeFileSync(path.join(task, "environment", "apps", "page.tsx"), "export default 1;\n");
  writeFileSync(path.join(task, "tests", "test.sh"), "echo hidden\n");
  return task;
}

/** The files under `dir`, relative and sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => !file.split(path.sep).includes(".git") && statSync(path.join(dir, file)).isFile())
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

/** An arm's home as `experiment arm make` leaves it, as far as the import reads it. */
function writeArmHome(home: string, experiment: string, arm: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ experiment: { name: experiment, arm } }));
}

test("8.1 · a Harbor task is read from its folder: its name, instruction, image and tests, and its verifier's time limit, network rule and environment; a folder that is not one is refused, naming what it lacks", async () => {
  await withTempDir((dir) => {
    const task = readHarborTask(writeTask(dir));
    assert.equal(task.name, "abundant/nextjs-vite-rewrite");
    assert.equal(task.instruction, "Implement a Vite replacement for Next.js.\n");
    assert.deepEqual(task.verifier, { timeoutSec: 3600, network: false, env: { NPM_CONFIG_OFFLINE: "true" } });

    mkdirSync(path.join(dir, "bare"));
    writeFileSync(path.join(dir, "bare", "instruction.md"), "x");
    assert.throws(() => readHarborTask(path.join(dir, "bare")), /not a Harbor task: it has no task\.toml, environment\/Dockerfile, tests\/test\.sh/);
  });
});

test("8.2 · the verifier counts what a Harbor verifier left: a CTRF report's tests, a metrics file's passed and total, or a reward as one test; nothing left is a failure", async () => {
  await withTempDir((dir) => {
    const script = path.join(dir, COUNTS_SCRIPT);
    writeFileSync(script, COUNTS_SOURCE);
    const count = (files: Record<string, string>): string => {
      const logs = path.join(dir, `logs-${Math.random().toString(16).slice(2)}`);
      mkdirSync(logs);
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(logs, name), text);
      return execFileSync(process.execPath, [script, logs], { encoding: "utf8", stdio: "pipe" }).trim();
    };
    assert.deepEqual(JSON.parse(count({ "ctrf.json": JSON.stringify({ results: { summary: { tests: 370, passed: 41, failed: 329 } } }), "reward.txt": "0" })), { passed: 41, total: 370 });
    assert.deepEqual(JSON.parse(count({ "metrics.json": JSON.stringify({ reward: 0, new_passed: 30, new_total: 335, regression_passed: 2, regression_total: 38 }) })), { passed: 32, total: 373 });
    assert.deepEqual(JSON.parse(count({ "reward.txt": "1\n" })), { passed: 1, total: 1 });
    assert.deepEqual(JSON.parse(count({ "reward.json": JSON.stringify({ reward: 0.4 }) })), { passed: 0, total: 1 });
    assert.throws(() => count({}), "no result fails the count");
  });
});

test("8.3 · the verifier command builds the task image from the hidden tests repository, runs its tests against the merged tree under the task's time limit, network rule and environment, and writes the counts where the arm's CI reads them", posix, async () => {
  await withTempDir((dir) => {
    const task = readHarborTask(writeTask(dir));
    const hidden = path.join(dir, "hidden");
    mkdirSync(hidden);
    writeFileSync(path.join(hidden, COUNTS_SCRIPT), COUNTS_SOURCE);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const calls = path.join(dir, "calls.log");
    // `timeout` notes its limit and runs the rest; `docker run` leaves the results a task's test.sh would, in its /logs mount.
    writeFileSync(path.join(bin, "timeout"), `#!/bin/sh\necho "timeout $1" >> "${calls}"\nshift\nexec "$@"\n`);
    writeFileSync(path.join(bin, "docker"), [
      `#!/usr/bin/env node`,
      `const fs = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      `fs.appendFileSync(${JSON.stringify(calls)}, "docker " + JSON.stringify(args) + "\\n");`,
      `if (args[0] === "run") {`,
      `  const logs = args[args.findIndex((arg, i) => args[i - 1] === "-v" && arg.endsWith(":/logs"))].slice(0, -":/logs".length);`,
      `  fs.writeFileSync(logs + "/verifier/metrics.json", JSON.stringify({ new_passed: 3, new_total: 5, regression_passed: 2, regression_total: 2 }));`,
      `}`,
    ].join("\n"));
    for (const name of ["timeout", "docker"]) chmodSync(path.join(bin, name), 0o755);

    const workspace = path.join(dir, "workspace");
    const result = path.join(dir, "result.json");
    execFileSync("bash", ["-c", verifierCommand(task)], {
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_WORKSPACE: workspace, HIDDEN_TESTS: hidden, RUNNER_TEMP: dir, VERIFIER_RESULT: result },
      stdio: "pipe",
    });
    assert.deepEqual(JSON.parse(readFileSync(result, "utf8")), { passed: 5, total: 7 });

    const [build, limit, run] = readFileSync(calls, "utf8").trim().split("\n");
    assert.deepEqual(JSON.parse(build!.slice("docker ".length)), ["build", "-q", "-t", "storytree-harbor-task", path.join(hidden, "environment")]);
    assert.equal(limit, "timeout 3600s");
    const args = JSON.parse(run!.slice("docker ".length)) as string[];
    assert.deepEqual(args.slice(0, 2), ["run", "--rm"]);
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.equal(args[args.indexOf("-e") + 1], "NPM_CONFIG_OFFLINE=true");
    for (const mount of [`${workspace}:/app`, `${hidden}/tests:/tests:ro`, `${dir}/harbor-logs:/logs`]) assert.ok(args.includes(mount), `mounts ${mount}`);
    assert.deepEqual(args.slice(-3), ["storytree-harbor-task", "bash", "/tests/test.sh"]);
  });
});

test("8.4 · importing a task puts its image and tests in a private tests repository alone, seeds each arm's public repository from the starting tree with a .storytree.json naming its project and the verifier in its CI, and parks the instruction in each arm's library; a missing arm home refuses it before anything is made", async () => {
  await withTempDir(async (dir) => {
    const task = writeTask(dir);
    const homes = { "map-reads-on": path.join(dir, "on"), "map-reads-off": path.join(dir, "off") };
    writeArmHome(homes["map-reads-on"], "twin", "map-reads-on");

    const created: { repository: string; visibility: string; files: string[]; read: (file: string) => string }[] = [];
    const calls: (readonly string[])[] = [];
    const gh: Gh = (args) => {
      calls.push(args);
      if (args[0] === "repo" && args[1] === "create") {
        const seed = args[args.indexOf("--source") + 1]!;
        const texts = Object.fromEntries(filesUnder(seed).map((file) => [file, readFileSync(path.join(seed, file), "utf8")]));
        created.push({ repository: args[2]!, visibility: args[3]!, files: Object.keys(texts), read: (file) => texts[file]! });
      }
      return "";
    };
    const parked: { home: string; project: string; intent: string }[] = [];
    const park = async (home: string, project: string, arc: { intent: string }) => {
      parked.push({ home, project, intent: arc.intent });
      return `arc_${parked.length}`;
    };
    const secrets = { testsToken: "tests-token", mergeQueueToken: "queue-token" };
    const arms = Object.entries(homes).map(([arm, home]) => ({ arm, home }));

    await assert.rejects(importHarborTask({ task, experiment: "twin", arms, secrets }, { gh, park }), /off is not the home of arm "map-reads-off".*Nothing was made/);
    assert.deepEqual([calls, parked], [[], []]);

    writeArmHome(homes["map-reads-off"], "twin", "map-reads-off");
    const imported = await importHarborTask({ task, experiment: "twin", arms, secrets }, { gh, park });

    const [tests, ...armRepositories] = created;
    assert.deepEqual([tests!.repository, tests!.visibility], ["storytree-ai/x-twin-tests", "--private"]);
    assert.deepEqual(tests!.files, ["counts.mjs", "environment/Dockerfile", "environment/apps/page.tsx", "tests/test.sh"]);
    assert.deepEqual(armRepositories.map((made) => [made.repository, made.visibility]), [["storytree-ai/x-twin-map-reads-on", "--public"], ["storytree-ai/x-twin-map-reads-off", "--public"]]);
    for (const made of armRepositories) {
      assert.deepEqual(made.files, [".github/workflows/arm.yml", ".storytree.json", "apps/page.tsx"], "the starting tree, its project and its CI; never the tests or the image");
      assert.deepEqual(JSON.parse(made.read(".storytree.json")), { project: made.repository.slice("storytree-ai/".length) });
      const workflow = JSON.parse(made.read(".github/workflows/arm.yml")) as ReturnType<typeof armWorkflow> & { jobs: Record<string, { steps: { with?: Record<string, string>; env?: Record<string, string> }[] }> };
      const hidden = workflow.jobs["hidden-tests"]!.steps;
      assert.ok(hidden.some((step) => step.with?.repository === "storytree-ai/x-twin-tests"), "the verifier fetches the tests repository");
      assert.match(hidden.at(-1)!.env!.VERIFIER_COMMAND!, /--network none .*bash \/tests\/test\.sh/);
    }
    assert.deepEqual(parked, [
      { home: path.resolve(homes["map-reads-on"]), project: "x-twin-map-reads-on", intent: "Implement a Vite replacement for Next.js.\n" },
      { home: path.resolve(homes["map-reads-off"]), project: "x-twin-map-reads-off", intent: "Implement a Vite replacement for Next.js.\n" },
    ]);
    assert.deepEqual(imported, {
      task: "abundant/nextjs-vite-rewrite",
      testsRepository: "storytree-ai/x-twin-tests",
      arms: [{ arm: "map-reads-on", repository: "storytree-ai/x-twin-map-reads-on", arc: "arc_1" }, { arm: "map-reads-off", repository: "storytree-ai/x-twin-map-reads-off", arc: "arc_2" }],
    });
  });
});

test("8.5 · the instruction is parked as the one arc in the arm's own throwaway library, opened through the arm's home; a library that has an arc already refuses another", async () => {
  const experiment = `t-${Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, "0")}`;
  const { database, role } = armWorkspace(experiment, "map-reads-on", "unused");
  const server = new URL(testAdminUrl());
  server.password = "";
  try {
    await withTempDir(async (dir) => {
      const made = await withAdmin((admin) => makeArm(admin, server.href, experiment, "map-reads-on", path.join(dir, "home")));
      const arc = { title: "Harbor task abundant/nextjs-vite-rewrite", intent: "Implement a Vite replacement for Next.js.\n", endState: "Every hidden test passes on main." };
      const id = await parkInArmLibrary(made.home, made.project, arc);
      const signedIn = new URL(made.address);
      signedIn.password = resolveKey("postgres", { home: made.home, env: {} })!;
      const storytree = await connect({ url: signedIn.href });
      try {
        const library = await storytree.openProject(made.project);
        try {
          const views = await library.arcViews();
          assert.deepEqual(views.map((view) => [view.arc.id, view.arc.fields.title, view.arc.fields.intent]), [[id, arc.title, arc.intent]]);
        } finally {
          await library.close();
        }
      } finally {
        await storytree.close();
      }
      await assert.rejects(parkInArmLibrary(made.home, made.project, arc), /has an arc already/);
    });
  } finally {
    await withAdmin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS "${role}"`);
    });
  }
});

test("8.6 · Experiments declares `experiment task import`, which reads the two tokens CI holds as saved keys and is refused, naming each unsaved key and making nothing, until both are saved; with no arms named it imports into the arms made for the experiment", async () => {
  const [family] = EXPERIMENT_FAMILIES;
  assert.ok(family!.families!.includes(TASK_FAMILY));
  const [taskImport] = TASK_FAMILY.verbs;
  assert.deepEqual([TASK_FAMILY.name, (taskImport!.command as { name: string }).name], ["task", "import"]);

  const saved = { STORYTREE_HOME: process.env.STORYTREE_HOME, EXPERIMENT_TESTS_TOKEN: process.env.EXPERIMENT_TESTS_TOKEN, EXPERIMENT_MERGE_QUEUE_TOKEN: process.env.EXPERIMENT_MERGE_QUEUE_TOKEN };
  await withTempDir(async (home) => {
    process.env.STORYTREE_HOME = home;
    delete process.env.EXPERIMENT_TESTS_TOKEN;
    delete process.env.EXPERIMENT_MERGE_QUEUE_TOKEN;
    try {
      const inputs = { task: writeTask(home), experiment: "twin", arms: undefined, checks: undefined, "starting-tree": undefined, workdir: undefined };
      const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
      await assert.rejects(taskImport!.act(inputs, { folder: home }, words), (error: unknown) =>
        error instanceof VerbRefusal && error.message.includes(`neither is saved`) && error.message.includes(`storytree auth set ${TESTS_TOKEN_KEY}`) && error.message.includes(`storytree auth set ${MERGE_QUEUE_TOKEN_KEY}`));
      saveKey(TESTS_TOKEN_KEY, "tests-token", { home });
      await assert.rejects(taskImport!.act(inputs, { folder: home }, words), (error: unknown) =>
        error instanceof VerbRefusal && error.message.includes("one is not saved") && !error.message.includes(`auth set ${TESTS_TOKEN_KEY}`));

      saveKey(MERGE_QUEUE_TOKEN_KEY, "merge-queue-token", { home });
      await assert.rejects(taskImport!.act(inputs, { folder: home }, words), (error: unknown) =>
        error instanceof VerbRefusal && /at least one arm/.test(error.message), "no --arms and no arm made for the experiment: nothing to import into");
      writeArmHome(path.join(home, "experiments", "x-twin-alien"), "other", "alien");
      writeArmHome(path.join(home, "experiments", "x-twin-misnamed"), "twin", "map-reads-on");
      await assert.rejects(taskImport!.act(inputs, { folder: home }, words), (error: unknown) =>
        error instanceof VerbRefusal && /not the home of arm "misnamed" of experiment "twin"/.test(error.message),
        "with no --arms, the arms are the homes made for the experiment (another experiment's skipped), each checked before anything is made");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
