// The seed's rules (scripts/library-seed.mjs): how stories/library.md becomes a story, capabilities
// and contracts, how a test run's results become each contract's verified health, how a decision
// file becomes a front cover of the story or capability it names, and that writing them to a
// library is idempotent. The parsing and judging tests are pure; the library tests run against the
// Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), each in a project of its own that is
// dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import pg from "pg";
import * as seed from "./library-seed.mjs";

import {
  contractsCoveredBy,
  judge,
  parseDecision,
  parseJunit,
  parseStory,
  recordHealth,
  syncDecisions,
  syncFoundingBooks,
  syncStory,
} from "./library-seed.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const librarySpec = readFileSync(path.join(root, "stories", "library.md"), "utf8");
const librarySrc = path.join(root, "packages", "library", "src");

// test-removed: "parseStory reads stories/library.md" pinned the library story file's own titles, prose,
// dependencies and contract counts, so it went red whenever that document changed (ADR-0623 D1: a test's
// subject is a product behaviour, never the wording or shape of a document). The parse behaviours it was
// the only test of, reading Depends on lines and following the build order, are the next test's subject.

test("parseStory takes capabilities in the build order's order, then any it leaves out, and reads each Depends on line up to its first full stop or bracket", () => {
  const story = parseStory(
    [
      "# Story: four parts",
      "",
      "**What it is.** Four capabilities.",
      "",
      "Build order: 1 → (3, 2).",
      "",
      "## 1 · First",
      "",
      "- **Depends on:** nothing.",
      "",
      "## 2 · Second",
      "",
      "- **Depends on:** 1 (and 3's records, which it does not need).",
      "",
      "## 3 · Third",
      "",
      "- **Depends on:** 1.",
      "",
      "## 4 · Fourth",
      "",
      "- **Depends on:** 1 and 2. Not 3.",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    story.capabilities.map(({ number, dependsOn }) => [number, dependsOn]),
    [[1, []], [3, [1]], [2, [1]], [4, [1, 2]]],
  );
});

test("parseStory regression: the pathways seed incident keeps local and cross-story capability numbers separate", () => {
  for (const [depends, expected, crossStory] of [
    ["1, 2, and the library's 2, 3, 6, 7 and 9.", [1, 2], [["library", 2], ["library", 3], ["library", 6], ["library", 7], ["library", 9]]],
    ["1 and the agent link's capabilities 4 and 5.", [1], [["agent link", 4], ["agent link", 5]]],
    ["the library's API (its 7), and the agent link's project routing (its 1).", [], [["library", 7], ["agent link", 1]]],
    ["1, 2 and the arc surface’s 3.", [1, 2], [["arc surface", 3]]],
    ["2, for the project on show, and 1.", [2, 1], []],
    ["1, the library's history with a writer (W1), and the agent link's sessions (its 4).", [1], [["agent link", 4]]],
    ["1, 2, and the library's 10 and 11 (and 12, for the questions shown on an arc).", [1, 2], [["library", 10], ["library", 11], ["library", 12]]],
    ["1. It reads the agent\n  link's sessions and claims (its capabilities 4 and 5).", [1], [["agent link", 4], ["agent link", 5]]],
    ["1 and the agent link's `makeWorkspace` (its 5.12-5.14).", [1], [["agent link", 5]]],
    ["nothing in this story. It reads the library's change history\n  (`changesSince`): each decision's status and `supersedes` (capability 13).", [], [["library", 13]]],
    ["1; the library API (`stories/library.md`, capability 7).", [1], [["stories/library.md", 7]]],
  ]) {
    const story = parseStory([
      "# Story: a command line",
      "",
      "## 1 · Project",
      "",
      "## 2 · Session",
      "",
      "## 3 · Library",
      "",
      `- **Depends on:** ${depends}`,
    ].join("\n"));
    assert.deepEqual(story.capabilities[2].dependsOn, expected, depends);
    assert.deepEqual(story.capabilities[2].crossStoryDependsOn.map(({ story, number }) => [story, number]), crossStory, depends);
  }
});

test("syncStories writes cross-story dependencies even when the target file comes later, reruns without writes, and removes obsolete links", async () => {
  await withLibrary(async (lib) => {
    const stories = [
      { file: "stories/client.md", story: parseStory("# Story: the client\n\n## 1 · Setup\n\n## 2 · Read\n\n- **Depends on:** 1 and the record store’s 1 and 2.") },
      { file: "stories/records.md", story: parseStory("# Story: the record store\n\n## 1 · Store\n\n## 2 · Read\n\n- **Depends on:** 1.") },
    ];
    const { synced, crossStoryLinks } = await seed.syncStories(lib, stories);
    const client = synced.get("stories/client.md").capabilityIds;
    const records = synced.get("stories/records.md").capabilityIds;
    const tree = await lib.projectTree();
    assert.equal(crossStoryLinks, 2);
    assert.deepEqual(tree.stories[0].capabilities[1].dependsOn, [client.get("1"), records.get("1"), records.get("2")]);
    const history = await lib.changesSince(0);
    await seed.syncStories(lib, stories);
    assert.deepEqual(await lib.changesSince(0), history, "rerunning the seed must not strip and restore cross-story links");

    stories[0].story = parseStory("# Story: the client\n\n## 1 · Setup\n\n## 2 · Read\n\n- **Depends on:** 1.");
    await seed.syncStories(lib, stories);
    assert.deepEqual((await lib.projectTree()).stories[0].capabilities[1].dependsOn, [client.get("1")]);
  });
});

test("syncStories reports an unknown story or capability with its source before writing anything", async () => {
  await withLibrary(async (lib) => {
    for (const [depends, message] of [
      ["the missing story's 1", /stories\/client\.md.*2 · Read.*unknown story.*missing story/i],
      ["the record store's 9", /stories\/client\.md.*2 · Read.*record store.*capability 9/i],
    ]) {
      await assert.rejects(seed.syncStories(lib, [
        { file: "stories/client.md", story: parseStory(`# Story: the client\n\n## 1 · Setup\n\n## 2 · Read\n\n- **Depends on:** ${depends}.`) },
        { file: "stories/records.md", story: parseStory("# Story: the record store\n\n## 1 · Store") },
      ]), message);
      assert.equal((await lib.projectTree()).stories.length, 0);
    }
  });
});

test("parseStory keeps heading order when there is no build order, and refuses a build order that puts a capability before one it depends on", () => {
  const spec = (buildOrder) => [
    "# Story: a small one",
    "",
    "**What it is.** Two capabilities.",
    "",
    ...(buildOrder === undefined ? [] : [`Build order: ${buildOrder}.`, ""]),
    "## 1 · First",
    "",
    "The first one,",
    "over two lines.",
    "",
    "- **Depends on:** nothing.",
    "",
    "**Contracts:**",
    "1. Does a thing,",
    "   carried on.",
    "2. Does another.",
    "",
    "## 2 · Second",
    "",
    "The second one.",
    "",
    "- **Depends on:** 1.",
    "",
    "**Contracts:**",
    "1. Only one.",
    "",
  ].join("\n");

  const story = parseStory(spec());
  assert.equal(story.title, "A small one");
  assert.equal(story.description, "Two capabilities.");
  assert.deepEqual(story.capabilities.map(({ title }) => title), ["1 · First", "2 · Second"]);
  assert.equal(story.capabilities[0].description, "The first one, over two lines.");
  assert.deepEqual(story.capabilities[0].contracts.map(({ title }) => title), ["1.1 · Does a thing, carried on.", "1.2 · Does another."]);
  assert.throws(() => parseStory(spec("2 → 1")), /2 · Second.*before.*1 · First/);
});

test("parseJunit reads each test's name, the suites around it, its file, and whether it passed, failed or was skipped", () => {
  const results = parseJunit(JUNIT);
  assert.deepEqual(results, [
    { name: "packages\\library\\src\\transactions\\pg.test.ts", suites: [], file: "C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts", status: "failed", message: "test failed" },
    { name: "1.1 openProject creates the project's database and its tables", suites: [], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: '2.3 [memory] a "quoted" <name> & more', suites: [], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: "8.1 live proof", suites: [], file: "C:\\repo\\a.test.ts", status: "skipped", message: "owner-gated" },
    { name: "3.1 fails", suites: [], file: "C:\\repo\\a.test.ts", status: "failed", message: "boom" },
    { name: "2.1 [cloud-sql] inside", suites: ["8.1 capability 2's suite"], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: "4.4 todo", suites: [], file: "C:\\repo\\a.test.ts", status: "skipped", message: "later" },
  ]);
});

test("judge: a contract passes only if every test it has passed; any failure fails it; a skipped test, or none, leaves it not checked", () => {
  const result = (name, status, extra = {}) => ({ name, suites: [], file: "C:\\repo\\a.test.ts", status, ...extra });
  const { verdicts, unmapped } = judge({
    contracts: ["1.1", "1.2", "1.3", "2.1", "2.2", "8.1", "8.2"],
    results: [
      result("1.1 [memory] one", "passed"),
      result("1.1 [postgres] one", "passed"),
      result("1.2 [memory] two", "passed"),
      result("1.2 [postgres] two", "failed", { message: "boom" }),
      result("2.1 [memory] some", "passed"),
      result("2.1 [postgres] some", "skipped", { message: "no server" }),
      result("8.1 live proof", "skipped", { message: "owner-gated" }),
      // Nested under 8.1, a test named for 2.2 counts for 8.1, the outermost numbered name.
      { name: "2.2 [cloud-sql] inside", suites: ["8.2 around it"], file: "C:\\repo\\a.test.ts", status: "passed" },
      result("robustness [memory] no number", "passed"),
      result("9.9 a contract the story does not have", "passed"),
    ],
    coverage: () => new Set(),
  });
  const brief = (number) => {
    const { state, note } = verdicts.get(number);
    return note === undefined ? { state } : { state, note };
  };
  assert.deepEqual(brief("1.1"), { state: "passing", note: "2/2 tests passed" });
  assert.deepEqual(brief("1.2"), { state: "failing", note: "1/2 tests passed" });
  assert.deepEqual(brief("1.3"), { state: "not-checked" }, "no tests");
  assert.deepEqual(brief("2.1"), { state: "not-checked" }, "a skipped test is not a pass");
  assert.deepEqual(brief("2.2"), { state: "not-checked" }, "its only test counts for 8.2");
  assert.deepEqual(brief("8.1"), { state: "not-checked" }, "all skipped");
  assert.deepEqual(brief("8.2"), { state: "passing", note: "1/1 tests passed" });
  assert.match(verdicts.get("2.1").reason, /1 of 2 tests skipped/);
  assert.match(verdicts.get("8.1").reason, /skipped.*owner-gated/);
  assert.match(verdicts.get("1.3").reason, /no tests/);
  assert.deepEqual(unmapped.map(({ name }) => name), ["robustness [memory] no number", "9.9 a contract the story does not have"]);
});

test("judge: a test file that produced no results leaves the contracts it holds not checked, never failing, and names the file", () => {
  const crashed = "C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts";
  const { verdicts, crashedFiles } = judge({
    contracts: ["2.1", "2.2", "3.1"],
    results: [
      { name: "packages\\library\\src\\transactions\\pg.test.ts", suites: [], file: crashed, status: "failed", message: "test failed" },
      { name: "2.1 [memory] save", suites: [], file: "C:\\repo\\memory.test.ts", status: "passed" },
      { name: "2.2 [memory] edit", suites: [], file: "C:\\repo\\memory.test.ts", status: "failed", message: "boom" },
      { name: "3.1 [memory] schema", suites: [], file: "C:\\repo\\schema.test.ts", status: "passed" },
    ],
    coverage: (file) => (file === crashed ? new Set(["2.1", "2.2"]) : new Set()),
  });
  assert.equal(verdicts.get("2.1").state, "not-checked", "its memory half passed, but its postgres half never ran");
  assert.match(verdicts.get("2.1").reason, /pg\.test\.ts produced no results/);
  assert.equal(verdicts.get("2.2").state, "failing", "a failure seen is still a failure");
  assert.equal(verdicts.get("3.1").state, "passing");
  assert.deepEqual(crashedFiles, [{ file: crashed, contracts: ["2.1", "2.2"] }]);
});

test("contractsCoveredBy finds the contract numbers a test file names, in itself and in the modules it imports", () => {
  const covered = (file) => [...contractsCoveredBy(path.join(librarySrc, file), { root: librarySrc })].sort();
  assert.deepEqual(covered("transactions/pg.test.ts"), ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9"], "through behaviour-suite.ts");
  assert.deepEqual(covered("project/project-libraries.test.ts"), ["1.1", "1.2", "1.3", "1.4", "1.5"]);
  assert.ok(covered("transactions/cloud-sql.test.ts").includes("8.1"));
});

test("syncStory adds the story once: a second run changes nothing, and a changed story, capability or contract is edited in place, keeping its id and health, never added twice", async () => {
  await withLibrary(async (lib) => {
    const first = await syncStory(lib, parseStory(THREE_PARTS));
    assert.deepEqual(first.counts, {
      story: "added",
      capabilities: { added: 3, updated: 0, unchanged: 0, retired: 0 },
      contracts: { added: 4, reworded: 0, unchanged: 0, retired: 0 },
    });
    const tree = await lib.projectTree();
    assert.equal(tree.stories.length, 1);
    const [stored] = tree.stories;
    assert.deepEqual([stored.title, stored.description], ["Three parts", "A story with three capabilities."]);
    assert.deepEqual(stored.capabilities.map(({ title }) => title), ["1 · First", "2 · Second", "3 · Third"], "added in build order");
    const idOf = (title) => stored.capabilities.find((capability) => capability.title === title).id;
    assert.deepEqual(stored.capabilities[2].dependsOn, [idOf("1 · First"), idOf("2 · Second")]);
    assert.equal(first.contractIds.get("1.2"), stored.capabilities[0].contracts[1].id);

    const second = await syncStory(lib, parseStory(THREE_PARTS));
    assert.deepEqual(second.counts, {
      story: "unchanged",
      capabilities: { added: 0, updated: 0, unchanged: 3, retired: 0 },
      contracts: { added: 0, reworded: 0, unchanged: 4, retired: 0 },
    });
    assert.deepEqual(await lib.projectTree(), tree, "the second run wrote nothing");

    // The file changes: the story's description, a capability's, one contract's wording, one contract gone, one new.
    await lib.recordVerified(first.contractIds.get("1.1"), "passing", { by: "storytree test run" });
    const changed = parseStory(
      THREE_PARTS.replace("A story with three capabilities.", "A story of three capabilities.")
        .replace("The second part.", "The second part, reworded.")
        .replace("1. Does a thing.", "1. Does a thing, and says so.")
        .replace("2. Does a second thing.\n", "")
        .replace("1. Does the last thing.", "1. Does the last thing.\n2. Does one more."),
    );
    const third = await syncStory(lib, changed);
    assert.deepEqual(third.counts, {
      story: "updated",
      capabilities: { added: 0, updated: 1, unchanged: 2, retired: 0 },
      contracts: { added: 1, reworded: 1, unchanged: 2, retired: 1 },
    });
    const after = (await lib.projectTree()).stories;
    assert.equal(after.length, 1, "still one story");
    assert.deepEqual([after[0].id, after[0].description], [stored.id, "A story of three capabilities."], "the story edited in place");
    const second2 = after[0].capabilities.find(({ title }) => title === "2 · Second");
    assert.deepEqual([second2.id, second2.description], [idOf("2 · Second"), "The second part, reworded."]);
    const reworded = after[0].capabilities[0].contracts.find(({ title }) => title.startsWith("1.1 "));
    assert.deepEqual([reworded.id, reworded.title], [first.contractIds.get("1.1"), "1.1 · Does a thing, and says so."], "reworded in place");
    assert.equal((await lib.health(reworded.id)).verified.state, "passing", "so its health stays with it");
    const numbers = after[0].capabilities.flatMap(({ contracts }) => contracts.map(({ title }) => title.split(" ")[0]));
    assert.deepEqual(numbers, ["1.1", "2.1", "3.1", "3.2"], "1.2 gone, 3.2 new, no number twice");
  });
});

test("recordHealth writes each passing or failing verdict to the verified column, with who and how many tests, and nothing for not checked", async () => {
  await withLibrary(async (lib) => {
    const { contractIds } = await syncStory(lib, parseStory(librarySpec));
    const verdicts = new Map([
      ["1.1", { number: "1.1", state: "passing", note: "2/2 tests passed" }],
      ["1.2", { number: "1.2", state: "failing", note: "1/2 tests passed" }],
      ["1.3", { number: "1.3", state: "not-checked", reason: "no tests" }],
    ]);
    const written = await recordHealth(lib, contractIds, verdicts);
    assert.deepEqual(written, { passing: 1, failing: 1, notChecked: 1 });

    const passing = await lib.health(contractIds.get("1.1"));
    assert.equal(passing.verified.state, "passing");
    assert.equal(passing.verified.by, "storytree test run");
    assert.equal(passing.verified.note, "2/2 tests passed");
    assert.deepEqual(passing.reported, { state: "not-checked" }, "the reported column is left alone");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "nothing is written for a contract not checked");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.4")), [], "nor for one with no verdict");
  });
});

test("parseDecision reads a decision file: its title, the one story or capability it is a front cover of, or none, and its words, ending with where its full record is", () => {
  const file = (header) =>
    [
      "# Keep the log beside the library",
      "",
      ...header,
      "",
      "The link keeps its own log beside the library,",
      "not inside it.",
      "",
      "Two things live there:",
      "- sessions and claims;",
      "- note reads.",
      "",
    ].join("\n");
  const record = "- **Full record:** ADR-0626 in storytree 0.2's decision log";

  assert.deepEqual(parseDecision(file(["- **Front cover of:** stories/agent-link.md, capability 2", record])), {
    title: "Keep the log beside the library",
    cover: { story: "stories/agent-link.md", capability: 2 },
    record: "ADR-0626",
    text:
      "The link keeps its own log beside the library, not inside it.\n\n" +
      "Two things live there:\n- sessions and claims;\n- note reads.\n\n" +
      "Full record: ADR-0626 in storytree 0.2's decision log.",
  });
  assert.deepEqual(parseDecision(file(["- **Front cover of:** stories/agent-link.md", record])).cover, { story: "stories/agent-link.md" });
  assert.equal(
    parseDecision(file(["- **Front cover of:** none: it decides the whole project", record])).cover,
    undefined,
    "a decision about the whole project sits on no shelf",
  );
  assert.throws(() => parseDecision(file([record])), /front cover/i, "a decision that forgets its cover line is refused");
  assert.throws(() => parseDecision(file(["- **Front cover of:** stories/agent-link.md"])), /full record/i, "so is one with no record to point at");
});

test("syncDecisions files each decision as a front cover of the node it names; a second run writes nothing, and a changed decision is edited in place, never added twice", async () => {
  await withLibrary(async (lib) => {
    const { storyId, capabilityIds } = await syncStory(lib, parseStory(TWO_PARTS));
    const nodes = new Map([["stories/two-parts.md", { storyId, capabilityIds }]]);
    // A cover an agent wrote for itself before the seed ran, which the seed never touches.
    const agents = await lib.recordDecision({ status: "accepted", title: "An agent's own cover", text: "Written through the tools.", frontCoverOf: capabilityIds.get("2") });
    const tree = decisionFor("ADR-0001", "The tree", { story: "stories/two-parts.md" });
    const second = decisionFor("ADR-0002", "The second part", { story: "stories/two-parts.md", capability: 2 });

    const first = await syncDecisions(lib, [tree, second], nodes);
    assert.deepEqual(first.counts, { added: 2, updated: 0, unchanged: 0, offShelf: 0 });
    const [tree1] = await lib.frontCovers(storyId);
    assert.deepEqual([tree1.fields.title, tree1.fields.text], ["The tree", tree.text]);
    const shelf = await lib.frontCovers(capabilityIds.get("2"));
    assert.deepEqual(shelf.map(({ fields }) => fields.title).sort(), ["An agent's own cover", "The second part"]);
    const second1 = shelf.find(({ fields }) => fields.title === "The second part");

    const { cursor } = await lib.changesSince(0);
    const again = await syncDecisions(lib, [tree, second], nodes);
    assert.deepEqual(again.counts, { added: 0, updated: 0, unchanged: 2, offShelf: 0 });
    assert.deepEqual((await lib.changesSince(cursor)).changes, [], "the second run wrote nothing");

    // The files change: one decision is reworded, and the other moves to the first capability.
    const changed = await syncDecisions(
      lib,
      [{ ...tree, title: "The tree, reworded" }, { ...second, cover: { story: "stories/two-parts.md", capability: 1 } }],
      nodes,
    );
    assert.deepEqual(changed.counts, { added: 0, updated: 2, unchanged: 0, offShelf: 0 });
    assert.deepEqual((await lib.frontCovers(storyId)).map(({ id, fields }) => [id, fields.title]), [[tree1.id, "The tree, reworded"]]);
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("1"))).map(({ id }) => id), [second1.id], "moved, not added again");
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("2"))).map(({ id }) => id), [agents.id]);
    assert.equal((await lib.search("what was decided")).length, 2, "two decisions, never four");
  });
});

