// What `pnpm test` runs by default (test-scope.mjs, ADR-0649 D4): only the packages a
// branch's changes can reach. The changes are the branch against where it left main
// (merge-base(origin/main, HEAD)) plus the working tree, untracked files included. Each changed file
// maps to the workspace package that holds it, and every package that depends on one of those is
// added, by a declared dependency or by a path in its code that reaches into the other package. Any
// file the workspace graph cannot account for runs everything: root files, any package.json, the
// lockfile, a file in no package, a package the test harness itself runs on (the dev loop among them), and an
// origin/main that cannot be read. The decision is printed as one `scope:` line, CI takes the same
// one, and a run reports each package as PASS or FAIL and can rerun only the failures.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  changedFiles,
  classify,
  parseTestArgs,
  planRun,
  readWorkspace,
  resultsTable,
  scopeFor,
  scopeLine,
  unitGlobs,
} from "./test-scope.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** A workspace on disk: `packages` maps a dir to its manifest and any files it holds. */
function workspace(t, { rootDeps = {}, packages }) {
  const root = mkdtempSync(path.join(tmpdir(), "test-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "package.json", JSON.stringify({ name: "root", private: true, devDependencies: rootDeps }));
  for (const [dir, { name, deps = [], files = {} }] of Object.entries(packages)) {
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, "workspace:*"]));
    write(root, `${dir}/package.json`, JSON.stringify({ name, dependencies }));
    for (const [file, text] of Object.entries(files)) write(root, `${dir}/${file}`, text);
  }
  return root;
}

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function git(root, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

/** library <- agent-link <- cli, library <- forest, and a package the root harness runs on. */
function fixture(t) {
  return workspace(t, {
    rootDeps: { "@x/pg": "workspace:*" },
    packages: {
      "packages/library": { name: "@x/library", files: { "src/a.test.ts": "" } },
      "packages/agent-link": { name: "@x/agent-link", deps: ["@x/library"], files: { "src/b.test.ts": "" } },
      "packages/cli": { name: "@x/cli", deps: ["@x/agent-link"], files: { "src/c.test.ts": "" } },
      "packages/forest": { name: "@x/forest", deps: ["@x/library"], files: { "src/d.test.ts": "" } },
      "packages/pg": { name: "@x/pg", files: { "src/e.test.ts": "" } },
      "apps/desktop": { name: "@x/desktop", deps: ["@x/forest"], files: { "src/f.test.ts": "" } },
    },
  });
}

test("1.1 a change inside a package runs that package and every package that depends on it, and no other", (t) => {
  const ws = readWorkspace(fixture(t));
  const decision = classify(["packages/agent-link/src/x.ts"], ws);
  assert.equal(decision.mode, "affected");
  assert.deepEqual(decision.dirs, ["packages/agent-link", "packages/cli"]);

  const deeper = classify(["packages/forest/src/y.ts", "packages/cli/src/z.ts"], ws);
  assert.deepEqual(deeper.dirs, ["apps/desktop", "packages/cli", "packages/forest"], "dependents are followed all the way up");
});

test("a package whose code reaches into another by a relative path depends on it, declared or not", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/world": { name: "@x/world", files: { "src/coast.ts": "" } },
      "packages/forest": {
        name: "@x/forest",
        files: { "src/places.test.ts": 'import { coast } from "../../world/src/coast.js";\n' },
      },
      "packages/other": { name: "@x/other", files: { "src/o.ts": 'const up = "../src/o.ts";\n' } },
    },
  });
  const decision = classify(["packages/world/src/coast.ts"], readWorkspace(root));
  assert.deepEqual(decision.dirs, ["packages/forest", "packages/world"]);
});

test("the real workspace's undeclared reach is found: app-setup builds cli's bin by path", () => {
  const ws = readWorkspace(repoRoot);
  assert.ok(ws.find((p) => p.dir === "packages/app-setup").reaches.includes("packages/cli"));
  assert.ok(classify(["packages/cli/src/bins/storytree.ts"], ws).dirs.includes("packages/app-setup"));
});

