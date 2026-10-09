/**
 * Capability 1 · Lifecycle, contract 1.8 in the app story (ADR-0641 D2 step 4, choice B1): the app
 * writes a snapshot of each project once a day (at start unless one under a day old is reused), keeping each project's newest 14.
 * Against the real Postgres `pnpm test` provides; apps/desktop wires the timing to the app.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { BACKUP_EVERY_MS, BACKUPS_KEPT, backUp, keepBackups } from "./backups.js";

test("1.8 the app writes a snapshot of each project to backups/<project>/, keeping that project's newest 14, and each restores", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const fresh = (): string => `t-${randomBytes(4).toString("hex")}`;
  const [site, app, copy] = [fresh(), fresh(), fresh()];
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-backups-"));
  const storytree = await connect({ url });
  try {
    const library = await storytree.openProject(site);
    await library.defineTerm({ term: "Backup", meaning: "Kept by the backup." });
    await library.close();
    await (await storytree.openProject(app)).close();

    // Fifteen older snapshots of `site`, and a file that is not one, which is never touched.
    mkdirSync(path.join(dir, site));
    const older = Array.from({ length: 15 }, (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}T00-00-00-000Z.json`);
    for (const name of older) writeFileSync(path.join(dir, site, name), "{}");
    writeFileSync(path.join(dir, site, "notes.txt"), "mine");

    const now = new Date("2026-09-27T01:02:03.456Z");
    const written = await backUp({ storytree, projects: [site, app], dir, now });

    const stamp = "2026-09-27T01-02-03-456Z.json";
    assert.deepEqual(written.map((file) => path.relative(dir, file)), [path.join(site, stamp), path.join(app, stamp)]);
    assert.deepEqual(
      readdirSync(path.join(dir, site)).sort(),
      [...older.slice(-(BACKUPS_KEPT - 1)), stamp, "notes.txt"].sort(),
      "the newest 14 snapshots of the project are kept, and its other files are left alone",
    );
    assert.deepEqual(readdirSync(path.join(dir, app)), [stamp]);

    const snapshot = JSON.parse(readFileSync(path.join(dir, site, stamp), "utf8"));
    await storytree.restore(copy, snapshot);
    const restored = await storytree.openProject(copy);
    assert.ok((await restored.search("Kept by the backup")).length === 1, "the snapshot file restores");
    await restored.close();

    assert.equal(BACKUP_EVERY_MS, 24 * 60 * 60 * 1000, "once a day");
  } finally {
    await storytree.close();
    rmSync(dir, { recursive: true, force: true });
    const admin = new pg.Client({ connectionString: process.env["STORYTREE_TEST_PG_ADMIN_URL"] || url });
    await admin.connect();
    try {
      for (const name of [site, app, copy]) await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});

test("1.8 a start reuses a project's successful snapshot under a day old, and takes the next at its day mark", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.parse("2026-10-06T12:00:00.000Z") });
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-backups-due-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hour = 60 * 60 * 1000;
  const file = (hoursAgo: number): string => `${new Date(Date.now() - hoursAgo * hour).toISOString().replace(/[:.]/g, "-")}.json`;
  const put = (project: string, name: string, text = "{}\n"): void => {
    mkdirSync(path.join(dir, project), { recursive: true });
    writeFileSync(path.join(dir, project, name), text);
  };
  put("fresh", file(23));
  put("stale", file(25));
  put("partial", file(30));
  put("partial", file(1), "{\"records\":[");
  const taken: string[] = [];
  const backups = keepBackups({ dir, log: () => {}, storytree: {
    listProjects: async () => ["fresh", "stale", "none", "partial"],
    snapshot: async (project) => { taken.push(project); return { format: "storytree-project-snapshot", version: 1, project, takenAt: new Date().toISOString(), records: [], history: [] }; },
  } });
  t.after(() => backups.stop());
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  assert.deepEqual(taken, ["stale", "none", "partial"], "a start takes no new snapshot of a project whose newest successful one is under a day old");
  t.mock.timers.tick(hour - 1);
  await settle();
  assert.deepEqual(taken, ["stale", "none", "partial"]);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(taken.slice(3), ["fresh"], "the reused snapshot's day mark takes the next");
  t.mock.timers.tick(23 * hour);
  await settle();
  assert.deepEqual(taken.slice(4), ["stale", "none", "partial"], "while running, every project still gets one a day");
});
