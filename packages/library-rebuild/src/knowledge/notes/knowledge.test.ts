import assert from "node:assert/strict";
import { test } from "node:test";

import { withCountedProject } from "../../testing/pg.js";
import { Knowledge } from "./index.js";

test("33.1 · through the notes-and-search entry, a saved note is found by search on a word it holds and by rank on its words, saying why when no embedding model is available; a decision saved as a capability's front cover is listed among its front covers", async () => {
  await withCountedProject(async (project) => {
    const knowledge = new Knowledge(project.records, undefined, {
      embedder: async () => {
        throw new Error("the embedding model is switched off");
      },
    });
    const mailer = await knowledge.defineTerm({ term: "Mailer", meaning: "The mailer needs a verified sender." });
    await knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });

    assert.deepEqual((await knowledge.search("verified")).map(({ id }) => id), [mailer.id]);
    const ranked = await knowledge.rank("verified sender");
    assert.equal(ranked.by, "words");
    assert.match(ranked.why ?? "", /switched off/);
    assert.deepEqual(ranked.hits.map(({ note }) => note.id), [mailer.id]);

    const story = await project.records.create("story", { title: "Visitor can sign up" });
    const capability = await project.records.create("capability", { title: "Email form", story: story.id, proposed: true });
    await knowledge.recordDecision({ title: "Queue the mail", text: "Mail goes through a queue.", status: "accepted" });
    const cover = await knowledge.recordDecision({ title: "Check the address on the server", text: "The server checks it.", status: "accepted", frontCoverOf: capability.id });
    assert.deepEqual((await knowledge.frontCovers(capability.id)).map(({ id }) => id), [cover.id]);
  });
});