test("syncDecisions takes a decision the files no longer have off its shelf and keeps it, and refuses a decision it cannot place, or one record filed twice, writing nothing", async () => {
  await withLibrary(async (lib) => {
    const { storyId, capabilityIds } = await syncStory(lib, parseStory(TWO_PARTS));
    const nodes = new Map([["stories/two-parts.md", { storyId, capabilityIds }]]);
    const tree = decisionFor("ADR-0001", "The tree", { story: "stories/two-parts.md" });
    await syncDecisions(lib, [tree], nodes);

    const gone = await syncDecisions(lib, [], nodes);
    assert.deepEqual(gone.counts, { added: 0, updated: 0, unchanged: 0, offShelf: 1 });
    assert.deepEqual(await lib.frontCovers(storyId), []);
    assert.equal((await lib.search("what was decided")).length, 1, "off its shelf but not retired, so nothing filed inside it is stranded");

    const { cursor } = await lib.changesSince(0);
    const place = (record, cover) => syncDecisions(lib, [tree, decisionFor(record, "Somewhere", cover)], nodes);
    await assert.rejects(place("ADR-0002", { story: "stories/two-parts.md", capability: 9 }), /ADR-0002.*capability 9/);
    await assert.rejects(place("ADR-0003", { story: "stories/other.md" }), /ADR-0003.*stories\/other\.md/);
    await assert.rejects(syncDecisions(lib, [tree, { ...tree, title: "The tree, again" }], nodes), /ADR-0001.*twice/);
    assert.deepEqual((await lib.changesSince(cursor)).changes, [], "a refused run writes nothing, not even the decisions it could place");
  });
});

