// Moving the story text only the files hold into the library (scripts/library-move.mjs, ADR-0641 D2
// step 2): each block the round trip lists as missing becomes a memory note behind its node's
// first front cover, in file order, so the export prints it back in place. The test runs against
// the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), in a project of its own that is
// dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { exportLibrary, roundTrip } from "./library-export.mjs";
import { moveStoryText } from "./library-move.mjs";
import { parseStory, syncFoundingBooks, syncStory } from "./library-seed.mjs";

const STORY = [
  "# Story: the kettle",
  "",
  "**What it is.** The kettle boils water for one cup",
  "or for four.",
  "",
  "**Approved** by the owner on 2026-01-01, as drawn.",
  "",
  "```mermaid",
  "flowchart BT",
  "  S --> H",
  "```",
  "",
  "Build order: 1 → 2 → 3.",
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
  "  - The relay clicks.",
  "",
  "A paragraph about the element.",
  "",
  "**Contracts** (each one a test):",
  "1. Water in the kettle reaches 100 degrees.",
  "",
  "## 2 · Switching off",
  "",
  "It switches itself off at the boil.",
  "",
  "- **Depends on:** 1.",
  "- **Its shelf,** founding book first:",
  "  - **Founding book (S1):** a bimetal strip, no electronics.",
  "- **Leaves out:** a timer.",
  "",
  "**Contracts:**",
  "1. At the boil the kettle switches off.",
  "",
  "## 3 · Pouring",
  "",
  "It pours without dripping.",
  "",
  "- **Depends on:** 1.",
  "- **As built:** a spout with a lip.",
  "",
  "**Contracts:**",
  "1. Pouring a cup leaves no drip.",
  "",
  "---",
  "",
  "## Also out of this story",
  "",
  "- **A whistle** is left out.",
  "- **A light** is left out,",
  "  for now.",
  "",
].join("\n");

/** The kettle seeded as `pnpm seed:library` would: its outline, its founding books, and a decision covering the story. */
async function seedKettle(library) {
  const story = parseStory(STORY);
  const nodes = new Map([["stories/kettle.md", await syncStory(library, story, { source: "stories/kettle.md" })]]);
  await syncFoundingBooks(library, [{ file: "stories/kettle.md", story }], nodes, []);
  const tree = await library.projectTree();
  await library.recordDecision({ title: "The kettle is a story of its own", text: "It is.", status: "accepted", frontCoverOf: tree.stories[0].id });
  return tree;
}

test("each block only the file holds is filed as a definition behind its node's cover, in file order, so the round trip is empty but for a node with no cover, which is named and gets nothing", async () => {
  await withLibrary(async (library) => {
    const tree = await seedKettle(library);
    const committed = new Map([["stories/kettle.md", STORY]]);

    const moved = await moveStoryText(library, committed);

    const [heating, switching] = tree.stories[0].capabilities;
    const [heatingBook] = await library.frontCovers(heating.id);
    const [switchingBook] = await library.frontCovers(switching.id);
    const [storyCover] = await library.frontCovers(tree.stories[0].id);
    assert.deepEqual(
      moved.filed.map(({ cover, text }) => [cover, text]),
      [
        [storyCover.id, "**Approved** by the owner on 2026-01-01, as drawn."],
        [storyCover.id, "```mermaid\nflowchart BT\n  S --> H\n```"],
        [storyCover.id, "Build order: 1 → 2 → 3."],
        [heatingBook.id, "- **Depends on:** nothing in this story. It heats\n  through the base."],
        [heatingBook.id, "  - A second element waits for a bigger kettle."],
        [heatingBook.id, "- **As built:** one element, switched by a relay."],
        [heatingBook.id, "  - The relay clicks."],
        [heatingBook.id, "A paragraph about the element."],
        [heatingBook.id, "**Contracts** (each one a test):"],
        [switchingBook.id, "- **Leaves out:** a timer."],
        [storyCover.id, "## Also out of this story\n\n- **A whistle** is left out.\n- **A light** is left out,\n  for now."],
      ],
      "each block verbatim, behind the story's cover or its capability's first book, a closing section whole",
    );
    assert.deepEqual(
      moved.unplaced.map(({ section, text, why }) => [section, text, why]),
      [["## 3 · Pouring", "- **As built:** a spout with a lip.", "3 · Pouring has no front cover to file it behind"]],
      "a block whose node has no cover is named, and nothing is filed for it",
    );
    const definitions = (await library.search("")).filter(({ type }) => type === "definition");
    assert.equal(definitions.length, moved.filed.length, "one definition per block filed, and nothing else");
    assert.ok(!definitions.some(({ fields }) => fields.meaning.includes("spout")), "the unplaced block is not written");

    const printed = await exportLibrary(library);
    assert.deepEqual(
      roundTrip(committed, printed)
        .filter(({ file }) => file === "stories/kettle.md")
        .flatMap(({ missing, extra }) => [...missing, ...extra])
        .map(({ section, text }) => [section, text]),
      [["## 3 · Pouring", "- **As built:** a spout with a lip."]],
      "the round trip is empty but for the unplaced block",
    );
    const text = printed.get("stories/kettle.md");
    const order = [
      "**Approved**",
      "```mermaid",
      "Build order",
      "## 1 · Heating",
      "**Its shelf,**",
      "A second element",
      "**As built:** one element",
      "The relay clicks",
      "A paragraph about",
      "(each one a test):\n1. Water",
      "## 2 · Switching off",
      "**Leaves out:** a timer",
      "## 3 · Pouring",
      "## Also out of this story",
    ];
    const at = order.map((part) => text.indexOf(part));
    assert.ok(at.every((index) => index >= 0), `every part prints:\n${text}`);
    assert.deepEqual(at, [...at].sort((a, b) => a - b), `the notes print in file order:\n${text}`);

    const again = await moveStoryText(library, committed);
    assert.deepEqual([again.filed.length, again.unplaced.length], [0, 1], "a second run files nothing");
    assert.equal((await library.search("")).filter(({ type }) => type === "definition").length, definitions.length);
  });
});

test("with dryRun the move says what it would file and writes nothing", async () => {
  await withLibrary(async (library) => {
    await seedKettle(library);
    const { cursor } = await library.changesSince(0);
    const moved = await moveStoryText(library, new Map([["stories/kettle.md", STORY]]), { dryRun: true });
    assert.equal(moved.filed.length, 11, "it lists what it would file");
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "and writes nothing");
  });
});

test("a story the library does not hold has every block named as unplaced, and nothing is written", async () => {
  await withLibrary(async (library) => {
    const moved = await moveStoryText(library, new Map([["stories/kettle.md", STORY]]));
    assert.equal(moved.filed.length, 0);
    assert.ok(moved.unplaced.length > 0);
    assert.ok(
      moved.unplaced.every(({ why }) => why === 'the library has no story "the kettle"'),
      JSON.stringify(moved.unplaced[0]),
    );
    assert.deepEqual(await library.search(""), []);
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
