/**
 * Capability 8 · Verified test run: contracts 8.1 to 8.3, through the run_tests tool as the MCP server mounts it. Each
 * test makes a Git checkout in a temp folder whose test command counts its runs in a file outside the checkout, so a
 * run that was answered from the record, not run, is seen as one the count did not move for.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { testRunToolParts } from "./test-run.js";

interface Answer { readonly text: string; readonly data?: Record<string, unknown> }
type Act = (args: Record<string, unknown>, call: { folder: string; caller: { session: string; harness?: string } }) => Promise<Answer>;

/** The run_tests tool's act, as the server would be handed it. */
function runTool(): Act {
  let act: Act | undefined;
  for (const part of testRunToolParts) part().registerTools?.((name, _description, _input, given) => {
    if (name === "run_tests") act = given as unknown as Act;
  });
  assert.ok(act, "run_tests is registered");
  return act;
}

/** A checkout whose `node suite.mjs` counts each run in a file outside it, prints a summary and exits with `code`. */
async function withCheckout(body: (place: { dir: string; runs: () => number; git: (...args: string[]) => void }) => Promise<void>, code = 0): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "qa-test-run-"));
  const dir = join(root, "repo");
  const counter = join(root, "runs.txt");
  try {
    execFileSync("git", ["init", "-q", dir]);
    const git = (...args: string[]) => void execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
    writeFileSync(join(dir, "suite.mjs"), [
      `import { appendFileSync } from "node:fs";`,
      `appendFileSync(${JSON.stringify(counter)}, "x");`,
      `console.log("collecting");`,
      `console.log("3 passed, ${code === 0 ? 0 : 1} failed");`,
      `process.exit(${code});`,
    ].join("\n"));
    writeFileSync(join(dir, "app.txt"), "one\n");
    git("add", "-A");
    git("commit", "-q", "-m", "start");
    const runs = () => (existsSync(counter) ? readFileSync(counter, "utf8").length : 0);
    await body({ dir, runs, git });
  } finally {
    await removeTemp(root);
  }
}

const GREEN = { session: "green-builder", harness: "claude-code" };
const REVIEWER = { session: "reviewer", harness: "claude-code" };

test("8.1 · run_tests runs the command in the folder and records its exit code, time and last lines against the folder's files and the command", async () => {
  const run = runTool();
  await withCheckout(async ({ dir, runs }) => {
    const answer = await run({ command: "node suite.mjs" }, { folder: dir, caller: GREEN });
    assert.equal(runs(), 1);
    assert.match(answer.text, /passed/);
    assert.match(answer.text, /3 passed, 0 failed/);
    const recorded = readFileSync(join(dir, ".git", "storytree", "test-runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(recorded.length, 1);
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim();
    assert.equal(recorded[0].tree, tree);
    assert.equal(recorded[0].command, "node suite.mjs");
    assert.equal(recorded[0].code, 0);
    assert.equal(recorded[0].by, "green-builder");
    assert.equal(typeof recorded[0].seconds, "number");
    assert.deepEqual(recorded[0].tail.slice(-1), ["3 passed, 0 failed"]);
  });
  await withCheckout(async ({ dir }) => {
    const answer = await run({ command: "node suite.mjs" }, { folder: dir, caller: GREEN });
    assert.match(answer.text, /failed \(exit code 3\)/);
    assert.equal((answer.data?.run as { code: number }).code, 3);
  }, 3);
});

test("8.2 · run_tests at the same files and command answers from the record, committed or not; an edit, a new file, another command or fresh runs it again", async () => {
  const run = runTool();
  await withCheckout(async ({ dir, runs, git }) => {
    writeFileSync(join(dir, "app.txt"), "two\n"); // the green builder's change, not yet committed
    await run({ command: "node suite.mjs" }, { folder: dir, caller: GREEN });
    assert.equal(runs(), 1);

    const read = await run({ command: "node suite.mjs" }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 1, "the reviewer's call is answered from the green builder's run");
    assert.equal(read.data?.reused, true);
    assert.match(read.text, /green-builder/);
    assert.match(read.text, /not re-run/);
    assert.match(read.text, /3 passed, 0 failed/);

    git("add", "-A");
    git("commit", "-q", "-m", "green");
    await run({ command: "node suite.mjs" }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 1, "committing the same files keeps the run");

    writeFileSync(join(dir, "app.txt"), "three\n");
    await run({ command: "node suite.mjs" }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 2, "an edited file runs it again");

    writeFileSync(join(dir, "new.txt"), "new\n");
    await run({ command: "node suite.mjs" }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 3, "a new untracked file runs it again");

    await run({ command: "node  suite.mjs" }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 4, "another command runs it again");

    const fresh = await run({ command: "node suite.mjs", fresh: true }, { folder: dir, caller: REVIEWER });
    assert.equal(runs(), 5, "fresh runs it again");
    assert.equal(fresh.data?.reused, false);
  });
});

test("8.2 · an edit of the same size made in the second the index was written is seen however much later run_tests is called (regression: PR #78's Linux CI, 2026-10-30)", async () => {
  const run = runTool();
  await withCheckout(async ({ dir, runs, git }) => {
    // Git compares a file to its index entry by whole seconds here, so an edit within the index's own second is
    // caught only by its racily-clean check, which reads the index file's time; the call comes a second later.
    const second = () => Math.floor(Date.now() / 1000);
    const start = second();
    while (second() === start) await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(join(dir, "app.txt"), "one\n"); // its committed text, staged again so the index is written now
    git("add", "-A");
    writeFileSync(join(dir, "app.txt"), "two\n");
    const edited = second();
    while (second() === edited) await new Promise((resolve) => setTimeout(resolve, 20));
    const answer = await run({ command: "node suite.mjs" }, { folder: dir, caller: GREEN });
    assert.equal(runs(), 1);
    git("commit", "-qam", "green");
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim();
    assert.equal((answer.data?.run as { tree: string }).tree, tree, "the run is recorded against the edited file, not the committed one");
  });
});

test("8.3 · run_tests in a folder outside any Git repository is refused, saying why, with nothing run", async () => {
  const run = runTool();
  const dir = mkdtempSync(join(tmpdir(), "qa-test-run-bare-"));
  try {
    const counter = join(dir, "ran.txt");
    await assert.rejects(run({ command: `node -e "require('fs').writeFileSync(${JSON.stringify(counter).replaceAll('"', "'")}, 'x')"` }, { folder: dir, caller: GREEN }), /Git/);
    assert.equal(existsSync(counter), false);
  } finally {
    await removeTemp(dir);
  }
});
