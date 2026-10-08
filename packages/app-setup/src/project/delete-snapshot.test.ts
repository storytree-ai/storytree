import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot, Storytree } from "@storytree/library";
import { deleteProject } from "./index.js";

const project = "synthetic";
const now = new Date("2026-10-08T00:00:00.000Z");
const stamp = "2026-10-08T00-00-00-000Z.json";
const snapshot: ProjectSnapshot = {
  format: "storytree-project-snapshot", version: 1, project, takenAt: now.toISOString(),
  records: [{ id: "term_synthetic", type: "term", version: 1, fields: { meaning: "private current text" }, createdAt: "now", updatedAt: "now" }],
  history: [{ seq: 1, recordId: "term_synthetic", type: "term", action: "created", record: { meaning: "private historical text" }, at: "then" }],
};
const posix = { skip: process.platform === "win32" ? "POSIX modes do not prove Windows ACL privacy" : false };
const mode = (file: string): number => fs.statSync(file).mode & 0o777;

/** Only the library boundary is inert: the real deletion, claims and local removal paths run. */
function inertLibrary(liveClaim = false) {
  const calls = { snapshots: 0, drops: 0 };
  const query = async () => ({ rows: [], rowCount: 0 });
  const client = { query, release() {} };
  const pool = {
    connect: async () => client,
    query: async (sql: string) => ({ rows: liveClaim && sql.includes("FROM activity") ? [{
      seq: "1", project, at: new Date(), session: "synthetic-holder", harness: null, source: "tool", kind: "claimed", folder: null,
      detail: { capability: "capability_synthetic", reason: "synthetic work" },
    }] : [], rowCount: 0 }),
  };
  const library = {
    listProjects: async () => [project],
    projectIdentities: async () => ({ [project]: "synthetic-database" }),
    ownDatabase: async () => pool,
    snapshot: async () => { calls.snapshots++; return snapshot; },
    dropProject: async () => { calls.drops++; },
  } as unknown as Storytree;
  return { library, calls };
}

for (const existing of [false, true]) {
  test(`3.6 · deletion snapshots are private at the first write under umask 022 with ${existing ? "existing" : "new"} backup folders`, posix, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-privacy-"));
    const previousMask = process.umask(0o022);
    t.after(() => { process.umask(previousMask); fs.rmSync(home, { recursive: true, force: true }); });
    fs.chmodSync(home, 0o755);
    const backups = path.join(home, "backups"), folder = path.join(backups, project), file = path.join(folder, stamp);
    if (existing) {
      fs.mkdirSync(folder, { recursive: true });
      for (const dir of [backups, folder]) fs.chmodSync(dir, 0o755);
    }
    const { library, calls } = inertLibrary();
    const write = fs.writeFileSync;
    let observed = false;
    const observe: typeof write = (target, data, options) => {
      write(target, data, options);
      if (target !== file) return;
      observed = true;
      assert.equal(mode(file), 0o600, "snapshot bytes are private as soon as written");
      for (const dir of [backups, folder]) assert.equal(mode(dir), 0o700, dir);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
      assert.equal(calls.drops, 0, "snapshot completes before deletion");
    };
    const mock = t.mock.method(fs, "writeFileSync", observe);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });

    assert.deepEqual(await deleteProject(project, { home, library, now, confirm: project, snapshot: true }), { status: "deleted", project, snapshot: file });
    assert.equal(observed, true);
    assert.deepEqual(calls, { snapshots: 1, drops: 1 });
    assert.equal(mode(home), 0o755, "the rest of the home is left alone");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
  });
}

test("3.6 · wrong confirmation, either in-use project and a live claim write no snapshot and delete nothing; skipping the snapshot still deletes", async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-controls-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const refusal of ["confirmation", "folder", "app", "claim"]) {
    const { library, calls } = inertLibrary(refusal === "claim");
    fs.writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: refusal === "app" ? project : "elsewhere" }));
    const result = await deleteProject(project, {
      home, library, now, snapshot: true, confirm: refusal === "confirmation" ? "wrong" : project,
      ...(refusal === "folder" ? { inUse: project } : {}),
    });
    assert.equal(result.status, "refused", refusal);
    assert.deepEqual(calls, { snapshots: 0, drops: 0 }, refusal);
    assert.equal(fs.existsSync(path.join(home, "backups")), false, refusal);
  }
  const { library, calls } = inertLibrary();
  assert.deepEqual(await deleteProject(project, { home, library, now, snapshot: false, confirm: project }), { status: "deleted", project });
  assert.deepEqual(calls, { snapshots: 0, drops: 1 });
  assert.equal(fs.existsSync(path.join(home, "backups")), false);
});

test("3.6 · a colliding snapshot is preserved and prevents deletion", async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-collision-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const folder = path.join(home, "backups", project), file = path.join(folder, stamp);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, "existing snapshot");
  const { library, calls } = inertLibrary();
  await assert.rejects(deleteProject(project, { home, library, now, snapshot: true, confirm: project }), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "existing snapshot");
  assert.equal(calls.drops, 0);
});

test("3.6 · a linked backup folder cannot redirect the snapshot or change another folder's permissions", posix, async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-link-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const outside = path.join(home, "unrelated"), backups = path.join(home, "backups");
  fs.mkdirSync(outside);
  fs.chmodSync(outside, 0o755);
  for (const link of [backups, path.join(backups, project)]) {
    fs.symlinkSync(outside, link);
    const { library, calls } = inertLibrary();
    await assert.rejects(deleteProject(project, { home, library, now, snapshot: true, confirm: project }), /not a directory/);
    assert.equal(mode(outside), 0o755);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(calls.drops, 0);
    fs.unlinkSync(link);
    fs.mkdirSync(backups, { recursive: true });
  }
});
