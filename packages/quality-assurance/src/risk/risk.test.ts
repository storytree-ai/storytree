/**
 * Capability 6 · Risk reading: contracts 6.1 and 6.2 on a small package graph held in memory, and 6.3 through the
 * `quality` verbs in a fresh project's library on the real Postgres `pnpm test` provides, over a checkout written to a
 * temporary folder.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { DoorWords } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { QUALITY_FAMILIES } from "../checks/verbs.js";
import { withLibrary } from "../testing/pg.js";
import { PackageGraph, readChange, readStory, type PackageNode } from "../index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

/** keys <- library <- app <- desktop, library <- website, and three helpers that use the library alone. */
const NODES: PackageNode[] = [
  { folder: "packages/keys", name: "@storytree/keys", deps: [] },
  { folder: "packages/library", name: "@storytree/library", deps: ["@storytree/keys", "zod"] },
  { folder: "packages/app", name: "@storytree/app", deps: ["@storytree/library"] },
  { folder: "apps/desktop", name: "@storytree/desktop", deps: ["@storytree/app", "@storytree/library"] },
  { folder: "packages/website", name: "@storytree/website", deps: ["@storytree/library"] },
  { folder: "packages/cli", name: "@storytree/cli", deps: ["@storytree/library"] },
  { folder: "packages/mark", name: "@storytree/mark", deps: [] },
];

const STORIES = [
  { id: "story_keys", title: "Keys" },
  { id: "story_library", title: "The library" },
  { id: "story_app", title: "App" },
  { id: "story_website", title: "Website" },
  { id: "story_cli", title: "CLI" },
];

const diff = (...files: [string, ...string[]][]) => files.map(([file, ...lines]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...lines].join("\n")).join("\n");

test("6.1 · A change's risk line is read from its diff and the package graph: depth from its paths and changed lines, radius from downstream reach and inherited audience, rating 2 x depth + radius, tier by the cut-offs, and the stories it touches", () => {
  const graph = new PackageGraph(NODES);

  // A plain edit to a helper nothing uses: depth 1, radius 1, low.
  assert.deepEqual(readChange(diff(["packages/mark/src/a.ts", "+export const a = 1;"]), graph, STORIES, "2026-10-24"), { tier: "low", rating: 3, depth: 1, radius: 1, flags: [], stories: [], read: "2026-10-24" });

  // A record write in the library: depth 2; four packages downstream reach radius 2, and the website's public audience, inherited, radius 3.
  const writes = readChange(diff(["packages/library/src/b.ts", "+  await sql`INSERT INTO notes VALUES (1)`;"]), graph, STORIES, "2026-10-24");
  assert.deepEqual(writes, { tier: "medium", rating: 7, depth: 2, radius: 3, flags: ["record writes"], stories: ["story_library"], read: "2026-10-24" });

  // Additive schema is depth 2; destructive schema, credentials and the release path are depth 3, so high at 8+.
  assert.equal(readChange(diff(["packages/cli/src/c.ts", "+CREATE TABLE IF NOT EXISTS t (id int)"]), graph, STORIES, "d").depth, 2);
  const dropped = readChange(diff(["packages/cli/src/c.ts", "-x", "+ALTER TABLE t DROP COLUMN name"]), graph, STORIES, "d");
  assert.deepEqual([dropped.depth, dropped.radius, dropped.rating, dropped.tier, dropped.flags], [3, 1, 7, "medium", ["destructive schema"]]);
  const release = readChange(diff(["packages/app/src/updates/install.ts", "+export const now = true;"]), graph, STORIES, "d");
  assert.deepEqual([release.depth, release.radius, release.rating, release.tier, release.flags, release.stories], [3, 2, 8, "high", ["release path", "screen"], ["story_app"]]);
  const creds = readChange(diff(["apps/desktop/src/main/k.ts", "+const t = process.env.GITHUB_TOKEN;"]), graph, STORIES, "d");
  assert.deepEqual([creds.depth, creds.tier, creds.flags, creds.stories], [3, "high", ["credentials", "screen"], ["story_app"]]);
  // The keys package itself holds credentials, whatever its lines say.
  assert.deepEqual(readChange(diff(["packages/keys/src/k.ts", "+export const k = 1;"]), graph, STORIES, "d").flags, ["credentials"]);

  // Tests, docs, the lockfile and evidence are skipped: the same SQL in them raises nothing.
  const skipped = readChange(diff(
    ["packages/cli/src/c.test.ts", "+DROP TABLE t"],
    ["packages/cli/README.md", "+DROP TABLE t"],
    ["pnpm-lock.yaml", "+DROP TABLE t"],
    ["apps/desktop/evidence/run.mjs", "+DROP TABLE t"],
  ), graph, STORIES, "d");
  assert.deepEqual([skipped.depth, skipped.radius, skipped.flags, skipped.stories], [1, 1, [], []]);
});

