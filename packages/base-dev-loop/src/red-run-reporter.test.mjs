// Capability 4 · Running the tests: the red-run reporter a checkout outside storytree, such as a user's factory, gives its
// own `node --test` by this package's name, keeping its reds as `pnpm test` does (ADR-1153 D3).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp } from "@storytree/test-waits";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("4.27 · a plain node --test run outside storytree, given the base dev loop's red-run reporter by its package name, keeps its reds in its own checkout's red runs", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "red-runs-factory-")));
  t.after(() => removeTemp(dir));
  // A factory-shaped repository: its own Git checkout, reaching the base dev loop by a link to its package, as a factory's `link:` does.
  const factory = path.join(dir, "factory");
  mkdirSync(path.join(factory, "node_modules", "@storytree"), { recursive: true });
  symlinkSync(path.join(root, "packages", "base-dev-loop"), path.join(factory, "node_modules", "@storytree", "base-dev-loop"), "junction");
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
    "--test-reporter=@storytree/base-dev-loop/red-run-reporter", "--test-reporter-destination=stderr",
    `--test-reporter=${pathToFileURL(path.join(dir, "events.mjs")).href}`, `--test-reporter-destination=${path.join(dir, "events.jsonl")}`,
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
