/**
 * Capability 7 · Library API: one test per contract 7.1-7.3 in the library story, run through the
 * package's public entry the way every later story will reach the library: `@storytree/library`,
 * the package importing itself by name. They run against the real Postgres `pnpm test` provides.
 * There is no backend choice here: the public API is the library on Postgres.
 *
 * Every project is named with uniqueProjectName() and its database is dropped afterwards, pass or
 * fail. Other test files share the server, so a test only ever reads its own project.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, MissingReferenceError, RetireRefusedError, type Change, type NodeHealth, type RecordEnvelope, type Storytree } from "@storytree/library";
// The type half of 7.3, which `pnpm typecheck` checks rather than a test run: the entry exports no
// type that reaches a connection pool, a store or a table. Each import below must fail to compile.
// If one ever compiles, its @ts-expect-error is left unused, and that fails the typecheck.
// @ts-expect-error the project handle, which holds the connection pool
import type { Project } from "@storytree/library";
// @ts-expect-error a store: the only data actions, over a table
import type { Transactions } from "@storytree/library";
// @ts-expect-error the Postgres store
import type { PgTransactions } from "@storytree/library";
// @ts-expect-error the in-memory store
import type { MemoryTransactions } from "@storytree/library";
// @ts-expect-error the typed records, over a store
import type { SchemaRecords } from "@storytree/library";
// @ts-expect-error the work model, over the typed records
import type { WorkModel } from "@storytree/library";
// @ts-expect-error the knowledge layer, over the typed records
import type { Knowledge } from "@storytree/library";
// @ts-expect-error the health record, over the typed records
import type { HealthRecord } from "@storytree/library";

import { dropTestDatabases, testServerUrl, uniqueProjectName, withTestClient } from "../testing/pg.js";

/** What a Library offers: the API's list, restated from the spec and the brief. */
const LIBRARY_API = [
  "name",
  "identity",
  "factory",
  "markFactory",
  "recordFactory",
  "get",
  "list",
  "inherited",
  "history",
  "addStory",
  "mapStories",
  "createArc",
  "addCapability",
  "editStory",
  "editCapability",
  "addContract",
  "editContract",
  "editArc",
  "projectTree",
  "arcsFor",
  "anchor",
  "setAnchor",
  "prCutover",
  "setPrCutover",
  "addIncrement",
  "advanceIncrement",
  "closeIncrement",
  "correctIncrementClosure",
  "moveIncrement",
  "editIncrement",
  "pendChange",
  "stalePending",
  "applyPending",
  "settleClosedPending",
  "parkArc",
  "unparkArc",
  "arcView",
  "arcViews",
  "boardArcs",
  "closedArcs",
  "addWait",
  "removeWait",
  "waitHolds",
  "addWaitFor",
  "removeWaitFor",
  "waitsFor",
  "holds",
  "raiseQuestion",
  "settleQuestion",
  "questions",
  "heldOnQuestion",
  "checkQuestion",
  "renewQuestion",
  "editQuestion",
  "moveQuestion",
  "lapsedQuestions",
  "reportHealth",
  "recordVerified",
  "markVerifiedPending",
  "health",
  "healthHistory",
  "healthWorklist",
  "recordDecision",
  "numberDecision",
  "numberDecisionsFromFullRecord",
  "numberFoundingDecisions",
  "setDecisionNumberFloor",
  "setProposed",
  "decisionNumberPlan",
  "defineTerm",
  "writeKnowledge",
  "definitions",
  "editNote",
  "search",
  "searchEach",
  "rank",
  "rankAll",
  "findPhrase",
  "relatedNotes",
  "related",
  "relatedEach",
  "frontCovers",
  "decision",
  "decisions",
  "composeStatement",
  "refile",
  "retire",
  "retireQuestion",
  "returnIncrement",
  "changesSince",
  "sendFeedback",
  "feedbackScreenshot",
  "routeFeedback",
  "createPluginRecord",
  "pluginRecords",
  "removePluginRecords",
  // Capability 27's fixed data questions.
  "counts",
  "latestChanges",
  "findByTitle",
  "decisionNumbered",
  "close",
];

/**
 * What the package's entry exports at run time: connect, and the errors callers catch by class.
 * ConnectionError joined the list with capability 8: it is how connect() refuses a server it cannot
 * reach or use as it is set up (a Cloud SQL instance without a Google sign-in, say), with a message
 * saying what to fix, so a caller catches every such refusal by its class. MissingUpgradeError
 * joined it with schema upgrades: how a record no upgrade step can bring up to date is refused.
 * LifecycleError joined it with capability 10: how an increment asked to move backward is refused,
 * WaitLoopError with capability 11: how a wait that would close a loop is refused, and
 * RetireRefusedError with capability 12: how retiring a question work is held on is refused.
 * NumberTakenError and SupersessionLoopError joined it with capability 13: how a decision number
 * already held, and a decision superseding itself, are refused. LinkLoopError joined it with
 * contract 9.4: how a note link that would close a loop is refused (ADR-0647 D2). wordAndWhy joined
 * it with contract 5.8: how a capability's word and why it is not healthy are said (ADR-0825 D1).
 * heldBack joined it with contract 5.11: how the worklist says what a test run in progress holds back.
 * NEW_LINE joined it with ADR-1017 D3: the schema Session management checks each activity log line
 * against before it stores it in the library's database. connectionString joined it with contract 15.5:
 * the routed library's connection string, signed in, that `storytree auth connection` hands psql.
 * ANCHOR_ID and anchorGaps joined it with ADR-1085 D1: where the project's anchor is kept, and the plan-health reading of it.
 * parseSchedule and OWNER_TIME_ZONE joined it with ADR-1105 D1: the one reader of a process's schedule, which `schedule due` reads it with.
 * CONNECT_TIMEOUT_MS and explainConnectTimeout joined it with ADR-1163 D1: the default connect limit and the one wording of its refusal, which the MCP server gives too.
 * pluginSchema joined it with ADR-1178 D3: the one reader of a plugin's declared record kinds, which the plugin loader checks a manifest's with.
 */