test("syncDecisions files a decision about the whole project on no shelf, found by search, and moves it onto a shelf in place once its file names a node", async () => {
  await withLibrary(async (lib) => {
    const { storyId, capabilityIds } = await syncStory(lib, parseStory(TWO_PARTS));
    const nodes = new Map([["stories/two-parts.md", { storyId, capabilityIds }]]);
    const whole = decisionFor("ADR-0001", "The whole project", undefined);
    const tree = decisionFor("ADR-0002", "The tree", { story: "stories/two-parts.md" });

    const first = await syncDecisions(lib, [whole, tree], nodes);
    assert.deepEqual(first.counts, { added: 2, updated: 0, unchanged: 0, offShelf: 0 });
    const [found, ...others] = await lib.search("whole project");
    assert.deepEqual([found.fields.title, found.fields.frontCoverOf, others.length], ["The whole project", undefined, 0], "on no shelf");
    assert.deepEqual((await lib.frontCovers(storyId)).map(({ fields }) => fields.title), ["The tree"]);

    // The story it decided now exists: its file names it, and the same decision moves onto that shelf.
    const moved = await syncDecisions(lib, [{ ...whole, cover: { story: "stories/two-parts.md", capability: 2 } }, tree], nodes);
    assert.deepEqual(moved.counts, { added: 0, updated: 1, unchanged: 1, offShelf: 0 });
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("2"))).map(({ id }) => id), [found.id]);
  });
});

