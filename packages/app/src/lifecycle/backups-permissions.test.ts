import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot } from "@storytree/library";
import { backUp, keepBackups } from "./backups.js";

const posix = { skip: process.platform === "win32" ? "POSIX modes do not prove Windows ACL privacy" : false };
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const stamp = "2026-10-08T00-00-00-000Z.json";
const snapshot: ProjectSnapshot = {
  format: "storytree-project-snapshot", version: 1, project: "synthetic", takenAt: "2026-10-08T00:00:00.000Z",
  records: [{ id: "term_synthetic", type: "term", version: 1, fields: { meaning: "current private text" }, createdAt: "now", updatedAt: "now" }],
  history: [{ seq: 1, recordId: "term_synthetic", type: "term", action: "created", record: { meaning: "historical private text" }, at: "then" }],
};

for (const mask of [0o022, 0o077]) for (const existing of [false, true]) {
  test(`1.8 · automatic snapshots are private from their first write with umask ${mask.toString(8)} and ${existing ? "existing" : "new"} backup folders`, posix, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-backup-privacy-"));
    const dir = path.join(home, "backups"), folder = path.join(dir, "synthetic");
    const previousMask = process.umask(mask);
    t.after(() => { process.umask(previousMask); fs.rmSync(home, { recursive: true, force: true }); });
    fs.chmodSync(home, 0o755); // An existing traversable home must not be relied on for privacy.
    const retained = path.join(folder, "2026-10-07T00-00-00-000Z.json");
    const stale = `${retained}.partial`, notes = path.join(folder, "notes.txt");
    if (existing) {
      fs.mkdirSync(folder, { recursive: true });
      for (const directory of [dir, folder]) fs.chmodSync(directory, 0o755);
      for (const file of [retained, stale, notes]) {
        fs.writeFileSync(file, "kept");
        fs.chmodSync(file, 0o644);
      }
    }
    const write = fs.writeFileSync;
    let observed = false;
    const observeWrite: typeof write = (file, data, options) => {
      write(file, data, options);
      assert.equal(mode(String(file)), 0o600, "the partial is private as soon as it contains data, before publication");
      assert.equal(mode(dir), 0o700);
      assert.equal(mode(folder), 0o700);
      assert.equal(fs.existsSync(path.join(folder, stamp)), false, "the final name is not published during the write");
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
      observed = true;
    };
    const mock = t.mock.method(fs, "writeFileSync", observeWrite);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    const written = await backUp({ dir, projects: ["synthetic"], now: new Date(snapshot.takenAt), storytree: { snapshot: async () => snapshot } });
    assert.equal(observed, true);
    assert.deepEqual(written, [path.join(folder, stamp)]);
    assert.equal(mode(written[0]!), 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(written[0]!, "utf8")), snapshot);
    assert.equal(fs.readdirSync(folder).some(name => name.endsWith(".partial")), false);
    assert.equal(mode(home), 0o755, "only the backup tree is repaired");
    if (existing) {
      assert.equal(mode(retained), 0o600);
      assert.equal(fs.readFileSync(retained, "utf8"), "kept");
      assert.equal(mode(notes), 0o644, "unrelated files are left alone");
      assert.equal(fs.readFileSync(notes, "utf8"), "kept");
    }
  });
}

test("1.8 · startup repairs retained snapshots and partials even when a fresh snapshot is reused or its project is gone", posix, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.parse("2026-10-08T01:00:00.000Z") });
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-backup-repair-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "backups"), owned: string[] = [];
  for (const project of ["fresh", "gone"]) {
    const folder = path.join(dir, project);
    fs.mkdirSync(folder, { recursive: true });
    fs.chmodSync(folder, 0o755);
    for (const suffix of ["", ".partial"]) {
      const file = path.join(folder, stamp + suffix);
      fs.writeFileSync(file, JSON.stringify(snapshot) + "\n");
      fs.chmodSync(file, 0o644);
      owned.push(file);
    }
  }
  fs.chmodSync(dir, 0o755);
  const logs: string[] = [];
  let taken = 0;
  const backups = keepBackups({ dir, log: line => logs.push(line), storytree: {
    listProjects: async () => ["fresh"], snapshot: async () => { taken++; return snapshot; },
  } });
  t.after(() => backups.stop());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(logs, []);
  assert.equal(taken, 0, "privacy repair must not defeat startup freshness reuse");
  assert.equal(backups.canRestart(), true);
  assert.equal(mode(dir), 0o700);
  for (const file of owned) {
    assert.equal(mode(path.dirname(file)), 0o700);
    assert.equal(mode(file), 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
  }
});
