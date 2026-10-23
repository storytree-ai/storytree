import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_EVERY_MS, keepBackups } from "./backups.js";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
