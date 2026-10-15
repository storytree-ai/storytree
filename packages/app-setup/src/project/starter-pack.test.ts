/**
 * Capability 6 · Make a folder a project: contract 6.9, a project an earlier starter pack seeded taking the newer one,
 * or a product project holding no copy of it taking it into its factory.
 *
 * Each library is a throwaway project on the real Postgres `pnpm test` provides, named with uniqueProjectName()
 * and dropped afterwards, pass or fail. The earlier pack is stood in for by records written under its actor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect, type Library } from "@storytree/library";

import { PRINCIPLES } from "./starter-notes.js";
import { seedStarterPack, STARTER_PACK_VERSION, starterPackStatus, takeStarterPack } from "./starter-pack.js";

/** Who the history says wrote a record when version 1 of the pack seeded it. */
const V1 = { actor: "storytree setup (starter pack v1)" };

const KINDS = ["principle", "guardrail", "pattern", "process", "check", "agent"] as const;

/** Every live pack-kind record `library` holds, as `kind: title`, sorted. */
async function held(library: Library): Promise<string[]> {
  return (await Promise.all(KINDS.map(async (kind) => (await library.list(kind)).map((record) => `${kind}: ${record.fields.title}`)))).flat().sort();
}

const principle = (title: string) => PRINCIPLES.find((note) => note.title === title)!;

test("6.9 taking a newer starter pack adds what the library lacks, replaces a pack record its user has not edited, and leaves an edited one as it is, named with the newer text beside it; taking it again writes nothing", async () => {
  const [project, fresh] = [uniqueProjectName(), uniqueProjectName()];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const seededFresh = await storytree.openProject(fresh);
    await seedStarterPack(seededFresh);
    const whole = await held(seededFresh);
    await seededFresh.close();

    const library = await storytree.openProject(project);
    try {
      // As version 1 left them: one principle whose text the pack has since changed, one its user edited since, one unchanged.
      const changed = await library.writeKnowledge("principle", { ...principle("Minimum to green"), statement: "Write the least code that passes." }, V1);
      const edited = await library.writeKnowledge("principle", { ...principle("Minimum test to red"), why: "A test never seen failing may test nothing." }, V1);
      await library.editNote(edited.id, { why: "Our team's own reason." }, { actor: "session:the-user" });
      const same = await library.writeKnowledge("principle", principle("Edit before adding"), V1);

      const took = await takeStarterPack(library);
      assert.deepEqual(took.replaced.map(({ kind, title, id }) => ({ kind, title, id })), [{ kind: "principle", title: "Minimum to green", id: changed.id }]);
      assert.deepEqual(took.kept, [{ kind: "principle", title: "Minimum test to red", id: edited.id, newer: principle("Minimum test to red") }]);
      assert.equal(took.added.length, whole.length - 3, "every other pack record is added");
      assert.deepEqual(await held(library), whole, "the library now holds what a fresh setup seeds, with no second copy");

      assert.equal(((await library.get(changed.id))?.fields as { statement?: string } | undefined)?.statement, "Write the least code that makes the failing test pass, then stop and land it.","the unedited record now carries the newer text");
      assert.equal(((await library.get(edited.id))?.fields as { why?: string } | undefined)?.why, "Our team's own reason.", "the user's edit stands");
      assert.equal((await library.history({ id: same.id })).length, 1, "a record already matching the newer pack is not rewritten");
      const replacedBy = (await library.history({ id: changed.id })).at(-1)?.actor;
      assert.match(replacedBy ?? "", /^storytree setup \(starter pack v\d+\)$/, "the replacement is the pack's, so a later pack may replace it again");
      assert.notEqual(replacedBy, V1.actor);

      const before = await library.history();
      const again = await takeStarterPack(library);
      assert.deepEqual({ added: again.added, replaced: again.replaced }, { added: [], replaced: [] });
      assert.deepEqual(again.kept.map(({ id }) => id), [edited.id], "the edited record is named again, still left as it is");
      assert.deepEqual(await library.history(), before, "taking it again writes nothing");
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProjects([project, fresh]);
  }
});

test("6.9 a product project holding no copy of the pack is offered and takes the newer pack into its factory, writing nothing of its own", async () => {
  const [factory, product, fresh] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const seededFresh = await storytree.openProject(fresh);
    await seedStarterPack(seededFresh);
    const whole = await held(seededFresh);
    await seededFresh.close();

    const made = await storytree.openProject(factory);
    await made.markFactory();
    // Version 1 seeded the factory: one principle whose text the pack has since changed.
    const changed = await made.writeKnowledge("principle", { ...principle("Minimum to green"), statement: "Write the least code that passes." }, V1);
    await made.close();
    const built = await storytree.openProject(product);
    await built.recordFactory(factory);
    await built.close();
    const library = await storytree.openProject(product);
    try {
      assert.deepEqual(await starterPackStatus(library, storytree), { seeded: 1, current: STARTER_PACK_VERSION, offered: true, factory });

      const took = await takeStarterPack(library, storytree);
      assert.equal(took.factory, factory);
      assert.deepEqual(took.replaced.map(({ kind, title, id }) => ({ kind, title, id })), [{ kind: "principle", title: "Minimum to green", id: changed.id }]);
      assert.equal(took.added.length, whole.length - 1, "every other pack record is added to the factory");
      assert.deepEqual(await library.history(), [], "the product writes nothing of its own");
      assert.deepEqual(await held(library), whole, "the product reads the whole pack through its factory");
      assert.deepEqual(await starterPackStatus(library, storytree), { seeded: STARTER_PACK_VERSION, current: STARTER_PACK_VERSION, offered: false, factory });
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProjects([factory, product, fresh]);
  }
});
