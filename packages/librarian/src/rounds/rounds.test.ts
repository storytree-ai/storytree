/**
 * Capability 6 · Rounds: contracts 6.1-6.2 in stories/librarian.md, each in a fresh project's
 * library on the real Postgres `pnpm test` provides. Contracts 6.3-6.5 need the agent link's
 * registration point (ADR-0643 D6), which has not landed.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { withLibrary } from "../testing/pg.js";
import { roundDue, worklist } from "./index.js";

test("6.1 the trigger fires on a write to a curated kind since the session started, and when there is no start; graduation is due either way", async () => {
  await withLibrary(async (library) => {
    const { cursor: start } = await library.changesSince(0);
    await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: false });

    await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: true });
    assert.deepEqual(await roundDue(library, {}), { graduation: true, rest: true });
  });
});

test("6.2 the worklist gathers each capability's list: graduation's always, the rest only when the trigger fired", async () => {
  await withLibrary(async (library) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
    const folder = path.join(root, "memory");
    mkdirSync(folder);
    const memory = path.join(folder, "seed.md");
    writeFileSync(memory, "---\nname: seed\ndescription: Close the app first.\n---\n\nRun the seed with the app closed.\n");
    try {
      const spec = await library.recordDecision({ title: "The MVP spec", text: "One page.", status: "accepted" });
      const { cursor } = await library.changesSince(0);
      await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });

      const quiet = await worklist(library, { since: cursor, memoryFolders: [folder] });
      assert.deepEqual(quiet.graduation.map((item) => item.file), [memory]);
      assert.equal(quiet.rest, undefined);

      const fired = await worklist(library, { since: 0, memoryFolders: [folder], branch: "claude/me" });
      assert.deepEqual(fired.graduation.map((item) => item.file), [memory]);
      assert.deepEqual(fired.rest?.links.map((decision) => decision.id), [spec.id]);
      assert.deepEqual(fired.rest?.health, []);
      assert.ok(fired.rest?.catalogue.some(({ note }) => note.id === spec.id));
      assert.deepEqual(fired.rest?.questions, []);
      assert.deepEqual(fired.rest?.friction, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
