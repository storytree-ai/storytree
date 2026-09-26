// The export's rules (scripts/library-export.mjs): a project in a library prints back as story and
// decision files in the repo's layout, and the round-trip check lists, section by section, each
// block a committed file holds that the printout does not, and each the printout adds. The test
// runs against the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), in a project of its own
// that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { exportLibrary, roundTrip } from "./library-export.mjs";
import { parseDecision, parseStory, syncDecisions, syncFoundingBooks, syncStory } from "./library-seed.mjs";

const STORY = [
  "# Story: the kettle",
  "",
  "**What it is.** The kettle boils water for one cup",
  "or for four.",
  "",
  "**Approved** by the owner on 2026-01-01, as drawn.",
  "",
  "Build order: 1 → 2.",
  "",
  "---",
  "",
  "## 1 · Heating",
  "",
  "The kettle heats the water in it to the boil.",
  "",
  "- **Depends on:** nothing in this story. It heats",
  "  through the base.",
  "- **Its shelf,** founding book first:",
  "  - **Founding book (H1):** it heats with one element,",
  "    under the base.",
  "  - A second element waits for a bigger kettle.",
  "- **As built:** one element, switched by a relay.",
  "",
  "**Contracts** (each one a test):",
  "1. Water in the kettle reaches 100 degrees.",
  "",
  "## 2 · Switching off",
  "",
  "It switches itself off at the boil.",
  "",
  "- **Depends on:** 1.",
  "",
  "**Contracts:**",
  "1. At the boil the kettle switches off.",
  "",
  "---",
  "",
  "## Also out of this story",
  "",
  "- **A whistle** is left out.",
  "",
].join("\n");

const DECISION = [
  "# The kettle is a story of its own",
  "",
  "- **Front cover of:** stories/kettle.md",
  "- **Full record:** ADR-0999 in storytree 0.2's decision log",
  "",
  "The kettle is its own story, apart from",
  "the cup.",
  "",
].join("\n");

test("a story and its decision print back from the library, and the round trip lists what only the files hold until it is filed as notes behind its covers", async () => {
  await withLibrary(async (library) => {
    const story = parseStory(STORY);
    const nodes = new Map([["stories/kettle.md", await syncStory(library, story, { source: "stories/kettle.md" })]]);
    const decisions = [parseDecision(DECISION)];
    await syncFoundingBooks(library, [{ file: "stories/kettle.md", story }], nodes, decisions);
    await syncDecisions(library, decisions, nodes);
    const committed = new Map([
      ["stories/kettle.md", STORY],
      ["decisions/kettle-own-story.md", DECISION],
    ]);

    const { cursor } = await library.changesSince(0);
    const before = roundTrip(committed, await exportLibrary(library));
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "the export writes nothing to the library");

    const brief = (blocks) => blocks.map(({ section, text }) => [section, text]);
    const story1 = before.find(({ file }) => file === "stories/kettle.md");
    assert.deepEqual(brief(story1.missing), [
      ["# Story: the kettle", "**Approved** by the owner on 2026-01-01, as drawn."],
      ["# Story: the kettle", "Build order: 1 → 2."],
      ["## 1 · Heating", "- **Depends on:** nothing in this story. It heats through the base."],
      ["## 1 · Heating", "  - A second element waits for a bigger kettle."],
      ["## 1 · Heating", "- **As built:** one element, switched by a relay."],
      ["## 1 · Heating", "**Contracts** (each one a test):"],
      ["## Also out of this story", "## Also out of this story"],
      ["## Also out of this story", "- **A whistle** is left out."],
    ]);
    assert.deepEqual(
      brief(story1.extra),
      [
        ["## 1 · Heating", "- **Depends on:** nothing in this story."],
        ["## 1 · Heating", "**Contracts:**"],
      ],
      "the story's outline, its founding book and its contracts print back as the file has them, but for the words the library has no place for",
    );
    assert.equal(story1.missing[4].words, 8, "words are counted without the markup");
    const decision = before.find(({ file }) => file === "decisions/kettle-own-story.md");
    assert.deepEqual([decision.missing, decision.extra], [[], []], "a decision prints back whole, found by its full record");

    // Placing each block as a memory note, its text the block as the file writes it: behind the
    // story's founding cover for an opening block or a closing `##` section, and behind the
    // capability's for a block of its section. A note starting with a line the export makes
    // (`- **Depends on:**`, `**Contracts**`) takes that line's place.
    const [storyCover] = await library.frontCovers((await library.projectTree()).stories[0].id);
    const [heating] = (await library.projectTree()).stories[0].capabilities;
    const [heatingCover] = await library.frontCovers(heating.id);
    const behind = (cover, text) => library.writeMemory({ text, links: [cover.id] });
    await behind(storyCover, "**Approved** by the owner on 2026-01-01, as drawn.");
    await behind(storyCover, "Build order: 1 → 2.");
    await behind(storyCover, "## Also out of this story\n\n- **A whistle** is left out.");
    await behind(heatingCover, "- **Depends on:** nothing in this story. It heats\n  through the base.");
    await behind(heatingCover, "  - A second element waits for a bigger kettle.");
    await behind(heatingCover, "- **As built:** one element, switched by a relay.");
    await behind(heatingCover, "**Contracts** (each one a test):");

    const printed = await exportLibrary(library);
    const after = roundTrip(committed, printed);
    assert.deepEqual(
      after.map(({ file, missing, extra }) => [file, missing.length, extra.length]),
      [["stories/kettle.md", 0, 0], ["decisions/kettle-own-story.md", 0, 0]],
    );
    const text = printed.get("stories/kettle.md");
    assert.ok(
      text.indexOf("**Approved**") < text.indexOf("## 1 · Heating") &&
        text.indexOf("through the base.") < text.indexOf("**Its shelf,**") &&
        text.indexOf("(each one a test):\n1. Water") > text.indexOf("**As built:**") &&
        text.indexOf("A second element") < text.indexOf("**As built:**") &&
        text.indexOf("## 2 · Switching off") < text.indexOf("## Also out of this story"),
      `each note prints in its place:\n${text}`,
    );
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
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
