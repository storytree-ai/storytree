// Capability 6 · Running the tests: the red runs a checkout keeps, which the change-reviewer's brief reads (ADR-1153 D3).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
  const dir = mkdtempSync(path.join(tmpdir(), "red-runs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