test("1.2 a change in the dev loop runs everything: its runner, scoper and gate decide how every test runs (ADR-0805 D4)", () => {
  const decision = classify(["packages/dev-loop/src/gate.mjs"], readWorkspace(repoRoot));
  assert.equal(decision.mode, "full");
  assert.match(decision.reason, /@storytree\/dev-loop/);
});

test("1.2 any file the workspace graph cannot account for runs everything, and says which file", (t) => {
  const ws = readWorkspace(fixture(t));
  const wide = {
    "README.md": /README\.md/,
    "stories/library.md": /stories\/library\.md/,
    "pnpm-lock.yaml": /lockfile/,
    "pnpm-workspace.yaml": /pnpm-workspace\.yaml/,
    "package.json": /package\.json/,
    "packages/forest/package.json": /package\.json/,
    ".github/workflows/ci.yml": /ci\.yml/,
    "packages/README.md": /no workspace package/,
    "packages/gone/src/old.ts": /no workspace package/,
    "packages/pg/src/server.ts": /test harness/,
  };
  for (const [file, reason] of Object.entries(wide)) {
    const decision = classify(["packages/cli/src/z.ts", file], ws);
    assert.equal(decision.mode, "full", file);
    assert.match(decision.reason, reason, file);
  }
  assert.equal(classify([], ws).mode, "full", "no change at all runs everything rather than nothing");
});

test("the changes are the branch since it left main plus the working tree, untracked included", (t) => {
  const root = fixture(t);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "work");
  write(root, "packages/cli/src/committed.ts", "1");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "on the branch");
  // main moves on after the branch left it: what main gained is not this branch's change
  git(root, "checkout", "-q", "main");
  write(root, "packages/library/src/on-main.ts", "1");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "main moves");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "work");
  write(root, "packages/forest/src/d.test.ts", "edited, not staged");
  write(root, "apps/desktop/src/new.ts", "untracked");
  rmSync(path.join(root, "packages/pg/src/e.test.ts"));

  assert.deepEqual(changedFiles(root).sort(), [
    "apps/desktop/src/new.ts",
    "packages/cli/src/committed.ts",
    "packages/forest/src/d.test.ts",
    "packages/pg/src/e.test.ts",
  ]);
  const decision = scopeFor(root);
  assert.equal(decision.mode, "full", "the deleted file is in a package the harness runs on");
});

test("1.2 an origin/main that cannot be read runs everything, saying so", (t) => {
  const root = fixture(t);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const decision = scopeFor(root);
  assert.equal(decision.mode, "full");
  assert.match(decision.reason, /origin\/main/);
});

test("the decision prints as one scope: line naming what runs and why", (t) => {
  const ws = readWorkspace(fixture(t));
  const affected = scopeLine(classify(["packages/agent-link/src/x.ts"], ws));
  assert.match(affected, /^scope: affected /);
  assert.ok(affected.includes("packages/agent-link") && affected.includes("packages/cli"), affected);
  assert.equal(affected.split("\n").length, 1);
  const full = scopeLine(classify(["pnpm-lock.yaml"], ws));
  assert.match(full, /^scope: full /);
  assert.match(full, /pnpm-lock\.yaml/);
});

test("a run is one unit per selected package with tests", (t) => {
  const root = fixture(t);
  const ws = readWorkspace(root);
  mkdirSync(path.join(root, "packages/empty/src"), { recursive: true });
  write(root, "packages/empty/package.json", JSON.stringify({ name: "@x/empty" }));
  const all = readWorkspace(root);

  const affected = planRun({ root, workspace: ws, decision: classify(["packages/agent-link/src/x.ts"], ws) });
  assert.deepEqual(affected.units, ["packages/agent-link", "packages/cli"]);

  const full = planRun({ root, workspace: all, decision: classify(["README.md"], all) });
  assert.deepEqual(full.units, [
    "apps/desktop",
    "packages/agent-link",
    "packages/cli",
    "packages/forest",
    "packages/library",
    "packages/pg",
  ], "a package with no test files is no unit");
});