const RUNTIME_EXPORTS = [
  "ANCHOR_ID",
  "CONNECT_TIMEOUT_MS",
  "CONTRACT_DEFINITION",
  "ConnectionError",
  "DependencyLoopError",
  "LONG_CONTRACT_TITLE",
  "LifecycleError",
  "LinkLoopError",
  "MissingReferenceError",
  "MissingUpgradeError",
  "NEW_LINE",
  "NOT_VERIFIED",
  "NewerSchemaError",
  "NumberTakenError",
  "OWNER_TIME_ZONE",
  "ProjectGoneError",
  "ProjectNameError",
  "RestoreRefusedError",
  "RetireRefusedError",
  "SEED_CONNECTION",
  "SchemaError",
  "SupersessionLoopError",
  "UnknownTypeError",
  "WaitLoopError",
  "anchorGaps",
  "beforeCutover",
  "connect",
  "connectionString",
  "explainConnectTimeout",
  "heldBack",
  "knowledgeGuidance",
  "parseSchedule",
  "planGuidance",
  "pluginSchema",
  "pullSaid",
  "wordAndWhy",
];

/** The health of a node with no entries. */
const UNCHECKED: NodeHealth = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };

test("7.1 an agent's day against a real local Postgres: every step is visible where the next step expects it", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    // Open a project: its library is created the first time, and the project is listed.
    const lib = await storytree.openProject(name);
    assert.equal(lib.name, name);
    assert.ok((await storytree.listProjects()).includes(name), "the new project is listed");
    assert.deepEqual(await lib.projectTree(), { stories: [], arcs: [], unverified: true }, "its plan is empty, and nothing verifies it yet");
    assert.deepEqual(await lib.changesSince(0), { changes: [], cursor: 0 }, "and nothing has changed in it yet");

    // Add a story, and create an arc that grows it: the arc may list the story because it is there.
    // (An arc lists stories that exist, so the story comes first, as in the spec's own sketch.)
    const story = await lib.addStory({ title: "Visitor can sign up" });
    const arc = await lib.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    assert.deepEqual(await lib.arcsFor(story.id), [arc], "the arc is found from its story");

    // A capability under the story, and a contract under that: each accepted because its parent is there.
    const capability = await lib.addCapability({ title: "Email form", story: story.id });
    const contract = await lib.addContract({ title: "Rejects a bad email", capability: capability.id });
    const planWith = (contractHealth: NodeHealth, rolledUp: NodeHealth) => ({
      stories: [
        {
          id: story.id,
          title: "Visitor can sign up",
          health: rolledUp,
          capabilities: [
            {
              id: capability.id,
              title: "1 · Email form",
              dependsOn: [],
              proposed: true,
              health: rolledUp,
              contracts: [{ id: contract.id, title: "1.1 · Rejects a bad email", health: contractHealth }],
              status: "proposed",
              why: { reason: "not built", mover: "agent", contracts: [] },
            },
          ],
        },
      ],
      arcs: [{ id: arc.id, title: "Launch v1", stories: [story.id] }],
    });
    assert.deepEqual(await lib.projectTree(), { ...planWith(UNCHECKED, UNCHECKED), unverified: true }, "the plan, nested, with nothing checked yet: nothing verifies the project");

    // The agent reports the contract passing: the contract reads it, and it rolls up.
    const reported = await lib.reportHealth(contract.id, "passing", { by: "agent" });
    const agentSays = { state: "passing" as const, by: "agent", at: reported.at };
    assert.deepEqual(await lib.health(contract.id), { reported: agentSays, verified: { state: "not-checked" } });
    assert.deepEqual(await lib.health(story.id), { reported: { state: "passing" }, verified: { state: "not-checked" } });

    // Storytree records what it verified for itself, failing: both columns stand side by side.
    const verified = await lib.recordVerified(contract.id, "failing", { by: "storytree" });
    const contractHealth: NodeHealth = { reported: agentSays, verified: { state: "failing", by: "storytree", at: verified.at } };
    const rolledUp: NodeHealth = { reported: { state: "passing" }, verified: { state: "failing" } };
    assert.deepEqual(await lib.health(contract.id), contractHealth);
    assert.deepEqual(await lib.health(capability.id), rolledUp);
    assert.deepEqual(await lib.health(story.id), rolledUp);
    assert.deepEqual(await lib.healthHistory(contract.id), [reported, verified], "both entries, with who wrote them and when");

    // A decision that is the email form's front cover, and a memory filed inside it: the cover is on
    // the capability's shelf, the memory is found from the cover, and both are found by their words.
    const cover = await lib.recordDecision({ status: "accepted", title: "Send through Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
    const memory = await lib.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [cover.id] });
    assert.deepEqual(await lib.frontCovers(capability.id), [cover]);
    assert.deepEqual(await lib.relatedNotes(cover.id), [memory]);
    assert.deepEqual(await lib.search("mailgun DOMAIN"), [memory]);
    assert.deepEqual(await lib.search("mailgun simplest"), [cover]);

    // What the forest reads: the whole plan, with its health.
    const theDay = await lib.projectTree();
    assert.deepEqual(theDay, planWith(contractHealth, rolledUp));

    // What just changed: one change per step, in the order the steps were taken, each holding the
    // record as its step left it (a health entry as the record of its contract's column).
    const day = await lib.changesSince(0);
    const reportedColumn = at(day.changes, 4).recordId;
    const verifiedColumn = at(day.changes, 5).recordId;
    assert.deepEqual(withoutSeq(day.changes), [
      { recordId: story.id, type: "story", action: "created", record: story },
      { recordId: arc.id, type: "arc", action: "created", record: arc },
      { recordId: capability.id, type: "capability", action: "created", record: capability },
      { recordId: contract.id, type: "contract", action: "created", record: contract },
      {
        recordId: reportedColumn,
        type: "health",
        action: "created",
        record: healthRecord(reportedColumn, { node: contract.id, column: "reported", state: "passing", by: "agent" }, reported.at),
      },
      {
        recordId: verifiedColumn,
        type: "health",
        action: "created",
        record: healthRecord(verifiedColumn, { node: contract.id, column: "verified", state: "failing", by: "storytree" }, verified.at),
      },
      { recordId: cover.id, type: "decision", action: "created", record: cover },
      { recordId: memory.id, type: "definition", action: "created", record: memory },
    ]);
    assert.notEqual(reportedColumn, verifiedColumn, "each column is its own record");
    assertIncreasing(day.changes);
    assert.equal(day.cursor, at(day.changes, 7).seq, "the cursor handed back is the last change's");
    assert.deepEqual(await lib.changesSince(day.cursor), { changes: [], cursor: day.cursor }, "and nothing came after it");
    // The day ends: the library is closed, and takes no more calls.
    await lib.close();
    await assert.rejects(lib.projectTree(), "a closed library is not read");

    // The next session, on a fresh connection, finds the day's work where it was left.
    const tomorrow = await connect({ url: testServerUrl() });
    try {
      const again = await tomorrow.openProject(name);
      assert.deepEqual(await again.projectTree(), theDay);
      assert.deepEqual(await again.changesSince(0), day);

      // A session's increment retires the contract pending its merge: its branch reads the plan without it, everyone else as it was.
      const work = await again.addIncrement({ arc: arc.id, title: "Drop the check", objective: "Drop it", body: "Retire 1.1." });
      await again.advanceIncrement(work.id, "active");
      await again.pendChange(work.id, { record: contract.id, retire: "overtaken" });
      assert.deepEqual(await again.projectTree(), theDay);
      assert.deepEqual((await again.projectTree({ pendingOf: work.id })).stories[0]!.capabilities[0]!.contracts, []);
      assert.deepEqual(await again.stalePending(work.id), []);
      // Its pull request merges: the retirement applies, and every reader reads the plan without it.
      assert.deepEqual(await again.applyPending(work.id, "#12"), { applied: [contract.id] });
      assert.deepEqual((await again.projectTree()).stories[0]!.capabilities[0]!.contracts, []);
    } finally {
      await tomorrow.close();
    }
  });
});