test("6.2 · Each story's standing risk reading is read from its package's code and its place in the graph: depth from its flags, radius from its downstream stories and the audience it serves or inherits, never its depth", () => {
  const graph = new PackageGraph(NODES);
  const code: Record<string, Map<string, string>> = {
    "packages/keys": new Map([["packages/keys/src/k.ts", "export const key = process.env.API_KEY;"]]),
    "packages/library": new Map([["packages/library/src/l.ts", "await sql`INSERT INTO notes VALUES (1)`;"]]),
    "packages/cli": new Map([["packages/cli/src/c.ts", "export const cli = 1;"]]),
  };
  const source = (folder: string) => code[folder] ?? new Map<string, string>();

  // The library: record writes are depth 2; four downstream; the website's public audience, inherited, radius 3.
  assert.deepEqual(readStory(STORIES[1]!, graph, source, "2026-10-24"), {
    depth: { value: 2, read: "2026-10-24", reason: "flags: record writes" },
    radius: { value: 3, downstream: 4, audience: "public", read: "2026-10-24", reason: "4 packages downstream; public users, inherited from packages/website" },
  });
  // Keys: credentials are depth 3; downstream of keys is everything but mark, and the audience is inherited too.
  const keys = readStory(STORIES[0]!, graph, source, "d")!;
  assert.deepEqual([keys.depth.value, keys.radius.downstream, keys.radius.audience], [3, 5, "public"]);
  // The app story owns packages/app and apps/desktop: invited users itself, nothing downstream beyond its own folders,
  // and it does not inherit the keys' depth: a screen is depth 2.
  const app = readStory(STORIES[2]!, graph, source, "d")!;
  assert.deepEqual([app.depth.value, app.depth.reason, app.radius.value, app.radius.downstream, app.radius.reason], [2, "flags: screen", 2, 0, "0 packages downstream; serves invited users itself"]);
  // The command line: no flag, nothing downstream, no audience.
  assert.deepEqual(readStory(STORIES[4]!, graph, source, "d"), {
    depth: { value: 1, read: "d", reason: "no depth flag in its code" },
    radius: { value: 1, downstream: 0, audience: "owner", read: "d", reason: "0 packages downstream; no audience of its own or downstream, so owner" },
  });
  // A story with no package in the graph has no reading.
  assert.equal(readStory({ id: "story_x", title: "Elsewhere" }, graph, source, "d"), undefined);
});