test("a package whose tests are .test.mjs files is a unit, and its unit runs them", (t) => {
  const root = fixture(t);
  write(root, "packages/loop/package.json", JSON.stringify({ name: "@x/loop" }));
  write(root, "packages/loop/src/gate.test.mjs", "");
  const ws = readWorkspace(root);

  const all = planRun({ root, workspace: ws, decision: classify(["README.md"], ws) }).units;
  assert.ok(all.includes("packages/loop"), all.join(", "));
  assert.ok(unitGlobs("packages/loop").includes("packages/loop/src/**/*.test.mjs"));
});

test("the package-boundary check runs in every scoped run, since a change inside any one package can break it", (t) => {
  const root = fixture(t);
  const ws = readWorkspace(root);
  const decision = classify(["packages/agent-link/src/x.ts"], ws);
  assert.deepEqual(planRun({ root, workspace: ws, decision }).units, ["packages/agent-link", "packages/cli"], "until the check exists");

  write(root, "packages/dev-loop/package.json", JSON.stringify({ name: "@x/dev-loop" }));
  write(root, "packages/dev-loop/src/package-boundaries.test.mjs", "");
  write(root, "packages/dev-loop/src/other.test.mjs", "");
  const withLoop = readWorkspace(root);
  assert.deepEqual(planRun({ root, workspace: withLoop, decision }).units, [
    "packages/agent-link",
    "packages/cli",
    "packages/dev-loop/src/package-boundaries.test.mjs",
  ]);
  assert.deepEqual(unitGlobs("packages/dev-loop/src/package-boundaries.test.mjs"), ["packages/dev-loop/src/package-boundaries.test.mjs"]);
  const all = planRun({ root, workspace: withLoop, decision: classify(["README.md"], withLoop) }).units;
  assert.ok(all.includes("packages/dev-loop") && !all.includes("packages/dev-loop/src/package-boundaries.test.mjs"), "a full run has it in its package already");
});

test("1.3 --full forces everything, --only names units, and --rerun-failed runs what the last run failed or never reached", (t) => {
  const root = fixture(t);
  const ws = readWorkspace(root);
  const decision = classify(["packages/agent-link/src/x.ts"], ws);

  const forced = planRun({ root, workspace: ws, decision, flags: { full: true } });
  assert.equal(forced.decision.mode, "full");
  assert.match(forced.decision.reason, /--full/);
  assert.equal(forced.units.length, 6);

  const only = planRun({ root, workspace: ws, decision, flags: { only: ["forest", "@x/cli"] } });
  assert.deepEqual(only.units, ["packages/cli", "packages/forest"]);
  assert.match(scopeLine(only.decision), /^scope: only /);
  assert.throws(() => planRun({ root, workspace: ws, decision, flags: { only: ["nope"] } }), /nope/);

  const record = { units: { "packages/cli": "fail", "packages/library": "pass", "packages/forest": "not run" } };
  const rerun = planRun({ root, workspace: ws, decision, flags: { rerunFailed: true }, record });
  assert.deepEqual(rerun.units, ["packages/cli", "packages/forest"]);
  assert.match(scopeLine(rerun.decision), /^scope: rerun-failed /);

  const nothing = planRun({ root, workspace: ws, decision, flags: { rerunFailed: true }, record: undefined });
  assert.deepEqual(nothing.units, []);
  assert.match(nothing.decision.reason, /no earlier run/);
});

