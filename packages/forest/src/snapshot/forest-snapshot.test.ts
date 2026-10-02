import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { saveForestSnapshot, type ForestSnapshot } from "@storytree/forest/snapshot";

const drawing: ForestSnapshot = {
  version: 1, capturedAt: "2026-10-01T00:00:00.000Z", radius: 218,
  scene: { islands: [], links: [] }, spots: [],
};

test("3.25 saving waits for the complete drawing, then replaces the previous snapshot with its data and capture time", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "forest-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "forest.json");
  const before = JSON.stringify({ ...drawing, capturedAt: "2026-09-30T00:00:00.000Z" });
  await writeFile(file, before);
  const pending = Promise.withResolvers<ForestSnapshot>();
  const saving = saveForestSnapshot(file, () => pending.promise);
  assert.equal(await readFile(file, "utf8"), before, "the pending read keeps the last drawing available");
  pending.resolve(drawing);
  await saving;
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), drawing);
  assert.deepEqual(await readdir(directory), ["forest.json"]);
});

test("3.25 a failed read keeps the previous saved drawing byte-for-byte intact", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "forest-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "forest.json");
  const before = JSON.stringify(drawing);
  await writeFile(file, before);
  await assert.rejects(saveForestSnapshot(file, async () => { throw new Error("library offline"); }), /library offline/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.deepEqual(await readdir(directory), ["forest.json"]);
});

test("3.25 a failed replacement leaves its destination intact and removes the temporary drawing", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "forest-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "occupied");
  await mkdir(destination);
  await writeFile(path.join(destination, "keep"), "existing destination");
  await assert.rejects(saveForestSnapshot(destination, async () => drawing));
  assert.equal(await readFile(path.join(destination, "keep"), "utf8"), "existing destination");
  assert.deepEqual(await readdir(directory), ["occupied"]);
});