test("parseStory reads each capability's founding book from its shelf, with its label, its words joined, and none where the shelf has none", () => {
  const [first, second] = parseStory(SHELVED).capabilities;
  assert.deepEqual(first.foundingBook, { label: "P1", text: "a place comes from its story alone, fixed for good." });
  assert.deepEqual(second.foundingBook, { label: "ADR-0002 D1", text: "the second part follows the first." });
  assert.equal(parseStory(TWO_PARTS).capabilities[0].foundingBook, undefined);
});

test("syncFoundingBooks files each capability's founding book on its shelf, first, except where a decision file already covers it; a second run writes nothing, a change is edited in place, and a book the file dropped leaves its shelf", async () => {
  await withLibrary(async (lib) => {
    const story = parseStory(SHELVED);
    const { storyId, capabilityIds } = await syncStory(lib, story);
    const stories = [{ file: "stories/two-parts.md", story }];
    const nodes = new Map([["stories/two-parts.md", { storyId, capabilityIds }]]);
    const covered = decisionFor("ADR-0002", "The second part", { story: "stories/two-parts.md", capability: 2 });

    const first = await syncFoundingBooks(lib, stories, nodes, [covered]);
    assert.deepEqual(first.counts, { added: 1, updated: 0, unchanged: 0, offShelf: 0 });
    await syncDecisions(lib, [covered], nodes);
    await lib.recordDecision({ status: "accepted", title: "A later book", text: "Written through the tools.", frontCoverOf: capabilityIds.get("1") });
    const shelf = await lib.frontCovers(capabilityIds.get("1"));
    assert.deepEqual(shelf.map(({ fields }) => fields.title), ["1 · First: founding book (P1)", "A later book"], "the founding book first");
    assert.equal(shelf[0].fields.text, "a place comes from its story alone, fixed for good.\n\nFounding book of stories/two-parts.md, capability 1.");
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("2"))).map(({ fields }) => fields.title), ["The second part"], "a decision file on a capability is its founding book, so nothing is filed twice");

    const { cursor } = await lib.changesSince(0);
    const again = await syncFoundingBooks(lib, stories, nodes, [covered]);
    assert.deepEqual(again.counts, { added: 0, updated: 0, unchanged: 1, offShelf: 0 });
    assert.deepEqual((await lib.changesSince(cursor)).changes, [], "the second run wrote nothing");

    const reworded = parseStory(SHELVED.replace("fixed for good", "fixed forever"));
    const changed = await syncFoundingBooks(lib, [{ file: "stories/two-parts.md", story: reworded }], nodes, [covered]);
    assert.deepEqual(changed.counts, { added: 0, updated: 1, unchanged: 0, offShelf: 0 });
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("1"))).map(({ id }) => id), shelf.map(({ id }) => id), "edited in place, keeping its place");

    const dropped = await syncFoundingBooks(lib, [{ file: "stories/two-parts.md", story: parseStory(TWO_PARTS) }], nodes, [covered]);
    assert.deepEqual(dropped.counts, { added: 0, updated: 0, unchanged: 0, offShelf: 1 });
    assert.deepEqual((await lib.frontCovers(capabilityIds.get("1"))).map(({ fields }) => fields.title), ["A later book"]);
    assert.equal((await lib.search("Founding book of")).length, 1, "off its shelf but never retired");
  });
});

