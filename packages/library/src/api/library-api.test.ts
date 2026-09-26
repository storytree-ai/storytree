/**
 * Capability 7 · Library API: one test per contract 7.1-7.3 in stories/library.md, run through the
 * package's public entry the way every later story will reach the library: `@storytree/library`,
 * the package importing itself by name. They run against the real Postgres `pnpm test` provides.
 * There is no backend choice here: the public API is the library on Postgres.
 *
 * Every project is named with uniqueProjectName() and its database is dropped afterwards, pass or
 * fail. Other test files share the server, so a test only ever reads its own project.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, MissingReferenceError, type Change, type NodeHealth, type RecordEnvelope, type Storytree } from "@storytree/library";
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
  "addStory",
  "createArc",
  "addCapability",
  "editStory",
  "editCapability",
  "addContract",
  "editContract",
  "editArc",
  "projectTree",
  "arcsFor",
  "addIncrement",
  "advanceIncrement",
  "closeIncrement",
  "editIncrement",
  "parkArc",
  "unparkArc",
  "arcView",
  "addWait",
  "removeWait",
  "waitHolds",
  "raiseQuestion",
  "settleQuestion",
  "questions",
  "heldOnQuestion",
  "reportHealth",
  "recordVerified",
  "health",
  "healthHistory",
  "writeMemory",
  "recordDecision",
  "defineTerm",
  "writeKnowledge",
  "definitions",
  "editNote",
  "search",
  "relatedNotes",
  "frontCovers",
  "decision",
  "composeStatement",
  "retire",
  "changesSince",
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
 * already held, and a decision superseding itself, are refused.
 */
const RUNTIME_EXPORTS = [
  "ConnectionError",
  "DependencyLoopError",
  "LifecycleError",
  "MissingReferenceError",
  "MissingUpgradeError",
  "NewerSchemaError",
  "NumberTakenError",
  "ProjectNameError",
  "RetireRefusedError",
  "SchemaError",
  "SupersessionLoopError",
  "UnknownTypeError",
  "WaitLoopError",
  "connect",
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
    assert.deepEqual(await lib.projectTree(), { stories: [], arcs: [] }, "its plan is empty");
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
              title: "Email form",
              dependsOn: [],
              health: rolledUp,
              contracts: [{ id: contract.id, title: "Rejects a bad email", health: contractHealth }],
            },
          ],
        },
      ],
      arcs: [{ id: arc.id, title: "Launch v1", stories: [story.id] }],
    });
    assert.deepEqual(await lib.projectTree(), planWith(UNCHECKED, UNCHECKED), "the plan, nested, with nothing checked yet");

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
    const memory = await lib.writeMemory({ text: "Mailgun needs a verified domain", links: [cover.id] });
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
      { recordId: memory.id, type: "memory", action: "created", record: memory },
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
    const memory = await lib.writeMemory({ text: "Mailgun needs a verified domain" });
    const reworded = await lib.editNote(memory.id, { text: "Mailgun needs a verified sending domain" });
    await lib.retire(memory.id, "folded into a decision");
    const decision = await lib.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
    assert.equal(await lib.editCapability("capability_000000000000", { title: "Nothing" }), null);
    assert.equal(await lib.editNote(memory.id, { text: "Retired, so not edited" }), null);
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
      { recordId: memory.id, type: "memory", action: "created", record: memory },
      { recordId: memory.id, type: "memory", action: "updated", record: reworded },
      { recordId: memory.id, type: "memory", action: "retired", record: reworded },
      { recordId: decision.id, type: "decision", action: "created", record: decision },
    ]);
    assert.deepEqual(await follow(), []);
    // A change carries no reason, but the history keeps the one retire was given (seen from outside the library).
    const reasons = await withTestClient(
      async (client) =>
        (await client.query<{ reason: string }>("SELECT reason FROM record_event WHERE record_id = $1 AND action = 'retired'", [memory.id])).rows,
      `storytree_${name}`,
    );
    assert.deepEqual(reasons, [{ reason: "folded into a decision" }]);

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
    const writes = Promise.all(Array.from({ length: 8 }, (_, n) => lib.writeMemory({ text: `Raced note ${n}` }))).finally(() => {
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
    // connect() hands back exactly openProject, listProjects and close, and openProject a Library
    // with exactly the API's name and methods. Neither exposes the internals.
    assert.deepEqual(surface(storytree), ["close", "listProjects", "openProject"]);
    const lib = await storytree.openProject(name);
    assert.deepEqual(surface(lib), [...LIBRARY_API].sort());
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
      title: "Rejects a bad email",
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