test("7.2 changesSince(n) returns only the changes after n, in order, each carrying the cursor to pass next time", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);

    // A reader following along, passing back the cursor each call hands it.
    const followed: Change[] = [];
    let cursor = 0;
    const follow = async (): Promise<Change[]> => {
      const { changes, cursor: next } = await lib.changesSince(cursor);
      for (const change of changes) assert.ok(change.seq > cursor, `change ${change.seq} comes after the cursor ${cursor}`);
      assert.equal(next, changes.at(-1)?.seq ?? cursor, "the cursor handed back is the last change's seq, or the one passed in when there is none");
      followed.push(...changes);
      cursor = next;
      return changes;
    };

    assert.deepEqual(await follow(), [], "a new project has no changes");
    assert.equal(cursor, 0);

    const story = await lib.addStory({ title: "Visitor can sign up" });
    assert.deepEqual(withoutSeq(await follow()), [{ recordId: story.id, type: "story", action: "created", record: story }]);
    assert.deepEqual(await follow(), [], "nothing new since: nothing is handed out twice");

    // A write that rolls back after taking its number in the history (a crash, say) leaves a gap:
    // seqs are strictly increasing, not contiguous, so a cursor is a seq and never a count.
    await withTestClient(async (client) => {
      await client.query("BEGIN");
      await client.query("INSERT INTO record_event (record_id, type, action, record) VALUES ('rolled-back', 'story', 'created', '{}')");
      await client.query("ROLLBACK");
    }, `storytree_${name}`);

    // Many writes between two reads, of every kind: records created, edited and retired, a health
    // column saved twice, a note edited. Writes that change nothing add no change.
    const capability = await lib.addCapability({ title: "Email form", story: story.id });
    const renamed = await lib.editCapability(capability.id, { title: "Signup form" });
    const contract = await lib.addContract({ title: "Rejects a bad email", capability: capability.id });
    const failing = await lib.reportHealth(contract.id, "failing", { by: "agent" });
    const passing = await lib.reportHealth(contract.id, "passing", { by: "agent" });
    const memory = await lib.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const reworded = await lib.editNote(memory.id, { meaning: "Mailgun needs a verified sending domain" });
    await lib.retire(memory.id, "folded into a decision");
    const decision = await lib.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
    assert.equal(await lib.editCapability("capability_000000000000", { title: "Nothing" }), null);
    assert.equal(await lib.editNote(memory.id, { meaning: "Retired, so not edited" }), null);
    await lib.retire(memory.id, "already retired");
    await lib.retire("story_000000000000", "never existed");
    await lib.retire("story_\u0000", "not an id the library can store");

    const round = await follow();
    const column = at(round, 3).recordId;
    assert.deepEqual(withoutSeq(round), [
      { recordId: capability.id, type: "capability", action: "created", record: capability },
      { recordId: capability.id, type: "capability", action: "updated", record: renamed },
      { recordId: contract.id, type: "contract", action: "created", record: contract },
      {
        recordId: column,
        type: "health",
        action: "created",
        record: healthRecord(column, { node: contract.id, column: "reported", state: "failing", by: "agent" }, failing.at),
      },
      {
        recordId: column,
        type: "health",
        action: "updated",
        record: healthRecord(column, { node: contract.id, column: "reported", state: "passing", by: "agent" }, failing.at, passing.at),
      },
      { recordId: memory.id, type: "definition", action: "created", record: memory },
      { recordId: memory.id, type: "definition", action: "updated", record: reworded },
      { recordId: memory.id, type: "definition", action: "retired", record: reworded },
      { recordId: decision.id, type: "decision", action: "created", record: decision },
    ]);
    assert.deepEqual(await follow(), []);
    // No gap and no repeat: what the reader followed is exactly the whole history, in order.
    const whole = await lib.changesSince(0);
    assert.deepEqual(followed, whole.changes);
    assert.equal(cursor, whole.cursor);
    assertIncreasing(whole.changes);
    // From any change's seq: exactly the changes after it, and the same cursor at the end.
    for (const [n, change] of whole.changes.entries()) {
      assert.deepEqual(await lib.changesSince(change.seq), { changes: whole.changes.slice(n + 1), cursor: whole.cursor }, `changesSince(${change.seq})`);
    }
    // A cursor past the last change: nothing, and that cursor handed back.
    assert.deepEqual(await lib.changesSince(whole.cursor + 1000), { changes: [], cursor: whole.cursor + 1000 });

    // Writes racing each other while the reader follows along: it misses none and sees none twice.
    await Promise.all(Array.from({ length: 8 }, () => lib.changesSince(cursor))); // a connection ready for every racer
    const before = followed.length;
    let writing = true;
    const writes = Promise.all(Array.from({ length: 8 }, (_, n) => lib.defineTerm({ term: "Delivery", meaning: `Raced note ${n}` }))).finally(() => {
      writing = false;
    });
    writes.catch(() => undefined); // a failed write is reported by the `await writes` below
    do {
      await follow();
    } while (writing);
    const raced = await writes;
    await follow();
    assert.deepEqual(
      followed.slice(before).map((change) => change.recordId).sort(),
      raced.map((note) => note.id).sort(),
      "every raced write seen, once",
    );
    assert.deepEqual(followed, (await lib.changesSince(0)).changes, "the whole history, followed with no gap and no repeat");

    // A cursor is 0 or a seq a call handed back. Anything else is refused rather than read as
    // something it is not.
    for (const bad of [-1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined, {}]) {
      await assert.rejects(lib.changesSince(untyped(bad)), RangeError, `changesSince(${String(bad)})`);
    }
  });
});

