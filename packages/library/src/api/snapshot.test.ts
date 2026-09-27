/**
 * Capability 1 · Project libraries, contracts 1.6 to 1.8 (the library story): a project's
 * snapshot, and restoring one only into an empty project (ADR-0641 D2 step 4, choice B1). Through
 * the public API, against the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { connect, RestoreRefusedError, type Library, type Storytree } from "../index.js";

async function withServer(projects: readonly string[], body: (storytree: Storytree) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  try {
    await body(storytree);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases(projects.map((name) => `storytree_${name}`));
    }
  }
}

/** A small project: a story with a capability and a contract, a decision, a memory note, an edit, a retirement and an actor. */
async function fill(library: Library): Promise<void> {
  const story = await library.addStory({ title: "The kettle", description: "It boils water." }, { actor: "tester" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Heating" });
  await library.addContract({ capability: capability.id, title: "1.1 · It reaches the boil" });
  const decision = await library.recordDecision({ title: "One element", text: "It heats with one element.", status: "accepted", frontCoverOf: capability.id });
  const note = await library.defineTerm({ term: "Delivery", meaning: "The relay clicks.", links: [decision.id] });
  await library.editNote(note.id, { meaning: "The relay clicks twice." });
  const gone = await library.defineTerm({ term: "Delivery", meaning: "A whistle, left out.", links: [decision.id] });
  await library.retire(gone.id, "not in this kettle");
}

test("1.6 snapshot returns every record of the project and its whole history, as they stood at one moment", async () => {
  const name = uniqueProjectName();
  await withServer([name], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const history = await library.history();
    const live = (await library.search("")).map(({ id }) => id).sort();

    const snapshot = await storytree.snapshot(name);

    assert.equal(snapshot.project, name);
    assert.deepEqual(snapshot.history.map(({ seq }) => seq), history.map(({ seq }) => seq), "the whole history, in order");
    assert.ok(snapshot.history.some(({ action, actor }) => action === "retired") && snapshot.history.some(({ actor }) => actor === "tester"));
    const ids = snapshot.records.map(({ id }) => id);
    for (const id of live) assert.ok(ids.includes(id), `the live note ${id} is in the snapshot`);
    assert.ok(!snapshot.records.some(({ fields }) => JSON.stringify(fields).includes("whistle")), "a retired record is only in the history");
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot, "a snapshot is plain data, as a file holds it");

    // Taken while another write lands, it reads one moment: every record it holds has its history.
    const [during] = await Promise.all([storytree.snapshot(name), library.defineTerm({ term: "Delivery", meaning: "Written during the snapshot." })]);
    const recorded = new Set(during.history.map(({ recordId }) => recordId));
    assert.ok(during.records.every(({ id }) => recorded.has(id)), "no record without its history");
    await library.close();
  });
});

test("1.7 restore into an empty project gives back the same records and history, and the next write continues after them", async () => {
  const [name, copy] = [uniqueProjectName(), uniqueProjectName()];
  await withServer([name, copy], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const snapshot = await storytree.snapshot(name);

    await storytree.restore(copy, snapshot);

    const restored = await storytree.openProject(copy);
    const again = await storytree.snapshot(copy);
    assert.deepEqual(again.records, snapshot.records, "the same records");
    assert.deepEqual(again.history, snapshot.history, "the same history: sequence numbers, actors, reasons and times");
    assert.deepEqual(await restored.projectTree(), await library.projectTree());
    const last = snapshot.history.at(-1)?.seq ?? 0;
    const next = await restored.defineTerm({ term: "Delivery", meaning: "After the restore." });
    const [entry] = await restored.history({ id: next.id });
    assert.ok(entry !== undefined && entry.seq > last, `the next write continues after ${last}, got ${entry?.seq}`);
    await library.close();
    await restored.close();
  });
});

test("1.8 restoring into a project that holds any record or history is refused, naming it, and writes nothing", async () => {
  const [name, busy] = [uniqueProjectName(), uniqueProjectName()];
  await withServer([name, busy], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const snapshot = await storytree.snapshot(name);

    // The project restored from holds records: restoring over it would overwrite live edits.
    await assert.rejects(storytree.restore(name, snapshot), (error: unknown) => error instanceof RestoreRefusedError && error.message.includes(name));

    // A project whose one record was retired still has history, so it is not empty either.
    const other = await storytree.openProject(busy);
    const note = await other.defineTerm({ term: "Delivery", meaning: "Soon gone." });
    await other.retire(note.id, "retired");
    const before = await storytree.snapshot(busy);
    await assert.rejects(storytree.restore(busy, snapshot), (error: unknown) => error instanceof RestoreRefusedError && error.message.includes(busy));
    assert.deepEqual(await storytree.snapshot(busy).then(({ records, history }) => ({ records, history })), { records: before.records, history: before.history }, "nothing written");
    await library.close();
    await other.close();
  });
});
