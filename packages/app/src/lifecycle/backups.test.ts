/**
 * Capability 1 · Lifecycle, contract 1.8 in the app story (ADR-0641 D2 step 4, choice B1): the app
 * writes a snapshot of each project once a day (at start unless one under a day old is reused), keeping each project's newest 14.
 * Against the real Postgres `pnpm test` provides; apps/desktop wires the timing to the app.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs, { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { quietFor, waitUntil } from "@storytree/test-waits";

import type { ProjectSnapshot } from "@storytree/library";

import { BACKUP_EVERY_MS, BACKUPS_KEPT, backUp, keepBackups, readBackup } from "./backups.js";

test("1.8 the app writes a snapshot of each project to backups/<project>/, keeping that project's newest 14, and each restores", { timeout: 300_000 }, async () => {
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

    const snapshot = await readBackup(path.join(dir, site, stamp));
    await storytree.restore(copy, snapshot);
    const restored = await storytree.openProject(copy);
    assert.ok((await restored.search("Kept by the backup")).length === 1, "the snapshot file restores");
    await restored.close();

    assert.equal(BACKUP_EVERY_MS, 24 * 60 * 60 * 1000, "once a day");
  } finally {
    await storytree.close();
    rmSync(dir, { recursive: true, force: true });
    await dropTestDatabases([site, app, copy].map((name) => `storytree_${name}`));
  }
});

test("1.8 a snapshot past the longest string JavaScript can build is written whole, in pieces, and reads back", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-backups-large-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshot: ProjectSnapshot = {
    format: "storytree-project-snapshot", version: 1, project: "large", takenAt: "2026-10-26T00:00:00.000Z",
    records: Array.from({ length: 50 }, (_, i) => ({ id: `term_${i}`, type: "term", version: 1, fields: { meaning: `meaning ${i}\n"quoted"` }, createdAt: "now", updatedAt: "now" })),
    history: Array.from({ length: 50 }, (_, i) => ({ seq: i + 1, recordId: `term_${i}`, type: "term", action: "created" as const, record: { meaning: `meaning ${i}` }, at: "then" })),
  };
  // V8 refuses a string past about 2^29 characters; here the limit is 400, far below the whole snapshot.
  const stringify = (value: unknown): string => {
    const text = JSON.stringify(value);
    if (text.length > 400) throw new RangeError("Invalid string length");
    return text;
  };
  const [file] = await backUp({ storytree: { snapshot: async () => snapshot }, projects: ["large"], dir, now: new Date(snapshot.takenAt), stringify });
  assert.ok(file);
  assert.deepEqual(await readBackup(file), snapshot, "the file reads back, piece by piece, as the object restore takes");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), snapshot, "and is still one JSON value");
  const empty: ProjectSnapshot = { ...snapshot, project: "empty", records: [], history: [] };
  // A 1.2 MB record, then 3 MB more, reach the file in a few writes each well below the whole, never as one string.
  const big: ProjectSnapshot = { ...snapshot, project: "big", records: Array.from({ length: 3001 }, (_, i) => ({ ...snapshot.records[0]!, id: `term_${i}`, fields: { meaning: "x".repeat(i === 0 ? 1_200_000 : 1000) } })) };
  const write = fs.writeSync, writes: number[] = [];
  const mock = t.mock.method(fs, "writeSync", ((fd: number, data: string) => { writes.push(data.length); return write(fd, data); }) as typeof write);
  syncBuiltinESMExports();
  const [bigFile] = await backUp({ storytree: { snapshot: async () => big }, projects: ["big"], dir, now: new Date(snapshot.takenAt) });
  mock.mock.restore();
  syncBuiltinESMExports();
  assert.ok(writes.length > 1 && writes.length < 10 && Math.max(...writes) < 3_000_000, `written in a few pieces: ${writes.length} writes, largest ${Math.max(...writes)}`);
  assert.deepEqual(await readBackup(bigFile!), big);
  const [none] = await backUp({ storytree: { snapshot: async () => empty }, projects: ["empty"], dir, now: new Date(snapshot.takenAt), stringify });
  assert.deepEqual(await readBackup(none!), empty);
});

test("1.50 a daily snapshot carries the project's media, a line per file after its history, and restores each file exactly; a snapshot holding none is written as before", { timeout: 300_000 }, async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const [site, copy] = [`t-${randomBytes(4).toString("hex")}`, `t-${randomBytes(4).toString("hex")}`];
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-backups-media-"));
  const storytree = await connect({ url });
  try {
    const library = await storytree.openProject(site);
    const note = await library.defineTerm({ term: "Approved look", meaning: "The forest at dusk." });
    const [png, clip] = [randomBytes(2_000), randomBytes(300_000)];
    await library.attachMedia(note.id, { name: "dusk.png", type: "image/png", bytes: png });
    await library.attachMedia(note.id, { name: "dusk.webm", type: "video/webm", bytes: clip });
    await library.close();

    const [file] = await backUp({ storytree, projects: [site], dir, now: new Date("2026-11-05T00:00:00.000Z") });
    const lines = readFileSync(file!, "utf8").split("\n");
    assert.ok(!lines[0]!.includes("dusk"), "the first line holds no media");
    assert.equal(lines.filter((line) => line.includes(`"name":"dusk.`)).length, 2, "a line per file");
    const snapshot = await readBackup(file!);
    assert.deepEqual(snapshot, await storytree.snapshot(site).then((now) => ({ ...now, takenAt: snapshot.takenAt })), "it reads back as the snapshot it was written from");

    await storytree.restore(copy, snapshot);
    const restored = await storytree.openProject(copy);
    assert.deepEqual((await restored.mediaFile(note.id, "dusk.png"))?.bytes, new Uint8Array(png));
    assert.deepEqual((await restored.mediaFile(note.id, "dusk.webm"))?.bytes, new Uint8Array(clip));
    await restored.close();
  } finally {
    await storytree.close();
    rmSync(dir, { recursive: true, force: true });
    await dropTestDatabases([site, copy].map((name) => `storytree_${name}`));
  }
});

test("1.8 a start reuses a project's successful snapshot under a day old, and takes the next at its day mark", { timeout: 300_000 }, async (t) => {
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
  // Each snapshot is written to disk, which Windows can take many turns to finish (the waits' clock is not mocked here).
  const untilTaken = (count: number) => waitUntil(() => taken.length >= count, 10_000, `${count} snapshots taken`);
  await untilTaken(3);
  assert.deepEqual(taken, ["stale", "none", "partial"], "a start takes no new snapshot of a project whose newest successful one is under a day old");
  t.mock.timers.tick(hour - 1);
  await quietFor(() => taken.length > 3, 200, "a snapshot before the day mark");
  t.mock.timers.tick(1);
  await untilTaken(4);
  assert.deepEqual(taken.slice(3), ["fresh"], "the reused snapshot's day mark takes the next");
  t.mock.timers.tick(23 * hour);
  await untilTaken(7);
  assert.deepEqual(taken.slice(4), ["stale", "none", "partial"], "while running, every project still gets one a day");
});