test("7.3 the package's public entry exports exactly the API and nothing else, and its internals cannot be imported through the package", async () => {
  // At run time the entry exports connect() and the errors a caller may need to catch by class.
  // Everything else it exports is a type (that half is checked by the typecheck: see the imports above).
  const api: Record<string, unknown> = { ...(await import("@storytree/library")) };
  assert.deepEqual(Object.keys(api).sort(), RUNTIME_EXPORTS);
  assert.equal(api.connect, connect, "the entry's connect is the connect imported above");
  const errorClass = (exported: string): ErrorClass => {
    const value = api[exported];
    assert.ok(typeof value === "function" && value.prototype instanceof Error, `${exported} is an Error class`);
    return value as ErrorClass;
  };

  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    // connect() hands back exactly openProject, listProjects, snapshot, restore, dropProject (1.12), ownDatabase (7.7) and
    // close (snapshot and restore are contracts 1.6 to 1.8, ADR-0641 B1), and openProject a Library
    // with exactly the API's name and methods. Neither exposes the internals.
    assert.deepEqual(surface(storytree), ["close", "dropProject", "listProjects", "openProject", "ownDatabase", "projectIdentities", "restore", "snapshot"]);
    const lib = await storytree.openProject(name);
    assert.deepEqual(surface(lib), [...LIBRARY_API].sort());
    assert.deepEqual(await lib.inherited(), [], "a project with no factory inherits nothing");
    for (const internal of ["pool", "transactions", "records", "work", "knowledge", "project", "server"]) {
      assert.equal(internal in lib, false, `a Library has no ${internal}`);
      assert.equal(internal in storytree, false, `the connection has no ${internal}`);
    }

    // What the API throws is what the entry exports, so callers can catch each error by its class.
    // (A Cloud SQL setting that names no instance is refused before anything reaches the network.)
    await assert.rejects(connect({ cloudSql: { instance: "storytree-pg", user: "you@example.com" } }), errorClass("ConnectionError"));
    await assert.rejects(storytree.openProject("Not A Project"), errorClass("ProjectNameError"));
    await assert.rejects(lib.addStory(untyped({ titel: "Visitor can sign up" })), errorClass("SchemaError"));
    await assert.rejects(lib.addCapability({ title: "Email form", story: "story_000000000000" }), errorClass("MissingReferenceError"));
    const story = await lib.addStory({ title: "Visitor can sign up" });
    const form = await lib.addCapability({ title: "Email form", story: story.id });
    const link = await lib.addCapability({ title: "Confirmation link", story: story.id, dependsOn: [form.id] });
    await assert.rejects(lib.editCapability(form.id, { dependsOn: [link.id] }), errorClass("DependencyLoopError"));
    // Records as a newer storytree could have written them: of a type this code does not know, and
    // on a newer schema version.
    await withTestClient(async (client) => {
      await client.query(
        `INSERT INTO record (id, type, version, fields, created_at, updated_at)
         VALUES ('widget-1', 'widget', 1, '{"title": "From elsewhere"}', now(), now()),
                ('story-future', 'story', 2, '{"title": "From the future"}', now(), now())`,
      );
    }, `storytree_${name}`);
    await assert.rejects(lib.health("widget-1"), errorClass("UnknownTypeError"));
    await assert.rejects(lib.projectTree(), errorClass("NewerSchemaError"));
  });

  // Nothing but the entry can be imported through the package: every internal path is refused.
  for (const internal of [
    "@storytree/library/src/transactions/pg.ts",
    "@storytree/library/src/transactions/pg.js",
    "@storytree/library/src/project/storytree.ts",
    "@storytree/library/src/schema/records.ts",
    "@storytree/library/src/testing/pg.ts",
    "@storytree/library/src/index.ts",
    "@storytree/library/package.json",
  ]) {
    await assert.rejects(import(internal), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }, internal);
  }
});

