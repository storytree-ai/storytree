// Capability 7 · Whole-run times measured
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, hostname, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { runGate } from "./gate.mjs";

const runner = pathToFileURL(fileURLToPath(new URL("./test.mjs", import.meta.url))).href;
const PASSES = `import { test } from "node:test";\ntest("passes", () => {});\n`;
const FAILS = `import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("fails", () => assert.equal(1, 2));\n`;
const HANGS_WHEN_TOLD = `import { writeFileSync } from "node:fs";\nimport { test } from "node:test";\ntest("hangs when told", async () => {\n  if (!process.env.FIXTURE_HANG) return;\n  writeFileSync(process.env.FIXTURE_HANG, "started");\n  await new Promise((resolve) => setTimeout(resolve, 30_000));\n});\n`;

function temp(t, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => removeTemp(dir));
  return dir;
}

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function git(root, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
}

function project(t, packages) {
  const root = temp(t, "wr-root-");
  write(root, "package.json", JSON.stringify({ name: "root", private: true }));
  write(root, ".gitignore", ".pgtest/\n");
  for (const [name, files] of Object.entries(packages)) {
    write(root, `packages/${name}/package.json`, JSON.stringify({ name: `@w/${name}` }));
    for (const [file, text] of Object.entries(files)) write(root, `packages/${name}/${file}`, text);
  }
  write(root, "run.mjs", `import { testCommand } from ${JSON.stringify(runner)};\ntestCommand({ root: ${JSON.stringify(root)}, hold: async () => () => {} });\n`);
  return root;
}

function branched(root) {
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

function childEnv(home, extra = {}) {
  const env = { ...process.env, STORYTREE_TEST_PG_URL: "postgres://unused", ...extra };
  for (const name of ["STORYTREE_HEAVY_LOCK_HOLDER", "NODE_TEST_CONTEXT", "STORYTREE_TEST_DEADLINE", "STORYTREE_TEST_EVIDENCE", "STORYTREE_TEST_JOBS"]) delete env[name];
  if (home === undefined) delete env.STORYTREE_HOME;
  else env.STORYTREE_HOME = home;
  return env;
}

function runTests(root, home, args = [], extra = {}) {
  const run = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "run.mjs", ...args], { cwd: root, env: childEnv(home, extra), encoding: "utf8", timeout: 120_000 });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function rows(home) {
  const file = path.join(home, "whole-runs.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function assertMachine(row) {
  assert.equal(row.machine, hostname());
  assert.equal(row.cpus, availableParallelism());
  assert.equal(row.platform, process.platform);
  assert.equal(row.arch, process.arch);
  assert.equal(typeof row.load, "number");
  assert.ok(Number.isFinite(row.load) && row.load >= 0, `load ${row.load} is a one-minute load average`);
  assert.equal(typeof row.ms, "number");
  assert.ok(Number.isFinite(row.ms) && row.ms >= 0, `ms ${row.ms} is a wall time`);
  assert.equal(new Date(row.at).toISOString(), row.at, `at ${row.at} is an ISO time`);
}

test("7.1 · a full pnpm test run appends one row to whole-runs.jsonl in STORYTREE_HOME: kind test, scope full, its units, pass, this machine, its load, cpus, jobs, platform and arch, ended inside the run", { timeout: 180_000 }, (t) => {
  const home = temp(t, "wr-home-");
  const root = project(t, { a: { "src/a.test.mjs": PASSES } });
  const before = Date.now();
  const run = runTests(root, home, ["--jobs=1"]);
  const after = Date.now();
  assert.equal(run.status, 0, run.output);

  const kept = rows(home);
  assert.equal(kept.length, 1, `one row: ${JSON.stringify(kept)}`);
  const [row] = kept;
  assert.equal(row.kind, "test");
  assert.equal(row.scope, "full");
  assert.equal(row.units, 1);
  assert.equal(row.result, "pass");
  assert.equal(row.jobs, 1);
  assertMachine(row);
  const ended = Date.parse(row.at);
  assert.ok(ended >= before && ended <= after, `at ${row.at} falls inside the run`);
});

test("7.1 · a scoped pnpm test run whose unit fails appends a row with scope scoped, the units it ran, its jobs and result fail", { timeout: 180_000 }, (t) => {
  const home = temp(t, "wr-home-");
  const root = branched(project(t, { a: { "src/a.test.mjs": PASSES }, b: { "src/b.test.mjs": FAILS }, c: { "src/c.test.mjs": PASSES } }));
  write(root, "packages/a/src/x.mjs", "export {};\n");
  write(root, "packages/b/src/x.mjs", "export {};\n");
  const run = runTests(root, home, ["--jobs=2"]);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /^units: packages\/a, packages\/b$/m);

  const kept = rows(home);
  assert.equal(kept.length, 1, `one row: ${JSON.stringify(kept)}`);
  const [row] = kept;
  assert.equal(row.kind, "test");
  assert.equal(row.scope, "scoped");
  assert.equal(row.units, 2);
  assert.equal(row.result, "fail");
  assert.equal(row.jobs, 2);
  assertMachine(row);
});