// --- helpers ---------------------------------------------------------------------------------

/** Node's junit reporter output, as it writes it (a crashed file, escaping, a skip, a failure, a suite, a todo). */
const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="packages\\library\\src\\transactions\\pg.test.ts" time="0.08" classname="test" file="C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts" failure="test failed">
		<failure type="testCodeFailure" message="test failed">
[Error: test failed] { code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', cause: 'test failed', exitCode: 1, signal: null }
		</failure>
	</testcase>
	<testcase name="1.1 openProject creates the project's database and its tables" time="1.3" classname="test" file="C:\\repo\\a.test.ts"/>
	<testcase name="2.3 [memory] a &amp;quot;quoted&amp;quot; &lt;name> &amp; more" time="0.1" classname="test" file="C:\\repo\\a.test.ts"/>
	<testcase name="8.1 live proof" time="0.001" classname="test" file="C:\\repo\\a.test.ts">
		<skipped type="skipped" message="owner-gated"/>
	</testcase>
	<testcase name="3.1 fails" time="0.001" classname="test" file="C:\\repo\\a.test.ts" failure="boom">
		<failure type="testCodeFailure" message="boom">
Error: boom &lt;&amp;> at TestContext.&lt;anonymous>
		</failure>
	</testcase>
	<testsuite name="8.1 capability 2's suite" time="0.0002" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="box">
		<testcase name="2.1 [cloud-sql] inside" time="0.0001" classname="test" file="C:\\repo\\a.test.ts"/>
	</testsuite>
	<testcase name="4.4 todo" time="0.00006" classname="test" file="C:\\repo\\a.test.ts">
		<skipped type="todo" message="later"/>
	</testcase>
	<!-- tests 7 -->
</testsuites>
`;

/** A story file with three capabilities, their dependencies and their contracts, for syncStory to load and reload. */
const THREE_PARTS = [
  "# Story: three parts",
  "",
  "**What it is.** A story with three capabilities.",
  "",
  "Build order: 1 → 2 → 3.",
  "",
  "## 1 · First",
  "",
  "The first part.",
  "",
  "- **Depends on:** nothing.",
  "",
  "**Contracts:**",
  "1. Does a thing.",
  "2. Does a second thing.",
  "",
  "## 2 · Second",
  "",
  "The second part.",
  "",
  "- **Depends on:** 1.",
  "",
  "**Contracts:**",
  "1. Does another.",
  "",
  "## 3 · Third",
  "",
  "The third part.",
  "",
  "- **Depends on:** 1 and 2.",
  "",
  "**Contracts:**",
  "1. Does the last thing.",
  "",
].join("\n");

/** A story file with two capabilities, for the decisions to be filed on. */
const TWO_PARTS = [
  "# Story: two parts",
  "",
  "**What it is.** A story with two capabilities.",
  "",
  "## 1 · First",
  "",
  "The first part.",
  "",
  "- **Depends on:** nothing.",
  "",
  "**Contracts:**",
  "1. Does a thing.",
  "",
  "## 2 · Second",
  "",
  "The second part.",
  "",
  "- **Depends on:** 1.",
  "",
  "**Contracts:**",
  "1. Does another.",
  "",
].join("\n");

/** TWO_PARTS with a shelf on each capability: a founding book with its label in the bold, over two lines, and one with it after. */
const SHELVED = TWO_PARTS.replace(
  "- **Depends on:** nothing.\n",
  [
    "- **Depends on:** nothing.",
    "- **Its shelf,** founding book first:",
    "  - **Founding book (P1):** a place comes from its story alone,",
    "    fixed for good.",
    "  - A second book, not the founding one.",
    "",
  ].join("\n"),
).replace(
  "- **Depends on:** 1.\n",
  ["- **Depends on:** 1.", "- **Its shelf,** founding book first:", "  - **Founding book** (ADR-0002 D1): the second part follows the first.", ""].join("\n"),
);

/** A decision as parseDecision reads one, a front cover of `cover`, or of nothing when it is undefined. */
function decisionFor(record, title, cover) {
  return { title, cover, record, text: `What was decided.\n\nFull record: ${record} in storytree 0.2's decision log.` };
}

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

test("every decision file in decisions/ names a record no other file names, so the seed can file them all", () => {
  const dir = path.join(root, "decisions");
  /** @type {Map<string, string>} record -> the file that names it */
  const owners = new Map();
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".md")).sort()) {
    const { record } = parseDecision(readFileSync(path.join(dir, name), "utf8"));
    assert.equal(owners.get(record), undefined, `${record} is the full record of both decisions/${owners.get(record)} and decisions/${name}`);
    owners.set(record, name);
  }
});