test("7.18 sendFeedback writes a feedback record, with the element it points at, and keeps its screenshot and the crop to that element beside it, out of the record's history; feedbackScreenshot returns the bytes, and none for a note sent without one", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    const note = {
      text: "The arcs drawer hides the island I clicked",
      surface: "arcs",
      story: "arc-surface",
      selection: "story_000000000001",
      project: "site",
      version: "0.3.99",
      window: { width: 1440, height: 960 },
      theme: "dark" as const,
      at: "2026-10-21T12:00:00.000Z",
    };
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const sent = await lib.sendFeedback(note, { screenshot: jpeg, actor: "session:feedback-test" });
    assert.match(sent.id, /^feedback_[0-9a-f]{12}$/);
    assert.equal(sent.type, "feedback");
    assert.deepEqual(sent.fields, { ...note, status: "new", screenshot: true });
    assert.deepEqual((await lib.list("feedback")).map(({ id }) => id), [sent.id]);
    assert.deepEqual(await lib.feedbackScreenshot(sent.id), jpeg);
    const history = await lib.history({ id: sent.id });
    assert.equal(history.length, 1);
    assert.equal(history[0]!.actor, "session:feedback-test");
    assert.equal(JSON.stringify(history[0]!.record).includes("screenshot\":true"), true, "the history says a screenshot was taken");
    assert.ok(JSON.stringify(history[0]!.record).length < 2_000, "the picture's bytes are not copied into the history");

    const plain = await lib.sendFeedback({ ...note, text: "No picture this time" });
    assert.equal(plain.fields.screenshot, false);
    assert.equal(await lib.feedbackScreenshot(plain.id), null);
    assert.equal(await lib.feedbackScreenshot(sent.id, { element: true }), null, "a note sent without a crop has none");

    // The element the owner pointed at rides in the fields; the picture cut to it is kept beside the window's.
    const anchor = {
      selector: "#arcs > button:nth-of-type(2)",
      tag: "button",
      role: "button",
      name: "Close",
      text: "Close",
      marks: ['section[data-surface-id="arcs"]'],
      components: ["ArcsDrawer"],
      box: { x: 10, y: 20, width: 60, height: 24 },
      styles: { color: "rgb(236, 234, 227)" },
      html: '<button type="button">Close</button>',
    };
    const crop = Uint8Array.from([0xff, 0xd8, 9, 0xff, 0xd9]);
    const pointed = await lib.sendFeedback({ ...note, anchor }, { screenshot: jpeg, crop });
    assert.deepEqual(pointed.fields, { ...note, anchor, status: "new", screenshot: true, crop: true });
    assert.deepEqual(await lib.feedbackScreenshot(pointed.id, { element: true }), crop);
    assert.deepEqual(await lib.feedbackScreenshot(pointed.id), jpeg);
    await assert.rejects(lib.sendFeedback({ ...note, anchor }, { crop }), /only with its window picture/, "a crop is kept only with its window picture");
    await assert.rejects(lib.sendFeedback(untyped({ ...note, anchor: { ...anchor, html: "x".repeat(2049) } })), (error: Error) => error.name === "SchemaError", "an anchor's HTML is at most 2 KB");
    assert.equal(await lib.feedbackScreenshot("feedback_000000000000"), null);

    await assert.rejects(lib.sendFeedback(untyped({ ...note, text: "" })), (error: Error) => error.name === "SchemaError", "a note with no text is refused");
    await assert.rejects(lib.sendFeedback(untyped({ ...note, surface: undefined }), { screenshot: jpeg }), (error: Error) => error.name === "SchemaError", "a note with no surface is refused");
    assert.equal((await lib.list("feedback")).length, 3, "a refused note writes nothing");
  });
});

