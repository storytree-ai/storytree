import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { smokeElectronFiles, smokePhases } from "./smoke-phases.js";

test("1.36 · a smoke check prints a smoke: line as each phase starts, and its give-up line names the phase it was stuck in", () => {
  const logged: string[] = [];
  let now = 1_000;
  const phases = smokePhases({ log: line => logged.push(line), now: () => now });
  phases.phase("opening the library");
  now = 3_500;
  phases.phase("waiting for the page");
  assert.deepEqual(logged, ["smoke: opening the library (0.0 s)", "smoke: waiting for the page (2.5 s)"]);
  assert.equal(phases.gaveUp(180_000), "smoke: gave up after 180 s, stuck waiting for the page");
  assert.equal(smokePhases({ log: () => {}, now: () => 0 }).gaveUp(5_000), "smoke: gave up after 5 s, before its first phase");
});

test("1.36 · a smoke check keeps Electron's files in a scratch folder apart from the app's own, removes it, and sweeps a long-finished run's", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "smoke-phases-test-"));
  try {
    const finished = path.join(tmp, "storytree-smoke-finished");
    const running = path.join(tmp, "storytree-smoke-running");
    mkdirSync(path.join(finished, "Cache"), { recursive: true });
    mkdirSync(running);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(finished, hourAgo, hourAgo);
    const shared = path.join(tmp, "home", "electron");
    const files = smokeElectronFiles({ shared, tmp });
    assert.equal(existsSync(finished), false, "a run that ended long ago leaves no folder behind");
    assert.equal(existsSync(running), true, "a run that may still be going keeps its folder");
    assert.ok(!files.dir.startsWith(path.dirname(shared)), files.dir);
    assert.ok(files.dir.startsWith(tmp) && existsSync(files.dir));
    assert.ok(files.line.includes(files.dir) && files.line.includes(shared), files.line);
    files.remove();
    assert.equal(existsSync(files.dir), false);
    files.remove(); // removing twice is harmless
  } finally {
    await removeTemp(tmp);
  }
});
