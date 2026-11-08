import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { removeTemp } from "@storytree/test-waits";

import { freshSeed, seedHolding } from "./fresh-seed.js";
import type { CaptureSeed } from "./runner.js";

test("2.52 · a capture naming islands the shared code-rows seed lacks builds a fresh seed and survey from the library into a scratch folder, never over the committed seed", async t => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  const checkout = mkdtempSync(path.join(tmpdir(), "storytree-fresh-seed-checkout-"));
  const made: string[] = [];
  t.after(async () => {
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
    for (const folder of [checkout, ...made]) await removeTemp(folder);
  });
  // This checkout's code: the newer island's package holds one file.
  mkdirSync(path.join(checkout, "packages/code-map/src"), { recursive: true });
  writeFileSync(path.join(checkout, "packages/code-map/src/rows.ts"), "export const rows = 1;\n");
  // The library has moved on from the committed snapshot: a newer island, and an older one renamed twice.
  const library = await storytree.openProject(project);
  const library0 = await library.addStory({ title: "The library" });
  const codeMap = await library.addStory({ title: "Code map" });
  await library.editStory(library0.id, { title: "The library, renamed" });
  await library.editStory(library0.id, { title: "The library" });
  const committed = { seed: { projects: [project], tree: { stories: [{ id: library0.id, title: "The library" }] } } as unknown as CaptureSeed, survey: {} };
  let built = 0;
  const fresh = async () => {
    built++;
    const pair = await freshSeed({ storytree, project, checkout });
    made.push(pair.folder);
    return pair;
  };

  const held = await seedHolding(["the library"], { committed: () => committed, fresh });
  assert.equal(held.seed, committed.seed, "islands the committed seed holds are captured from it");
  assert.equal((await seedHolding([library0.id], { committed: () => committed, fresh })).seed, committed.seed, "named by story id too");
  assert.equal(built, 0, "and nothing is read from the library");

  const newer = await seedHolding(["Code map"], { committed: () => committed, fresh });
  assert.equal(built, 1, "an island the committed seed lacks builds a fresh seed");
  assert.deepEqual(newer.seed.tree.stories.map(story => story.title).toSorted(), ["Code map", "The library"], "from the library's own stories");
  assert.deepEqual(newer.seed.projects, [project]);
  const folder = made[0]!;
  assert.ok(folder.startsWith(tmpdir()) && !folder.startsWith(checkout), "written to a scratch folder, not into the checkout");
  assert.deepEqual(JSON.parse(gunzipSync(readFileSync(path.join(folder, "seed.json.gz"))).toString("utf8")).tree.stories.length, 2, "the seed is kept there as the committed one is");
  assert.deepEqual(newer.survey?.[codeMap.id]?.files.map(file => file.path), ["src/rows.ts"], "with a code survey read from this checkout");
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, "survey.json"), "utf8")), newer.survey, "kept beside it");
  assert.deepEqual(newer.seed.changes.changes.filter(change => change.recordId === library0.id).map(change => [change.action, change.record.fields.title]),
    [["created", "The library"], ["updated", "The library"]], "each record's creation and only its latest later change, as the committed seed is folded");

  await assert.rejects(seedHolding(["Nowhere"], { committed: () => committed, fresh }), /no story titled or named Nowhere.*Code map/,
    "an island the library lacks too fails, naming the stories it has");
});