test("7.22 pluginRecords lists a switched-off plugin's records by kind, with how many and their ids, and removePluginRecords removes exactly what it was handed and nothing else, refusing a listing that no longer matches with nothing removed", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    // Written as the voice door writes them: straight into the table, a kind this library was opened without.
    await withTestClient(async (client) => {
      for (const [id, type] of [["voice.note_2", "voice.note"], ["voice.note_1", "voice.note"], ["voice.tag_1", "voice.tag"], ["voicemail.note_1", "voicemail.note"]]) {
        await client.query("INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, 1, '{}', now(), now())", [id, type]);
      }
    }, `storytree_${name}`);
    const story = await lib.addStory({ title: "Visitor can sign up" });

    const listed = await lib.pluginRecords("voice");
    assert.deepEqual(listed, {
      plugin: "voice",
      kinds: [
        { kind: "voice.note", count: 2, ids: ["voice.note_1", "voice.note_2"] },
        { kind: "voice.tag", count: 1, ids: ["voice.tag_1"] },
      ],
    });
    assert.deepEqual(await lib.pluginRecords("nobody"), { plugin: "nobody", kinds: [] });
    await assert.rejects(lib.pluginRecords("voice%"), /not a plugin's name/);

    // A listing that no longer matches the library is refused, and nothing is removed.
    const stale = { plugin: "voice", kinds: [{ kind: "voice.note", count: 1, ids: ["voice.note_1"] }] };
    await assert.rejects(lib.removePluginRecords(stale, "the owner removed voice"), /changed since they were listed/);
    assert.deepEqual(await lib.pluginRecords("voice"), listed);

    assert.deepEqual(await lib.removePluginRecords(listed, "the owner removed voice", { actor: "session:remove-test" }), listed);
    assert.deepEqual(await lib.pluginRecords("voice"), { plugin: "voice", kinds: [] });
    assert.deepEqual((await lib.pluginRecords("voicemail")).kinds.map(({ ids }) => ids), [["voicemail.note_1"]], "another plugin's records are kept");
    assert.deepEqual(await lib.get(story.id), story, "the core's records are kept");
    const removed = await lib.history({ id: "voice.tag_1" });
    assert.deepEqual(removed.map(({ action, reason, actor }) => ({ action, reason, actor })).at(-1), { action: "retired", reason: "the owner removed voice", actor: "session:remove-test" });
  });
});

test("7.19 routeFeedback marks a new feedback record routed with its route, target and reason; a missing, non-feedback or already routed record is refused with nothing written, and a routed record must carry its route and reason", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    const note = { text: "The gear menu hides the version", surface: "gear", version: "0.3.99", window: { width: 800, height: 600 }, theme: "light" as const, at: "2026-10-24T09:00:00.000Z" };
    const sent = await lib.sendFeedback(note);
    const routed = await lib.routeFeedback(sent.id, { route: "increment", routedTo: "increment_000000000001", routeReason: "The gear menu's arc owns it" }, { actor: "session:manager" });
    assert.deepEqual(routed?.fields, { ...note, status: "routed", screenshot: false, route: "increment", routedTo: "increment_000000000001", routeReason: "The gear menu's arc owns it" });
    assert.equal((await lib.history({ id: sent.id })).at(-1)!.actor, "session:manager");

    await assert.rejects(lib.routeFeedback(sent.id, { route: "closed", routeReason: "again" }), /already routed/);
    assert.equal(((await lib.get(sent.id))!.fields as { route?: string }).route, "increment", "a second route writes nothing");
    assert.equal(await lib.routeFeedback("feedback_000000000000", { route: "closed", routeReason: "gone" }), null);
    const arc = await lib.createArc({ title: "Gear", intent: "An intent", endState: "An end state" });
    assert.equal(await lib.routeFeedback(arc.id, { route: "closed", routeReason: "not a note" }), null);

    const other = await lib.sendFeedback({ ...note, text: "Another" });
    await assert.rejects(lib.routeFeedback(other.id, untyped({ route: "closed", routeReason: "" })), (error: Error) => error.name === "SchemaError", "a route needs its reason");
    const closed = await lib.routeFeedback(other.id, { route: "closed", routeReason: "Covered by increment_000000000002" });
    assert.equal(closed?.fields.status, "routed");
    assert.equal(closed?.fields.routedTo, undefined);
  });
});

