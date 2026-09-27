/** Capability 4 · Updates, contract 4.3 (ADR-0656 D2): check the newly running main build. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { refreshOwnHealth } from "./own-health.js";

test("4.3 the running slot checks its own build in the background, logs output, and retries failures only at the next update", async () => {
  // macOS's temporary directory is a symlink; the child reports its physical working directory.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree own health ")));
  const home = path.join(root, "app home");
  const said: string[] = [];
  mkdirSync(home);
  // A real pnpm child, with each slot's command standing in for its full test suite.
  const slots = ["a", "b"].map((slot) => {
    const dir = path.join(root, slot);
    mkdirSync(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { "check:own-health": "node check.mjs" } }));
    writeFileSync(path.join(dir, "check.mjs"), `
      import { appendFileSync, existsSync } from 'node:fs';
      import path from 'node:path';
      import { setTimeout as delay } from 'node:timers/promises';
      const home = process.env.STORYTREE_HOME;
      appendFileSync(path.join(home, 'runs'), JSON.stringify({ cwd: process.cwd(), home }) + '\\n');
      console.log('health stdout from ${slot}');
      console.error('health stderr from ${slot}');
      while (existsSync(path.join(home, 'hold'))) await delay(20);
      process.exitCode = existsSync(path.join(home, 'fail')) ? 7 : 0;
    `);
    return dir;
  });
  const run = (slot: "a" | "b", sha: string): Promise<void> => refreshOwnHealth({
    running: { slot, dir: slots[slot === "a" ? 0 : 1]!, sha }, home, log: (line) => said.push(line),
  });
  const runs = (): { cwd: string; home: string }[] => readFileSync(path.join(home, "runs"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  let pending: Promise<void> | undefined;
  try {
    writeFileSync(path.join(home, "hold"), "");
    let finished = false;
    pending = run("a", "first-main").then(() => { finished = true; });
    const deadline = Date.now() + 20_000;
    while (!existsSync(path.join(home, "runs")) && Date.now() < deadline) await delay(20);
    assert.ok(existsSync(path.join(home, "runs")), said.join("\n"));
    assert.equal(finished, false, "the app can carry on while the health task keeps update polling waiting");
    rmSync(path.join(home, "hold"));
    await pending;
    await run("a", "first-main");
    assert.equal(runs().length, 1, "reopening an unchanged build does not check again");

    writeFileSync(path.join(home, "fail"), "");
    await run("b", "second-main");
    await run("b", "second-main");
    assert.equal(runs().length, 2, "a failed check does not loop on the same build");
    assert.match(said.join("\n"), /failed.*7.*next update/i);
    rmSync(path.join(home, "fail"));
    await run("a", "third-main");
    assert.deepEqual(runs(), [
      { cwd: slots[0], home }, { cwd: slots[1], home }, { cwd: slots[0], home },
    ], "each update checks from its newly running slot, against the app's exact home");
    assert.match(said.join("\n"), /health stdout from b/);
    assert.match(said.join("\n"), /health stderr from b/);
    assert.match(said.join("\n"), /completed.*third-main/i);
  } finally {
    rmSync(path.join(home, "hold"), { force: true });
    await pending;
    rmSync(root, { recursive: true, force: true });
  }
});

test("4.3 a check that cannot start is logged without failing app startup", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-health-missing-"));
  const said: string[] = [];
  try {
    await refreshOwnHealth({ running: { slot: "b", dir: path.join(home, "missing slot"), sha: "new-main" }, home, log: (line) => said.push(line) });
    assert.match(said.join("\n"), /failed.*next update/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