test("6.3 · `quality risk` writes an increment's risk line, and `quality story-risks` every story's reading, from the checkout's package graph, each run as a write so its history names the writer", async () => {
  const root = mkdtempSync(join(tmpdir(), "risk-"));
  try {
    for (const node of NODES) {
      mkdirSync(join(root, node.folder, "src"), { recursive: true });
      writeFileSync(join(root, node.folder, "package.json"), JSON.stringify({ name: node.name, dependencies: Object.fromEntries(node.deps.map((dep) => [dep, "workspace:*"])) }));
    }
    writeFileSync(join(root, "packages/library/src/l.ts"), "await sql`INSERT INTO notes VALUES (1)`;\n");
    writeFileSync(join(root, "packages/library/src/l.test.ts"), "DROP TABLE notes;\n");

    await withLibrary(async (library) => {
      const story = await library.addStory({ title: "The library" });
      const other = await library.addStory({ title: "Nowhere in this checkout" });
      const arc = await library.createArc({ title: "Risk", intent: "Read risk", endState: "Read", stories: [story.id] });
      const increment = await library.addIncrement({ arc: arc.id, title: "Notes", objective: "Write notes", body: "b", capabilities: [] });
      const context = { folder: root, library, project: library.name, session: "person:test" } as unknown as SessionVerbContext;
      const verbs = new Map(QUALITY_FAMILIES[0]!.verbs.map((one) => [(one.command as { name: string }).name, one]));
      assert.deepEqual([verbs.get("risk")!.writes, verbs.get("story-risks")!.writes], [true, true], "a door runs each as a write, handing it the session as writer");

      const wrote = await verbs.get("risk")!.act({ increment: increment.id, diff: diff(["packages/library/src/l.ts", "+await sql`DELETE FROM notes`;"]) }, context, WORDS);
      assert.match(wrote.text, /medium 7 · depth 2 · radius 3 · flags record writes/);
      const line = (await library.get(increment.id))!.fields as { risk?: { tier: string; rating: number; stories: string[] } };
      assert.deepEqual([line.risk?.tier, line.risk?.rating, line.risk?.stories], ["medium", 7, [story.id]]);

      const stories = await verbs.get("story-risks")!.act({}, context, WORDS);
      assert.match(stories.text, /^Wrote 1 stories' risk readings:/);
      const reading = (await library.get(story.id))!.fields as { risk?: { depth: { value: number; reason: string }; radius: { value: number; audience: string } } };
      // The test file's DROP TABLE is skipped: depth 2 from the record write.
      assert.deepEqual([reading.risk?.depth.value, reading.risk?.depth.reason, reading.risk?.radius.value, reading.risk?.radius.audience], [2, "flags: record writes", 3, "public"]);
      assert.equal(((await library.get(other.id))!.fields as { risk?: unknown }).risk, undefined);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("6.4 · `quality story-risks` writes no history for a story whose reading has not changed since its last run, whatever day it is read", async () => {
  const root = mkdtempSync(join(tmpdir(), "risk-"));
  try {
    for (const node of NODES) {
      mkdirSync(join(root, node.folder, "src"), { recursive: true });
      writeFileSync(join(root, node.folder, "package.json"), JSON.stringify({ name: node.name, dependencies: Object.fromEntries(node.deps.map((dep) => [dep, "workspace:*"])) }));
    }
    writeFileSync(join(root, "packages/library/src/l.ts"), "await sql`INSERT INTO notes VALUES (1)`;\n");

    await withLibrary(async (library) => {
      const story = await library.addStory({ title: "The library" });
      await library.createArc({ title: "Risk", intent: "Read risk", endState: "Read", stories: [story.id] });
      const context = { folder: root, library, project: library.name, session: "person:test" } as unknown as SessionVerbContext;
      const storyRisks = QUALITY_FAMILIES[0]!.verbs.find((one) => (one.command as { name: string }).name === "story-risks")!;
      const first = await storyRisks.act({}, context, WORDS);
      // A reading stored on another day, the same in all but its date, is unchanged too.
      const stored = (await library.get(story.id))!.fields as { risk: { depth: object; radius: object } };
      await library.editStory(story.id, { risk: { depth: { ...stored.risk.depth, read: "2026-01-01" }, radius: { ...stored.risk.radius, read: "2026-01-01" } } } as never, { actor: "person:test" });
      const before = (await library.history({ id: story.id })).length;

      const again = await storyRisks.act({}, context, WORDS);
      assert.equal((await library.history({ id: story.id })).length, before, "an unchanged reading is not written again");
      assert.match(again.text, /^Wrote 0 stories' risk readings, 1 unchanged:/);
      assert.deepEqual(again.text.split("\n").slice(1), first.text.split("\n").slice(1), "every story's line is still said, as the watcher diffs them");

      writeFileSync(join(root, "packages/library/src/m.ts"), "await sql`DROP TABLE notes`;\n");
      const changed = await storyRisks.act({}, context, WORDS);
      assert.match(changed.text, /^Wrote 1 stories' risk readings:/, `a changed reading is written: ${changed.text}`);
      assert.equal((await library.history({ id: story.id })).length, before + 1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
