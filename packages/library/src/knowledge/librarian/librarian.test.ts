import assert from "node:assert/strict";
import { test } from "node:test";

import { withLibrary } from "./testing/pg.js";
import { LibrarianRefusal, link, retire } from "./index.js";

test("35.1 · through the librarian entry, link and retire refuse an id no live note carries with a librarian refusal naming that id, and nothing is written", async () => {
  await withLibrary(async (library) => {
    const note = await library.defineTerm({ term: "Mailer", meaning: "Sends the confirmation." });
    const gone = await library.defineTerm({ term: "Courier", meaning: "Soon retired." });
    await library.retire(gone.id, "retired");
    const missing = "decision_000000000000";
    const refusedNaming = (id: string) => (error: unknown) => error instanceof LibrarianRefusal && error.message.includes(id);
    const { cursor } = await library.changesSince(0);

    await assert.rejects(link(library, note.id, gone.id), refusedNaming(gone.id));
    await assert.rejects(link(library, missing, note.id), refusedNaming(missing));
    await assert.rejects(retire(library, gone.id, "retired again"), refusedNaming(gone.id));
    await assert.rejects(retire(library, missing, "never there"), refusedNaming(missing));

    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});
