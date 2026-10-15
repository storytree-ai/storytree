/**
 * Capability 6 · Make a folder a project: contract 6.12, an existing project moving onto the user's factory (ADR-1040).
 *
 * Each library is a throwaway project on the real Postgres `pnpm test` provides, named with uniqueProjectName()
 * and dropped afterwards, pass or fail. The project made before factories is stood in for by a seeded library.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect, type Library, type Storytree } from "@storytree/library";

import { moveOntoFactory } from "./factory-move.js";
import { PRINCIPLES } from "./starter-notes.js";
import { seedStarterPack } from "./starter-pack.js";

async function withStorytree(projects: readonly string[], body: (storytree: Storytree) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  try {
    await body(storytree);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestProjects(projects);
    }
  }
}

async function opened<T>(storytree: Storytree, project: string, read: (library: Library) => Promise<T>, create = false): Promise<T> {
  const library = await storytree.openProject(project, { create });
  try {
    return await read(library);
  } finally {
    await library.close();
  }
}

const principle = (title: string) => PRINCIPLES.find((note) => note.title === title)!;

test("6.12 moving an existing project onto the user's factory drops each copy of the system it holds unedited that the factory holds too, keeps each it edited or added as its own, and names the factory; links to a dropped copy read the factory's, moving again changes nothing, and a factory is refused", async () => {
  const [project, factory] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([project, factory], async (storytree) => {
    // A project set up before factories: the whole pack seeded, one principle and one role edited, one principle its own,
    // and one copy unedited from a pack that no longer carries it.
    const ids = await opened(storytree, project, async (library) => {
      await seedStarterPack(library);
      const notes = await library.list("principle");
      const id = (title: string) => notes.find((note) => note.fields.title === title)!.id;
      await library.editNote(id("Minimum to green"), { statement: "Our team's own statement." }, { actor: "session:the-user" });
      const role = (await library.list("agent")).find((agent) => agent.fields.title === "orchestrator")!;
      await library.editNote(role.id, { oneLine: "Our orchestrator." }, { actor: "session:the-user" });
      const added = await library.writeKnowledge("principle", { ...principle("Edit before adding"), title: "Name things plainly" }, { actor: "session:the-user" });
      const gone = await library.writeKnowledge("principle", { ...principle("Edit before adding"), title: "A note the pack dropped" }, { actor: "storytree setup (starter pack v2)" });
      const roleLinks = await Promise.all(role.fields.context.map(async (link) => [link, ((await library.get(link))!.fields as { title?: string }).title] as const));
      return { greenCopy: id("Minimum to green"), redCopy: id("Minimum test to red"), roleLinks, added: added.id, gone: gone.id };
    }, true);

    const moved = await moveOntoFactory({ storytree, project, factory });
    assert.equal(moved.factory, factory, "the factory is made the first time");
    const kept = moved.kept.map(({ kind, title, why }) => `${kind}: ${title} (${why})`).sort();
    assert.deepEqual(kept, ["agent: orchestrator (own)", "principle: A note the pack dropped (not in the factory)", "principle: Minimum to green (own)", "principle: Name things plainly (own)"]);
    const factoryHolds = await opened(storytree, factory, async (library) => (await Promise.all(["principle", "guardrail", "pattern", "process", "check", "agent"].map(async (kind) => (await library.list(kind as "principle")).length))).reduce((a, b) => a + b));
    assert.equal(moved.dropped.length, factoryHolds - 2, "every other copy is dropped: the factory holds the same pack");
    assert.ok(moved.dropped.some(({ kind, title, id }) => kind === "principle" && title === "Minimum test to red" && id === ids.redCopy));

    await opened(storytree, project, async (library) => {
      assert.deepEqual(await library.factory(), { kind: "product", factory });
      const statements = new Map((await library.list("principle")).map((note) => [note.fields.title, note]));
      assert.equal(statements.get("Minimum to green")?.id, ids.greenCopy, "the edited copy stays the project's own");
      assert.equal((statements.get("Minimum to green")?.fields as { statement: string }).statement, "Our team's own statement.");
      assert.notEqual(statements.get("Minimum test to red")?.id, ids.redCopy, "the unedited copy gives way to the factory's");
      assert.equal(statements.get("Name things plainly")?.id, ids.added);
      assert.equal(statements.get("A note the pack dropped")?.id, ids.gone);
      // The kept role still links the copies it was seeded with: each reads the factory's record now, or the project's own.
      const linked = await Promise.all(ids.roleLinks.map(async ([link]) => [link, ((await library.get(link))?.fields as { title?: string } | undefined)?.title] as const));
      assert.deepEqual(linked, ids.roleLinks, "each link of the kept role reads the note of the title it was written for");
      assert.equal((await library.get(ids.redCopy))?.id, statements.get("Minimum test to red")?.id);
      assert.equal((await library.get(ids.greenCopy))?.id, ids.greenCopy);
    });

    const again = await moveOntoFactory({ storytree, project, factory });
    assert.deepEqual({ factory: again.factory, dropped: again.dropped }, { factory, dropped: [] }, "moving again drops nothing more");
    assert.deepEqual(again.kept.map(({ title }) => title).sort(), moved.kept.map(({ title }) => title).sort());

    await assert.rejects(moveOntoFactory({ storytree, project: factory, factory }), /is the user's factory/);
  });
});