test("7.1 · runs of named files, --only, --rerun-failed, a shard, --scope alone, or a scope with no units append no row beside the decided run's one", { timeout: 300_000 }, (t) => {
  const home = temp(t, "wr-home-");
  const root = branched(project(t, { a: { "src/a.test.mjs": PASSES }, d: { "src/d.mjs": "export {};\n" } }));
  write(root, "packages/a/src/x.mjs", "export {};\n");
  const decided = runTests(root, home, ["--jobs=1"]);
  assert.equal(decided.status, 0, decided.output);
  const first = rows(home);
  assert.equal(first.length, 1, `the decided run keeps its row: ${JSON.stringify(first)}`);

  const excluded = [
    ["named files", [path.join(root, "packages/a/src/a.test.mjs")]],
    ["--only", ["--only=a", "--jobs=1"]],
    ["--rerun-failed", ["--rerun-failed", "--jobs=1"]],
    ["a shard", ["--shard=1/2", "--jobs=1"]],
    ["--scope alone", ["--scope"]],
  ];
  for (const [what, args] of excluded) {
    if (what === "--rerun-failed") write(root, ".pgtest/last-run.json", JSON.stringify({ at: new Date().toISOString(), units: { "packages/a": "fail" } }));
    const run = runTests(root, home, args);
    assert.equal(run.status, 0, `${what}: ${run.output}`);
    if (what !== "--scope alone") assert.match(run.output, /passes/, `${what} ran the unit's test: ${run.output}`);
    assert.deepEqual(rows(home), first, `${what} appends no row`);
  }

  rmSync(path.join(root, "packages/a/src/x.mjs"));
  write(root, "packages/d/src/y.mjs", "export {};\n");
  const none = runTests(root, home, ["--jobs=1"]);
  assert.equal(none.status, 0, none.output);
  assert.match(none.output, /^units: none$/m);
  assert.deepEqual(rows(home), first, "a scope with no units appends no row");
});

test("7.1 · an interrupted pnpm test run appends no row beside an earlier whole run's one", { timeout: 180_000 }, async (t) => {
  if (process.platform === "win32") {
    t.skip("platform:win32: a signal on Windows ends the runner without its handler, so interruption is not observable there");
    return;
  }
  const home = temp(t, "wr-home-");
  const marker = path.join(temp(t, "wr-marker-"), "started");
  const root = project(t, { a: { "src/a.test.mjs": HANGS_WHEN_TOLD } });
  const whole = runTests(root, home, ["--jobs=1"]);
  assert.equal(whole.status, 0, whole.output);
  const first = rows(home);
  assert.equal(first.length, 1, `the whole run keeps its row: ${JSON.stringify(first)}`);

  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "run.mjs", "--jobs=1"], { cwd: root, env: childEnv(home, { FIXTURE_HANG: marker }), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const closed = new Promise((resolve) => child.once("close", (code) => resolve(code)));
  t.after(() => child.kill("SIGKILL"));
  await waitUntil(() => existsSync(marker), 60_000, "the unit's test to start");
  child.kill("SIGINT");
  assert.equal(await closed, 130, output);
  assert.deepEqual(rows(home), first, "the interrupted run appends no row");
});

test("7.1 · with STORYTREE_HOME unset the row goes to ~/.storytree/0.3, and a home it cannot write is said on one line and leaves the run's result alone", { timeout: 180_000 }, (t) => {
  const user = temp(t, "wr-user-");
  const root = project(t, { a: { "src/a.test.mjs": PASSES } });
  const fallback = runTests(root, undefined, ["--jobs=1"], { HOME: user, USERPROFILE: user });
  assert.equal(fallback.status, 0, fallback.output);
  const kept = rows(path.join(user, ".storytree", "0.3"));
  assert.equal(kept.length, 1, `one row in the default home: ${fallback.output}`);
  assert.equal(kept[0].kind, "test");

  const blocked = path.join(temp(t, "wr-blocked-"), "home");
  writeFileSync(blocked, "a file where the home folder would be");
  const run = runTests(root, blocked, ["--jobs=1"]);
  assert.equal(run.status, 0, run.output);
  const said = run.output.split(/\r?\n/).filter((line) => /whole-run/i.test(line));
  assert.equal(said.length, 1, `one line says the whole-run row could not be written:\n${run.output}`);
});

