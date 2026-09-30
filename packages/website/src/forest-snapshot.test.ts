import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { saveForestSnapshot, forestSnapshot } from "./forest-snapshot.js";

const health = { reported: { state: "passing" }, verified: { state: "not-checked" } } as const;
const plan = {
  arcs: [],
  stories: [{ id: "story_example", title: "Example", description: "PRIVATE_DESCRIPTION", health,
    capabilities: [{ id: "capability_example", title: "A capability", dependsOn: [], proposed: false,
      status: "untested", health, contracts: [{ id: "contract_example", title: "Works", health }],
      credential: "PRIVATE_CREDENTIAL", session: "PRIVATE_SESSION", path: "PRIVATE_PATH" }],
  }],
} as AnnotatedTree;
const states = { part: () => "landed" as const, story: () => "landed" as const };

test("3.1 · refresh saves only public drawing fields with capture time and agent-reported forms", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "website-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "forest.json");
  const capturedAt = "2026-09-30T00:00:00.000Z";
  const snapshot = forestSnapshot(plan, [], states, capturedAt);
  await saveForestSnapshot(file, async () => snapshot);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.capturedAt, capturedAt);
  assert.equal(saved.scene.islands[0].story, "story_example");
  assert.equal(saved.scene.islands[0].trees[0].capability, "capability_example");
  assert.equal(saved.scene.islands[0].trees[0].form, "green");
  assert.deepEqual(saved.spots[0], ["story_example", { x: 0, y: 0, z: 1 }]);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_|verified|credential|session|description/);
});

test("3.2 · a failed refresh leaves the last saved scene byte-for-byte intact", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "website-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "forest.json");
  const before = JSON.stringify(forestSnapshot(plan, [], states, "2026-09-30T00:00:00.000Z"));
  await writeFile(file, before);
  await assert.rejects(saveForestSnapshot(file, async () => { throw new Error("library offline"); }), /library offline/);
  assert.equal(await readFile(file, "utf8"), before);
});