test("7.10 projectTree marks a capability not proven that a parked arc's open work names with that arc, and drops the mark once the arc is unparked (ADR-0992)", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    const story = await lib.addStory({ title: "Visitor can sign up" });
    const form = await lib.addCapability({ title: "Email form", story: story.id });
    const arc = await lib.createArc({ title: "Identity", intent: "An intent", endState: "An end state" });
    await lib.addIncrement({ arc: arc.id, title: "Sign-in", objective: "Build it", body: "Later.", capabilities: [form.id] });
    const parkedOn = async () => (await lib.projectTree()).stories[0]!.capabilities[0]!.parkedOn;
    assert.equal(await parkedOn(), undefined, "an active arc's work needs attention");
    await lib.parkArc(arc.id);
    assert.deepEqual(await parkedOn(), [{ arc: arc.id, title: "Identity" }]);
    await lib.unparkArc(arc.id);
    assert.equal(await parkedOn(), undefined);
  });
});

test("7.4 editStory, editContract and editArc change only the fields they name, check a new reference as adding does, and give null for an id that is not a live record of their type", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    const story = await lib.addStory({ title: "Visitor can sign up", description: "With an email" });
    const other = await lib.addStory({ title: "Visitor can sign in" });
    const form = await lib.addCapability({ title: "Email form", story: story.id });
    const link = await lib.addCapability({ title: "Confirmation link", story: story.id });
    const contract = await lib.addContract({ title: "Rejects a bad email", capability: form.id, description: "Before sending" });
    const arc = await lib.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });

    // Only the named fields change; the others keep their stored values, and one set to undefined goes.
    assert.deepEqual((await lib.editStory(story.id, { title: "Visitor can sign up with email" }))?.fields, {
      title: "Visitor can sign up with email",
      description: "With an email",
    });
    assert.deepEqual((await lib.editStory(story.id, { description: undefined }))?.fields, { title: "Visitor can sign up with email" });
    assert.deepEqual((await lib.editContract(contract.id, { capability: link.id }))?.fields, {
      title: "1.1 · Rejects a bad email",
      capability: link.id,
      description: "Before sending",
    });
    assert.deepEqual((await lib.editArc(arc.id, { stories: [story.id, other.id], description: "The first release" }))?.fields, {
      title: "Launch v1",
      intent: "An intent",
      endState: "An end state",
      stories: [story.id, other.id],
      description: "The first release",
    });
    // The plan reads the edits: the story renamed, the contract under the capability it moved to, the arc grown.
    const tree = await lib.projectTree();
    assert.equal(tree.stories.find((node) => node.id === story.id)?.title, "Visitor can sign up with email");
    const capabilities = tree.stories.flatMap((node) => node.capabilities);
    assert.deepEqual(capabilities.find((node) => node.id === form.id)?.contracts, []);
    assert.deepEqual(capabilities.find((node) => node.id === link.id)?.contracts.map((node) => node.id), [contract.id]);
    assert.deepEqual((await lib.arcsFor(other.id)).map((node) => node.id), [arc.id]);

    // A new reference is checked as adding checks it; an id that is not a live record of the type
    // gives null. Neither writes anything.
    const before = await lib.changesSince(0);
    await assert.rejects(lib.editContract(contract.id, { capability: "capability_000000000000" }), MissingReferenceError);
    await assert.rejects(lib.editContract(contract.id, { capability: story.id }), MissingReferenceError, "a story is not a capability");
    await assert.rejects(lib.editArc(arc.id, { stories: [story.id, "story_000000000000"] }), MissingReferenceError);
    assert.equal(await lib.editStory("story_000000000000", { title: "Nothing" }), null);
    assert.equal(await lib.editStory(form.id, { title: "A capability, not a story" }), null);
    assert.equal(await lib.editContract(arc.id, { title: "An arc, not a contract" }), null);
    assert.equal(await lib.editArc(contract.id, { title: "A contract, not an arc" }), null);
    assert.deepEqual(await lib.changesSince(before.cursor), { changes: [], cursor: before.cursor }, "nothing was written");
  });
});