test("1.3 --help prints the runner's usage, and an unknown flag is refused naming the known ones, before any lock or Postgres", (t) => {
  assert.equal(parseTestArgs(["--help"]).help, true);
  assert.equal(parseTestArgs(["-h"]).help, true);
  assert.match(parseTestArgs(["--bogus"]).refusal, /--bogus/);
  assert.match(parseTestArgs(["--bogus"]).refusal, /--full.*--scope.*--only.*--rerun-failed/s);
  const passed = parseTestArgs(["--", "--full", "--only=cli", "--test-name-pattern=x", "a.test.mjs"]);
  assert.equal(passed.refusal, undefined);
  assert.equal(passed.flags.full, true);
  assert.deepEqual(passed.flags.only, ["cli"]);
  assert.deepEqual(passed.testArgs, ["--test-name-pattern=x", "a.test.mjs"]);

  const home = mkdtempSync(path.join(tmpdir(), "test-help-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, STORYTREE_HOME: home };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  const run = (arg) => spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", arg], { cwd: repoRoot, env, encoding: "utf8" });
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pnpm run test --rerun-failed/);
  assert.doesNotMatch(help.stdout + help.stderr, /^scope:|test Postgres/m);
  const unknown = run("--bogus");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--bogus/);
  assert.doesNotMatch(unknown.stdout + unknown.stderr, /^scope:|test Postgres/m);
  assert.equal(existsSync(path.join(home, "heavy-run.lock")), false, "no heavy-run lock was taken");
});

test("the results table shows each unit PASS, FAIL or NOT RUN, and how to rerun the failures", () => {
  const table = resultsTable({ "packages/cli": "pass", "packages/forest": "fail", "apps/desktop": "not run" });
  assert.match(table, /PASS\s+packages\/cli/);
  assert.match(table, /FAIL\s+packages\/forest/);
  assert.match(table, /NOT RUN\s+apps\/desktop/);
  assert.match(table, /pnpm run test --rerun-failed/);
  assert.doesNotMatch(resultsTable({ "packages/cli": "pass" }), /rerun-failed/, "nothing to rerun, no hint");
});

test("1.5 a file named to run alone is a unit of its own whenever its package runs, and its package's unit runs every other file", (t) => {
  const root = fixture(t);
  write(root, "packages/forest/src/view/proof.test.ts", "");
  write(root, "packages/forest/src/view/other.test.ts", "");
  write(root, "packages/forest/src/more.test.mjs", "");
  const ws = readWorkspace(root);
  const alone = ["packages/forest/src/view/proof.test.ts", "packages/cli/src/gone.test.ts"];

  const scoped = planRun({ root, workspace: ws, decision: classify(["packages/forest/src/x.ts"], ws), alone }).units;
  assert.deepEqual(scoped, ["apps/desktop", "packages/forest", "packages/forest/src/view/proof.test.ts"]);
  assert.ok(planRun({ root, workspace: ws, decision: classify(["README.md"], ws), alone }).units.includes("packages/forest/src/view/proof.test.ts"));
  assert.deepEqual(planRun({ root, workspace: ws, decision: classify(["README.md"], ws), flags: { only: ["forest"] }, alone }).units, ["packages/forest", "packages/forest/src/view/proof.test.ts"]);
  assert.ok(!planRun({ root, workspace: ws, decision: classify(["packages/agent-link/src/x.ts"], ws), alone }).units.some((unit) => unit.endsWith(".test.ts")), "not when its package does not run");

  assert.deepEqual(unitGlobs("packages/forest", { root, alone }).sort(), ["packages/forest/src/d.test.ts", "packages/forest/src/more.test.mjs", "packages/forest/src/view/other.test.ts"]);
  assert.deepEqual(unitGlobs("packages/forest/src/view/proof.test.ts", { root, alone }), ["packages/forest/src/view/proof.test.ts"]);
  assert.ok(unitGlobs("packages/library", { root, alone }).includes("packages/library/src/**/*.test.ts"), "a package with no file to run alone keeps its globs");
});
