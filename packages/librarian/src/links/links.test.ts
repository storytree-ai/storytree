/**
 * Capability 1 · Links: one test per contract 1.1-1.3 in the librarian story, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { link, unrestedDecisions } from "./index.js";

/** A story with one capability, and a decision on its shelf. */
async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Simplest API.", status: "accepted", frontCoverOf: capability.id });
  return { capability, cover };
}

/** A decision about the whole project: on no shelf. */
function wholeProject(library: Library, title: string) {
  return library.recordDecision({ title, text: `${title}, for every part of the project.`, status: "accepted" });
}

test("1.1 link makes a note rest on another, keeping its other links, and linking again writes nothing", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const tdd = await wholeProject(library, "Minimal viable TDD");
    const spec = await wholeProject(library, "The MVP spec");
    await library.editNote(cover.id, { links: [tdd.id] });

    await link(library, cover.id, spec.id);
    assert.deepEqual((await library.decision(cover.id))?.record.fields.links, [tdd.id, spec.id]);

    const { cursor } = await library.changesSince(0);
    await link(library, cover.id, spec.id);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("1.2 a definition rests only on a decision, and friction or a re-steer on nothing: other links are refused, naming the rule", async () => {
  await withLibrary(async (library) => {
    const decision = await wholeProject(library, "Arcs hold increments");
    const memory = await library.writeMemory({ text: "An increment is a slice of an arc." });
    const term = await library.defineTerm({ term: "increment", meaning: "One slice of work on an arc." });
    const other = await library.defineTerm({ term: "arc", meaning: "An initiative." });
    const friction = await library.writeKnowledge("friction", {
      title: "Seed refused while the app runs",
      description: "The seed cannot run with the app open.",
      statement: "pnpm seed:library refuses while the app holds its data directory.",
      evidence: "`pnpm seed:library` printed: Quit the app, then run `pnpm seed:library` again.",
      impact: "The library is not re-seeded until the owner quits the app.",
    });
    const { cursor } = await library.changesSince(0);

    await assert.rejects(link(library, term.id, other.id), /definition rests only on a decision/);
    await assert.rejects(link(library, term.id, memory.id), /definition rests only on a decision/);
    await assert.rejects(link(library, friction.id, decision.id), /friction rests on nothing/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await link(library, term.id, decision.id);
    assert.deepEqual((await library.search("slice of work"))[0]?.fields.links, [decision.id]);
  });
});

test("1.3 the worklist names each accepted decision on no shelf that no note rests on, and drops it once one does", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const spec = await wholeProject(library, "The MVP spec");
    const license = await wholeProject(library, "The license");

    assert.deepEqual((await unrestedDecisions(library)).map((decision) => decision.id), [spec.id, license.id]);

    await link(library, cover.id, spec.id);
    assert.deepEqual((await unrestedDecisions(library)).map((decision) => decision.id), [license.id]);
  });
});