test("4.9 · retiring a capability refuses live dependents without writing, then succeeds once their links are gone", async () => {
  const name = uniqueProjectName();
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name);
    const story = await lib.addStory({ title: "The plan" });
    const otherStory = await lib.addStory({ title: "The world" });
    const target = await lib.addCapability({ story: story.id, title: "Source" });
    const unrelated = await lib.addCapability({ story: story.id, title: "Other source" });
    const first = await lib.addCapability({ story: story.id, title: "First dependent", dependsOn: [target.id, unrelated.id] });
    const second = await lib.addCapability({ story: otherStory.id, title: "Second dependent", dependsOn: [target.id] });
    const retired = await lib.addCapability({ story: otherStory.id, title: "Old dependent", dependsOn: [target.id] });
    await lib.retire(retired.id, "No longer used");
    const before = await lib.changesSince(0);
    const tree = await lib.projectTree();

    await assert.rejects(lib.retire(target.id, "No longer used"), (error: unknown) => {
      assert.ok(error instanceof RetireRefusedError);
      assert.equal(error.id, target.id);
      assert.deepEqual(new Set(error.heldBy), new Set([first.id, second.id]));
      for (const id of [target.id, first.id, second.id]) assert.ok(error.message.includes(id), error.message);
      assert.match(error.message, /dependsOn/);
      assert.ok(!error.message.includes(retired.id));
      return true;
    });
    assert.deepEqual(await lib.changesSince(before.cursor), { changes: [], cursor: before.cursor });
    assert.deepEqual(await lib.projectTree(), tree);
    assert.deepEqual(await lib.get(target.id), target);

    await lib.editCapability(first.id, { dependsOn: [unrelated.id] });
    await lib.retire(second.id, "No longer needed");
    await lib.retire(target.id, "Replaced", { actor: "session:retirer" });
    assert.equal(await lib.get(target.id), null);
    const remaining = await lib.get(first.id);
    assert.equal(remaining?.type, "capability");
    assert.deepEqual(remaining.fields.dependsOn, [unrelated.id]);
    const history = await lib.history({ id: target.id });
    assert.equal(history.at(-1)?.action, "retired");
    assert.equal(history.at(-1)?.reason, "Replaced");
    assert.equal(history.at(-1)?.actor, "session:retirer");
  });
});

/** A class a caller can catch an error by. */
type ErrorClass = new (...args: never[]) => Error;

/**
 * Run `body` with a fresh connection to the test server. Afterwards close it and drop the
 * databases of `projects`, whether the body passed or failed.
 */
async function withStorytree(projects: readonly string[], body: (storytree: Storytree) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  try {
    await body(storytree);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases(projects.map((project) => `storytree_${project}`));
    }
  }
}

/**
 * Every property name an object offers, its own and those it inherits (short of Object's), bar
 * `constructor`, sorted: what a caller holding it can reach.
 */
function surface(object: object): string[] {
  const names = new Set<string>();
  for (let level: object | null = object; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level) as object | null) {
    for (const key of Reflect.ownKeys(level)) if (key !== "constructor") names.add(String(key));
  }
  return [...names].sort();
}

/** The record a column's health entry is stored as, at version 1: created at `createdAt`, last saved at `updatedAt`. */
function healthRecord(id: string, fields: Record<string, unknown>, createdAt: string, updatedAt = createdAt): RecordEnvelope {
  return { id, type: "health", version: 1, fields, createdAt, updatedAt };
}

/** The changes without their seq, for comparing with what a test expects. */
function withoutSeq(changes: readonly Change[]): Omit<Change, "seq">[] {
  return changes.map(({ seq: _seq, ...change }) => change);
}

/** Assert that the changes' seqs are positive whole numbers, strictly increasing. */
function assertIncreasing(changes: readonly Change[]): void {
  let previous = 0;
  for (const change of changes) {
    assert.ok(Number.isSafeInteger(change.seq) && change.seq > previous, `seq ${change.seq} comes after ${previous}`);
    previous = change.seq;
  }
}

/** The item at `index`, which the test has made sure is there. */
function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

/** A value the compiler would refuse, sent the way a JavaScript caller or an agent could send it. */
function untyped(value: unknown): never {
  return value as never;
}

test("7.21 createPluginRecord saves a record of a plugin's kind the project was opened with, with the writer on its history; a kind it was not opened with, a core kind and fields outside the declared shape are refused with nothing written (ADR-1178 D3)", async () => {
  const name = uniqueProjectName();
  const note = { kind: "voice.note", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["storytree_voice"] };
  await withStorytree([name], async (storytree) => {
    const lib = await storytree.openProject(name, { kinds: [note] });
    const written = await lib.createPluginRecord("voice.note", { words: "park the globe idea" }, { actor: "voice door" });
    assert.deepEqual([written.type, written.fields], ["voice.note", { words: "park the globe idea" }]);
    assert.deepEqual((await lib.get(written.id))?.fields, { words: "park the globe idea" });
    assert.equal((await lib.history({ id: written.id })).at(-1)!.actor, "voice door");
    await assert.rejects(lib.createPluginRecord("voice.note", { said: "no words" }), { name: "SchemaError" });
    await assert.rejects(lib.createPluginRecord("story", { title: "Through the side door" }), { name: "UnknownTypeError" }, "a core kind has its own write");
    await assert.rejects(lib.createPluginRecord("chat.line", { words: "hello" }), { name: "UnknownTypeError" }, "a kind no mounted plugin declares");
    assert.deepEqual((await lib.history()).map((entry) => entry.recordId), [written.id], "nothing else was written");
    await lib.close();
  });
});