function testRow(fields) {
  return { kind: "test", at: new Date().toISOString(), ms: 4321, result: "pass", machine: hostname(), load: 0.25, cpus: availableParallelism(), jobs: 1, platform: process.platform, arch: process.arch, ...fields };
}

function append(home, row) {
  mkdirSync(home, { recursive: true });
  appendFileSync(path.join(home, "whole-runs.jsonl"), `${JSON.stringify(row)}\n`);
}

const lint = () => ({ command: process.execPath, args: [], shell: false });
const noStandIns = () => ({ folder: undefined, plugins: {} });

const STEP_MS = { typecheck: 1000, test: 2000, "check:lint": 500 };

function gateUnder(t, home, { typecheck = 0, onLint = () => 0 } = {}) {
  const root = project(t, { a: { "src/a.test.mjs": PASSES }, b: { "src/b.test.mjs": PASSES } });
  const clock = { at: Date.parse("2026-11-19T12:00:00.000Z") };
  const started = clock.at;
  const run = async (name, options) => {
    clock.at += STEP_MS[name];
    if (name === "typecheck") return typecheck;
    if (name === "check:lint") return onLint();
    append(home, testRow({ scope: "scoped", units: 5 }));
    const ran = runTests(root, home, ["--jobs=1"], { ...options?.env, ...options?.command?.env });
    append(home, testRow({ scope: "scoped", units: 7 }));
    assert.equal(ran.status, 0, ran.output);
    return ran.status;
  };
  return { run, now: () => clock.at, started };
}

const composition = { parts: [{ name: "check:lint", command: lint }], owners: ["linter"], graph: { linter: [] } };
const gate = (options) => runGate({ steps: async () => composition, partsOff: () => [], standIns: noStandIns, log: () => {}, ...options });

test("7.2 · the gate appends one gate row once its table prints, carrying its own test step's scope and units, not another run's, its result from its code, and ms from runGate's start", { timeout: 300_000 }, async (t) => {
  const home = temp(t, "wr-home-");
  append(home, testRow({ scope: "scoped", units: 3, at: new Date(Date.now() - 3_600_000).toISOString() }));

  for (const [index, [typecheck, code, result]] of [[0, 0, "pass"], [1, 1, "fail"]].entries()) {
    const { run, now, started } = gateUnder(t, home, { typecheck });
    assert.equal(await gate({ root: project(t, {}), home, run, now }), code);

    const gates = rows(home).filter((row) => row.kind === "gate");
    assert.equal(gates.length, index + 1, `one gate row per gate run: ${JSON.stringify(rows(home))}`);
    const row = gates.at(-1);
    assert.deepEqual(rows(home).at(-1), row, "the gate row is appended after its test step's rows");
    assert.equal(row.scope, "full", `the test step's own row says full: ${JSON.stringify(rows(home))}`);
    assert.equal(row.units, 2, "the test step's own row ran 2 units; the other runs' rows ran 3, 5 and 7");
    assert.equal(row.result, result);
    assertMachine(row);
    assert.equal(row.ms, 3500, "the injected clock moved 1000 ms in typecheck, 2000 in test and 500 in check:lint, all after runGate's start and before its table");
    assert.equal(row.at, new Date(started + 3500).toISOString(), "at is the injected clock's reading when the table printed");
  }
});

test("7.2 · a gate whose test step appended no row, or that was interrupted after it did, appends no gate row beside a whole gate's one", { timeout: 300_000 }, async (t) => {
  const home = temp(t, "wr-home-");
  const whole = gateUnder(t, home);
  assert.equal(await gate({ root: project(t, {}), home, run: whole.run }), 0);
  const first = rows(home).filter((row) => row.kind === "gate");
  assert.equal(first.length, 1, `the whole gate keeps its row: ${JSON.stringify(rows(home))}`);

  const silent = async (name) => {
    if (name === "test") append(home, testRow({ scope: "full", units: 4 }));
    return 0;
  };
  assert.equal(await gate({ root: project(t, {}), home, run: silent }), 0);
  assert.deepEqual(rows(home).filter((row) => row.kind === "gate"), first, "a test step that appended no row of its own leaves no gate row");

  const controller = new AbortController();
  const stopped = gateUnder(t, home, { onLint: () => (controller.abort(), 0) });
  assert.equal(await gate({ root: project(t, {}), home, run: stopped.run, signal: controller.signal }), 130);
  assert.deepEqual(rows(home).filter((row) => row.kind === "gate"), first, "an interrupted gate leaves no gate row");
});
