// Capability 6 · Running the tests: the red runs a checkout keeps, which the change-reviewer's brief reads (ADR-1153 D3).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const record = path.join(root, ".pgtest", "red-runs.jsonl");

/** Run test.mjs on the named files with a home of its own, as `pnpm test <file>` would. */
function run(dir, files) {
  const env = { ...process.env, STORYTREE_HOME: path.join(dir, "home") };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // its own home holds its own lock
  return spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", ...files], { cwd: root, env, encoding: "utf8" });
}

function rows() {
  try {
    return readFileSync(record, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("6.25 · a run keeps each test that failed by its full name, and a file that failed to load, in the checkout's red runs, which a later green run does not erase", (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "red-runs-"))); // macOS: /var is /private/var
  t.after(() => removeTemp(dir));
  const failing = path.join(dir, "failing.test.mjs");
  const unloadable = path.join(dir, "unloadable.test.mjs");
  writeFileSync(failing, `import { describe, test } from "node:test";
describe("suite", () => {
  test("9.1 · fails until built", () => { throw new Error("not built"); });
  test("9.2 · passes", () => {});
});`);
  writeFileSync(unloadable, `import { notBuilt } from "node:fs";
import { test } from "node:test";
test("9.3 · its import is not built", () => notBuilt());`);

  const red = run(dir, [failing, unloadable]);
  assert.equal(red.status, 1, red.stdout + red.stderr);
  const mine = (file) => rows().filter((row) => row.file === path.relative(root, file).replaceAll("\\", "/"));
  assert.deepEqual(mine(failing).map((row) => row.test).filter((name) => name.includes("9.")), ["suite › 9.1 · fails until built"]);
  assert.deepEqual(mine(unloadable).map((row) => row.test), [null]);
  assert.ok(mine(failing).every((row) => typeof row.at === "string" && typeof row.head === "string"));

  writeFileSync(failing, `import { test } from "node:test";\ntest("9.1 · fails until built", () => {});`);
  const green = run(dir, [failing]);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.deepEqual(mine(failing).map((row) => row.test).filter((name) => name.includes("9.")), ["suite › 9.1 · fails until built"]);
});

test("6.26 · the reds a run keeps in a worktree are also added to its clone's shared copy, with the commit they were seen at", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "red-runs-shared-")));
  t.after(() => removeTemp(dir));
  const clone = path.join(dir, "clone");
  const worktree = path.join(dir, "worktree");
  const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).stdout.trim();
  mkdirSync(clone);
  git(clone, "init", "-q");
  git(clone, "commit", "-q", "--allow-empty", "-m", "base");
  git(clone, "worktree", "add", "-q", "-b", "lane", worktree);
  const { recordReds } = await import("./red-runs.mjs");

  recordReds(worktree, { tests: [{ file: "a.test.mjs", name: "9.1 · fails", result: "fail" }, { file: "a.test.mjs", name: "9.2 · passes", result: "pass" }] });
  const shared = readFileSync(path.join(clone, ".git", "storytree", "red-runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(shared.map(({ head, file, test }) => ({ head, file, test })), [{ head: git(worktree, "rev-parse", "HEAD"), file: "a.test.mjs", test: "9.1 · fails" }]);
});

test("6.27 · a plain node --test run outside storytree, given the dev loop's red-run reporter by its package name, keeps its reds in its own checkout's red runs", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "red-runs-factory-")));
  t.after(() => removeTemp(dir));
  // A factory-shaped repository: its own Git checkout, reaching the dev loop by a link to its package, as a factory's `link:` does.
  const factory = path.join(dir, "factory");
  mkdirSync(path.join(factory, "node_modules", "@storytree"), { recursive: true });
  symlinkSync(path.join(root, "packages", "dev-loop"), path.join(factory, "node_modules", "@storytree", "dev-loop"), "junction");
  spawnSync("git", ["init", "-q"], { cwd: factory });
  mkdirSync(path.join(factory, "plugins", "p"), { recursive: true });
  // The run's own events, kept to give the reporter again in this process.
  writeFileSync(path.join(dir, "events.mjs"), `export default async function* (source) { for await (const event of source) yield JSON.stringify(event) + "\\n"; }`);
  writeFileSync(path.join(factory, "plugins", "p", "failing.test.mjs"), `import { describe, test } from "node:test";
describe("suite", () => {
  test("9.1 · fails until built", () => { throw new Error("not built"); });
  test("9.2 · passes", () => {});
});`);
  writeFileSync(path.join(factory, "plugins", "p", "unloadable.test.mjs"), `import { notBuilt } from "node:fs";
import { test } from "node:test";
test("9.3 · its import is not built", () => notBuilt());`);

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a run of its own, not a child of this one
  const red = spawnSync(process.execPath, ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=@storytree/dev-loop/red-run-reporter", "--test-reporter-destination=stderr",
    `--test-reporter=${path.join(dir, "events.mjs")}`, `--test-reporter-destination=${path.join(dir, "events.jsonl")}`,
    path.join("plugins", "p", "failing.test.mjs"), path.join("plugins", "p", "unloadable.test.mjs")], { cwd: factory, env, encoding: "utf8" });
  assert.equal(red.status, 1, red.stdout + red.stderr);
  const saved = readFileSync(path.join(factory, ".pgtest", "red-runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(saved.map(({ file, test }) => ({ file, test })), [
    { file: "plugins/p/failing.test.mjs", test: "suite › 9.1 · fails until built" },
    { file: "plugins/p/unloadable.test.mjs", test: null },
  ]);

  // The same events, given to the reporter's own work in this process from a folder inside the checkout, keep the same reds.
  rmSync(path.join(factory, ".pgtest"), { recursive: true });
  const events = readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const { keepReds } = await import("./red-run-reporter.mjs");
  await keepReds((async function* () { yield* events; })(), path.join(factory, "plugins"));
  const again = readFileSync(path.join(factory, ".pgtest", "red-runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(again.map(({ file, test }) => ({ file, test })), saved.map(({ file, test }) => ({ file, test })));
});
