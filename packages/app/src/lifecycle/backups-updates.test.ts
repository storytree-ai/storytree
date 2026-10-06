import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot } from "@storytree/library";
import { background } from "./background.js";
import { BACKUP_EVERY_MS, keepBackups } from "./backups.js";
import { mainUpdates } from "../updates/main-updates.js";

for (const when of ["start-up", "daily"] as const) {
  test(`4.8 a ready main build keeps its window open during a ${when} snapshot, even when the menu asks`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const dir = mkdtempSync(path.join(tmpdir(), "storytree-backup-update-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const snapshot = deferred<ProjectSnapshot>();
    let snapshots = 0;
    const backups = keepBackups({ dir, log: () => {}, storytree: {
      listProjects: async () => ["project"],
      snapshot: async () => ++snapshots === (when === "daily" ? 2 : 1) ? snapshot.promise : emptySnapshot(),
    } });
    t.after(() => backups.stop());
    await new Promise(resolve => setImmediate(resolve));
    if (when === "daily") t.mock.timers.tick(BACKUP_EVERY_MS);
    await new Promise(resolve => setImmediate(resolve));
    let windowOpen = true, restarts = 0, builds = 0;
    const lifecycle = background({
      stopPages: () => { windowOpen = false; },
      stopDatabase: async () => { backups.stop(); },
      relaunch: () => { restarts++; }, exit: () => {},
    });
    const running = { slot: "a" as const, dir: "/runtime/a", sha: "1234567890" };
    const next = { slot: "b" as const, dir: "/runtime/b", sha: "abcdef1234" };
    const updates = mainUpdates({ runtimeDir: "/runtime", running, runningBuild: "main 1234567",
      canRestart: async () => backups.canRestart(), update: async () => { builds++; return next; },
      restart: () => lifecycle.restart({ execPath: "next-build", args: [] }, windowOpen),
    });
    t.after(() => updates.stop());
    const state = await updates.check();
    assert.equal(windowOpen, true, "the old window stays open, outside shutdown, while the snapshot runs");
    assert.equal(state.phase, "ready");
    updates.request("install");
    assert.equal((await updates.check()).phase, "ready", "the menu cannot bypass the snapshot");
    assert.equal(restarts, 0);
    snapshot.resolve(emptySnapshot());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await updates.check()).phase, "restarting");
    await updates.check();
    assert.equal(windowOpen, false);
    assert.equal(restarts, 1);
    assert.equal(builds, 1, "the held build is reused");
  });
}

test("1.8 a failed snapshot releases the restart hold, and stopping prevents later daily snapshots", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const projects = deferred<string[]>();
  let reads = 0;
  const logs: string[] = [];
  const backups = keepBackups({ dir: "/unused", log: line => logs.push(line), storytree: {
    listProjects: async () => { reads++; return projects.promise; },
    snapshot: async () => { throw new Error("snapshot interrupted"); },
  } });
  t.after(() => backups.stop());
  assert.equal(backups.canRestart(), false, "the hold starts before even the project list returns");
  t.mock.timers.tick(BACKUP_EVERY_MS);
  assert.equal(reads, 1, "a slow snapshot never overlaps the next daily run");
  projects.resolve(["project"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(backups.canRestart(), true, "failure must not hold updates forever");
  assert.deepEqual(logs, ["backups: snapshot interrupted"]);
  backups.stop();
  t.mock.timers.tick(BACKUP_EVERY_MS);
  assert.equal(reads, 1, "shutdown cancels future snapshots");
});

function emptySnapshot(): ProjectSnapshot {
  return { format: "storytree-project-snapshot", version: 1, project: "project", takenAt: new Date().toISOString(), records: [], history: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
