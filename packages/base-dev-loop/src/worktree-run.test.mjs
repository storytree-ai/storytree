// increment_53ca7af96300 (friction_f33f00f1da61): a targeted pnpm test started in a worktree while its scoped run held
// .pgtest ended 'ELIFECYCLE Test failed' with no failing test. A second run there is refused at once, naming the first.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { runWhat, takeWorktreeRun } from "./worktree-run.mjs";

function folder(t, prefix) {
  const made = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => removeTemp(made));
  return made;
}

test("4.31 · a worktree's test run is held by one live run at a time: a second is refused naming the first's pid, what it runs and when it started, and a run whose process has gone is taken over", (t) => {
  const work = path.join(folder(t, "worktree-run-"), ".pgtest");
  const first = takeWorktreeRun(work, { what: "files: a.test.mjs" });
  assert.equal(first.refusal, undefined);

  // Another live process holds it: this test's parent stands in for the first run.
  const other = path.join(work, "run.json");
  first.release();
  writeFileSync(other, JSON.stringify({ pid: process.ppid, token: "elsewhere", what: "units: packages/forest", startedAt: "2026-11-10T05:37:00.000Z" }));
  const second = takeWorktreeRun(work, { what: "files: b.test.mjs" });
  assert.equal(second.release, undefined);
  assert.match(second.refusal, new RegExp(`another pnpm test \\(pid ${process.ppid}, units: packages/forest, started 2026-11-10T05:37:00\\.000Z\\) is running in this worktree`));

  // Its process gone, the record is stale and the next run takes it.
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(other, JSON.stringify({ pid: gone, token: "elsewhere", what: "units: packages/forest", startedAt: "2026-11-10T05:37:00.000Z" }));
  const third = takeWorktreeRun(work, { what: "files: c.test.mjs" });
  assert.equal(third.refusal, undefined);
  third.release();
  assert.equal(existsSync(other), false, "a release removes the run's record");
});

test("4.31 · a run's record says what it runs: the files named on its command line, else its units", () => {
  const root = path.resolve("/repo");
  assert.equal(runWhat({ root, files: [path.join(root, "packages/a/src/x.test.mjs"), path.join(root, "packages/b/y.test.ts")], units: undefined }).replaceAll("\\", "/"),
    "files: packages/a/src/x.test.mjs, packages/b/y.test.ts");
  assert.equal(runWhat({ root, files: [], units: ["packages/forest", "packages/cli"] }), "units: packages/forest, packages/cli");
});

test("4.31 · a second pnpm test in a worktree whose run holds its test Postgres is refused at once, naming the first, a run given a server's url is not, and the first run goes on to pass", { timeout: 180_000 }, async (t) => {
  const root = folder(t, "worktree-run-root-");
  const marks = folder(t, "worktree-run-marks-");
  const started = path.join(marks, "started");
  const finish = path.join(marks, "finish");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  mkdirSync(path.join(root, "tests"));
  const waits = path.join(root, "tests", "waits.test.mjs");
  writeFileSync(waits, `import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";
test("waits for its finish mark", async () => {
  writeFileSync(${JSON.stringify(started)}, "");
  while (!existsSync(${JSON.stringify(finish)})) await new Promise((resolve) => setTimeout(resolve, 100));
});
`);
  const quick = path.join(root, "tests", "quick.test.mjs");
  writeFileSync(quick, `import { test } from "node:test";\ntest("passes", () => {});\n`);
  const harness = pathToFileURL(fileURLToPath(new URL("./test.mjs", import.meta.url))).href;
  const entry = (file) => ["--import", "tsx", "--input-type=module", "-e",
    `const { testCommand } = await import(${JSON.stringify(harness)}); testCommand({ argv: [${JSON.stringify(file)}], root: ${JSON.stringify(root)} });`];
  const env = { ...process.env, STORYTREE_HOME: path.join(marks, "home") };
  for (const name of ["STORYTREE_TEST_PG_URL", "STORYTREE_TEST_PG_ADMIN_URL", "STORYTREE_HEAVY_LOCK_HOLDER", "NODE_TEST_CONTEXT"]) delete env[name];
  const repo = fileURLToPath(new URL("../../..", import.meta.url));

  const firstRun = spawn(process.execPath, entry(waits), { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  let firstOutput = "";
  firstRun.stdout.on("data", (chunk) => { firstOutput += chunk; });
  firstRun.stderr.on("data", (chunk) => { firstOutput += chunk; });
  const firstEnded = new Promise((resolve) => firstRun.on("close", resolve));
  t.after(() => { if (firstRun.exitCode === null) firstRun.kill(); }); // it stops its own Postgres on a signal
  await waitUntil(() => existsSync(started) || firstRun.exitCode !== null, 120_000, "the first run to start its test");
  assert.equal(firstRun.exitCode, null, firstOutput);

  const second = spawnSync(process.execPath, entry(quick), { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
  const secondOutput = `${second.stdout}${second.stderr}`;
  assert.equal(second.status, 1, secondOutput);
  assert.match(secondOutput, new RegExp(`test harness: another pnpm test \\(pid ${firstRun.pid}, files: tests/waits\\.test\\.mjs, started [^)]+\\) is running in this worktree`), secondOutput);
  assert.doesNotMatch(secondOutput, /test Postgres:|last lines of/, "the refused run starts no Postgres and shows no other run's logs");

  // A run given a server's url starts no test Postgres here, so the first run's hold does not stop it.
  const elsewhere = spawnSync(process.execPath, entry(quick), { cwd: repo, env: { ...env, STORYTREE_TEST_PG_URL: "postgres://unused" }, encoding: "utf8", timeout: 60_000 });
  assert.equal(elsewhere.status, 0, `${elsewhere.stdout}${elsewhere.stderr}`);

  writeFileSync(finish, "");
  assert.equal(await firstEnded, 0, firstOutput);
  assert.equal(existsSync(path.join(root, ".pgtest", "run.json")), false, "the first run let the worktree go");
});
