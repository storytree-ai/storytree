// The export's rules (packages/dev-loop/src/library-export.mjs): a project in a library prints as read-only story
// and decision files, each story block in its place, and printing writes nothing to the library. The test
// builds its project through the library's public API, as 0.3's own sessions now write stories, and
// runs against the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), in a project of its own
// that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { writeExport } from "./export-library.mjs";
import { exportLibrary } from "./library-export.mjs";

test("5.2 the export's files replace the stories and decisions folders, so a story no longer in the library leaves no file behind", (t) => {
  const out = mkdtempSync(path.join(tmpdir(), "library-export-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(path.join(out, "stories"));
  writeFileSync(path.join(out, "stories", "gone.md"), "an old story\n");
  writeExport(new Map([["stories/kettle.md", "# Story: the kettle\n"], ["decisions/adr-0999.md", "# ADR-0999\n"]]), out);
  assert.equal(readFileSync(path.join(out, "stories", "kettle.md"), "utf8"), "# Story: the kettle\n");
  assert.equal(readFileSync(path.join(out, "decisions", "adr-0999.md"), "utf8"), "# ADR-0999\n");
  assert.equal(existsSync(path.join(out, "stories", "gone.md")), false);
});

test("5.2 a story and its decisions print as files, each story block in its place and in the order it was written, even when blocks share a millisecond, and printing writes nothing to the library", async (t) => {
  await withLibrary(async (library) => {
    const story = await library.addStory({ title: "The kettle", description: "The kettle boils water." });
    const heating = await library.addCapability({ story: story.id, title: "1 · Heating", description: "It heats the water." });
    const switching = await library.addCapability({ story: story.id, title: "2 · Switching off", description: "It switches off.", dependsOn: [heating.id] });
    await library.addContract({ capability: heating.id, title: "1.1 · Water reaches 100 degrees" });
    await library.addContract({ capability: switching.id, title: "2.1 · At the boil it switches off" });
    const storyCover = await library.recordDecision({
      title: "The kettle is a story of its own",
      text: "It is, apart from the cup.\n\nFull record: ADR-0999 in storytree 0.2's decision log.",
      status: "accepted",
      frontCoverOf: story.id,
    });
    const book = await library.recordDecision({
      title: "1 · Heating: founding book (H1)",
      text: "it heats with one element.\n\nFounding book of stories/kettle.md, capability 1.",
      status: "accepted",
      frontCoverOf: heating.id,
    });
    await library.recordDecision({ title: "The whole project is PolyForm", text: "It is.\n\nFull record: ADR-0998 in storytree 0.2's decision log.", status: "accepted" });
    const behind = (cover, text) => library.defineTerm({ term: `Story text: ${cover.fields.title}`, meaning: text, links: [cover.id] });
    // A fast database can save several blocks in one millisecond, where creation order falls back to random ids. Exercise that tie on every run.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    await behind(storyCover, "**Approved** by the owner on 2026-01-01, as drawn.");
    await behind(storyCover, "## Also out of this story\n\n- **A whistle** is left out.");
    await behind(book, "- **Depends on:** nothing in this story. It heats\n  through the base.");
    await behind(book, "  - A second element waits for a bigger kettle.");
    await behind(book, "- **As built:** one element, switched by a relay.");
    await behind(book, "A paragraph about the element.");
    await behind(book, "**Contracts** (each one a test):");
    t.mock.timers.reset();
    await library.defineTerm({ term: "Relay", meaning: "An electrical switch.", links: [book.id] }); // not a story block

    const { cursor } = await library.changesSince(0);
    const printed = await exportLibrary(library);
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "the export writes nothing to the library");

    assert.deepEqual([...printed.keys()].sort(), ["decisions/adr-0998.md", "decisions/adr-0999.md", "stories/kettle.md"]);
    assert.equal(
      printed.get("stories/kettle.md"),
      [
        "# Story: the kettle",
        "",
        "**What it is.** The kettle boils water.",
        "",
        "**Approved** by the owner on 2026-01-01, as drawn.",
        "",
        "---",
        "",
        "## 1 · Heating",
        "",
        "It heats the water.",
        "",
        "- **Depends on:** nothing in this story. It heats",
        "  through the base.",
        "- **Its shelf,** founding book first:",
        "  - **Founding book (H1):** it heats with one element.",
        "  - A second element waits for a bigger kettle.",
        "- **As built:** one element, switched by a relay.",
        "",
        "A paragraph about the element.",
        "",
        "**Contracts** (each one a test):",
        "1. Water reaches 100 degrees",
        "",
        "## 2 · Switching off",
        "",
        "It switches off.",
        "",
        "- **Depends on:** 1.",
        "",
        "**Contracts:**",
        "1. At the boil it switches off",
        "",
        "---",
        "",
        "## Also out of this story",
        "",
        "- **A whistle** is left out.",
        "",
      ].join("\n"),
    );
    assert.equal(
      printed.get("decisions/adr-0999.md"),
      "# The kettle is a story of its own\n\n- **Front cover of:** stories/kettle.md\n- **Full record:** ADR-0999 in storytree 0.2's decision log\n\nIt is, apart from the cup.\n",
    );
    assert.match(printed.get("decisions/adr-0998.md"), /^- \*\*Front cover of:\*\* none$/m, "a decision on no shelf says so");
  });
});

/** Run `body` with a library for a fresh project on the test server, dropped afterwards, pass or fail. */
async function withLibrary(body) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const lib = await storytree.openProject(name);
    try {
      await body(lib);
    } finally {
      await lib.close();
    }
  } finally {
    await storytree.close();
    const admin = new pg.Client({ connectionString: process.env.STORYTREE_TEST_PG_ADMIN_URL || url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
