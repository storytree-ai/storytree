/**
 * Capability 9 · Knowledge entrances: one test per contract 9.1-9.3 in stories/library.md, each
 * run on BOTH backends, as capability 6's tests are:
 *
 * - memory: a Knowledge over SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `knowledge` of a fresh project, opened through capability 1 on the server
 *   `pnpm test` provides and named with uniqueProjectName(). Its database is dropped afterwards,
 *   pass or fail. Other test files share that server, so a test only ever reads its own project.
 *
 * Every story and capability has its own shelf of front-cover decisions, and a decision can be a
 * front cover of one of them at most. Notes link only to other notes, so the only way from the
 * work into the knowledge is through a front cover (ADR-0627 in storytree 0.2's decision log).
 *
 * The work records are written straight through the typed layer (capability 3), as capability 6's
 * tests write them. Whether anything was written is judged one layer down, through the same
 * project's Transactions: every change appends a history entry, so an unchanged history means
 * nothing was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SchemaError, SchemaRecords, type RecordType } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { Knowledge, type NewDefinition, type NewMemory } from "./index.js";

/** A fresh, empty library: the knowledge layer under test, and the layers it runs over. */
interface Library {
  readonly knowledge: Knowledge;
  readonly records: SchemaRecords;
  readonly transactions: Transactions;
  cleanup(): Promise<void>;
}

interface Backend {
  readonly label: string;
  open(): Promise<Library>;
}

const memory: Backend = {
  label: "memory",
  async open() {
    const transactions = new MemoryTransactions();
    const records = new SchemaRecords(transactions);
    return { knowledge: new Knowledge(records), records, transactions, cleanup: async () => {} };
  },
};

const postgres: Backend = {
  label: "postgres",
  async open() {
    const name = uniqueProjectName();
    const storytree = await connect({ url: testServerUrl() });
    const cleanup = async (): Promise<void> => {
      try {
        await storytree.close();
      } finally {
        await dropTestDatabases([`storytree_${name}`]);
      }
    };
    try {
      const project = await storytree.openProject(name);
      return { knowledge: project.knowledge, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

/** Ids of the right shape that name no record. */
const NO_STORY = "story_000000000000";
const NO_CAPABILITY = "capability_000000000000";

/** Text the library cannot store (capability 3 refuses it): a NUL, and a lone UTF-16 surrogate. */
const UNSTORABLE = ["story_\u0000", "story_\uD83C"];

for (const backend of [memory, postgres]) {
  /** Register one test for this backend, run against a fresh library disposed of afterwards, pass or fail. */
  const contract = (number: string, title: string, body: (library: Library) => Promise<void>): void => {
    test(`${number} [${backend.label}] ${title}`, async () => {
      const library = await backend.open();
      try {
        await body(library);
      } finally {
        await library.cleanup();
      }
    });
  };

  contract("9.1", "a decision can be the front cover of a story or a capability, and frontCovers lists a node's covers, founding first", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const form = await records.create("capability", { title: "Email form", story: story.id });
    const login = await records.create("capability", { title: "Login", story: story.id });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: form.id });

    // The email form's shelf: several covers, written one after another in an order that is not
    // their ids' order, so the order frontCovers returns can only be the order they were written.
    const titles = ["Check the address on the server", "Send mail through a queue", "Show the error beside the field"];
    const shelf = await createInOrder(titles.length, (n) =>
      knowledge.recordDecision({ title: titles[n % titles.length] ?? "Another cover", text: "Chosen for the email form", frontCoverOf: form.id }),
    );
    const founding = at(shelf, 0);
    await assertCreated(transactions, founding, "decision", { title: titles[0], text: "Chosen for the email form", frontCoverOf: form.id });

    // A story has a shelf of its own, and so has every other capability.
    const storyCover = await knowledge.recordDecision({ title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    const loginCover = await knowledge.recordDecision({ title: "Magic links, no passwords", text: "Nothing to forget", frontCoverOf: login.id });
    // Behind the entrances, notes link to notes freely: a decision that is no node's cover, linked
    // from covers on two shelves, and a memory filed inside a cover.
    const shared = await knowledge.recordDecision({ title: "Keep queues in Postgres", text: "One database to run", links: [at(shelf, 1).id, loginCover.id] });
    const inside = await knowledge.writeMemory({ text: "The check rejects plus-addresses", links: [founding.id] });

    assert.deepEqual(await knowledge.frontCovers(form.id), shelf, "the email form's covers, founding first, as stored");
    assert.deepEqual(await knowledge.frontCovers(story.id), [storyCover], "a story's own shelf holds only its own covers");
    assert.deepEqual(await knowledge.frontCovers(login.id), [loginCover]);
    // Nothing else is on a shelf: a node with no covers, a contract, a note, an id naming nothing.
    for (const id of [contract.id, shared.id, founding.id, inside.id, NO_CAPABILITY]) {
      assert.deepEqual(await knowledge.frontCovers(id), [], `frontCovers(${JSON.stringify(id)})`);
    }
    // A cover is one exact id: part of it, or the same letters in another case, is another id.
    assert.deepEqual(await knowledge.frontCovers(form.id.slice(0, -1)), []);
    assert.deepEqual(await knowledge.frontCovers(form.id.toUpperCase()), []);
    // What sits behind a cover is reached from the cover: the notes that link to it.
    assert.deepEqual(await knowledge.relatedNotes(founding.id), [inside]);
    assert.deepEqual(await knowledge.relatedNotes(loginCover.id), [shared]);

    // A shelf reads the covers as they are now. A retired cover is gone from it.
    await records.retire(at(shelf, 2).id, "folded into the first cover");
    const kept = shelf.filter((_, n) => n !== 2);
    assert.deepEqual(await knowledge.frontCovers(form.id), kept);
    // Moving a cover to another node takes it off one shelf and puts it on the other, in its place
    // by creation, not by the latest change.
    const moved = await knowledge.editNote(loginCover.id, { frontCoverOf: form.id });
    assert.deepEqual(await knowledge.frontCovers(form.id), [...kept, moved]);
    assert.deepEqual(await knowledge.frontCovers(login.id), []);

    // Replacing a cover takes only ordinary writes: the replacement becomes a cover of the same
    // node and links to the old one, then the old one's mark is removed. It leaves the shelf and is
    // still reached, one step in, from the cover that replaced it, with what was filed inside it.
    await clockPast(moved?.updatedAt ?? assert.fail("the cover was not moved"));
    const replacement = await knowledge.recordDecision({
      title: "Check the address on the server and in the browser",
      text: "Faster feedback",
      frontCoverOf: form.id,
      links: [founding.id],
    });
    const unshelved = await knowledge.editNote(founding.id, { frontCoverOf: undefined });
    assert.deepEqual(unshelved?.fields, { title: titles[0], text: "Chosen for the email form" }, "the mark is gone, and nothing else changed");
    assert.deepEqual(await knowledge.frontCovers(form.id), [...kept.slice(1), moved, replacement]);
    assert.deepEqual(await knowledge.relatedNotes(founding.id), [inside, replacement]);
  });

  contract("9.2", "a front cover naming anything but a live story or capability is refused, and nothing is written", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const capability = await records.create("capability", { title: "Email form", story: story.id });
    const arc = await records.create("arc", { title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: capability.id });
    const health = await records.create("health", { node: contract.id, column: "reported", state: "passing" });
    const note = await knowledge.writeMemory({ text: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ title: "Use Mailgun", text: "Its API is the simplest" });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const retired = await records.create("story", { title: "Visitor can pay" });
    await records.retire(retired.id, "out of scope");
    const before = await transactions.history();

    // Anything but a live story or capability: a record of another type, a missing or retired one,
    // the same letters in another case. The error names the field, the id and what it found.
    const refused: [id: string, found: RecordType | undefined][] = [
      [contract.id, "contract"],
      [arc.id, "arc"],
      [health.id, "health"],
      [note.id, "memory"],
      [decision.id, "decision"],
      [definition.id, "definition"],
      [NO_STORY, undefined],
      [retired.id, undefined],
      [story.id.toUpperCase(), undefined],
      ["", undefined],
    ];
    for (const [id, found] of refused) {
      await assert.rejects(knowledge.recordDecision({ title: "Use Postmark", text: "Better delivery", frontCoverOf: id }), missingCover(id, found));
      await assert.rejects(knowledge.editNote(decision.id, { text: "Reconsidered", frontCoverOf: id }), missingCover(id, found));
    }
    // One field names one node: a list of nodes is refused by the schema check, naming the field.
    // So no decision can be the cover of two.
    const both = [story.id, capability.id] as unknown as string;
    await assert.rejects(knowledge.recordDecision({ title: "Use Postmark", text: "Better delivery", frontCoverOf: both }), schemaError("decision", ["frontCoverOf"]));
    await assert.rejects(knowledge.editNote(decision.id, { frontCoverOf: both }), schemaError("decision", ["frontCoverOf"]));
    // Only a decision can be a front cover: a memory note or a definition has no such field.
    await assert.rejects(
      knowledge.writeMemory({ text: "Wants to be a cover", frontCoverOf: story.id } as unknown as NewMemory),
      schemaError("memory", ["frontCoverOf"]),
    );
    await assert.rejects(
      knowledge.defineTerm({ term: "Cover", meaning: "Wants to be one", frontCoverOf: capability.id } as unknown as NewDefinition),
      schemaError("definition", ["frontCoverOf"]),
    );
    await assert.rejects(knowledge.editNote(note.id, { frontCoverOf: story.id }), schemaError("memory", ["frontCoverOf"]));
    // An id holding text the library cannot store is never looked up: the schema check refuses it.
    for (const bad of UNSTORABLE) {
      await assert.rejects(knowledge.recordDecision({ title: "Odd", text: "Cover", frontCoverOf: bad }), schemaError("decision", ["frontCoverOf"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(decision.id), decision, "the edited decision is unchanged");

    // Control: a live story and a live capability are accepted, by a new decision and by an edit.
    const storyCover = await knowledge.recordDecision({ title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    await assertCreated(transactions, storyCover, "decision", { title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    const covered = await knowledge.editNote(decision.id, { frontCoverOf: capability.id });
    assert.deepEqual(covered?.fields, { title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
  });

  contract("9.3", "a note linking to a story, capability, contract, arc or health entry is refused, and nothing is written", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const capability = await records.create("capability", { title: "Email form", story: story.id });
    const arc = await records.create("arc", { title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: capability.id });
    const health = await records.create("health", { node: contract.id, column: "reported", state: "passing" });
    const note = await knowledge.writeMemory({ text: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const before = await transactions.history();

    // Every kind of work record, linked by every kind of note, new or edited. The first link that
    // is not a note is the one named.
    for (const work of [story, capability, arc, contract, health]) {
      const attempts: (() => Promise<unknown>)[] = [
        () => knowledge.writeMemory({ text: "About the work", links: [work.id] }),
        () => knowledge.recordDecision({ title: "About the work", text: "Linked", links: [note.id, work.id] }),
        () => knowledge.defineTerm({ term: "Work", meaning: "Linked", links: [definition.id, work.id, story.id] }),
        () => knowledge.editNote(note.id, { links: [decision.id, work.id] }),
        () => knowledge.editNote(decision.id, { text: "Reconsidered", links: [work.id] }),
      ];
      for (const attempt of attempts) await assert.rejects(attempt(), linkToWork(work.id, work.type));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    for (const unchanged of [note, decision, definition]) {
      assert.deepEqual(await transactions.get(unchanged.id), unchanged, "the edited notes are unchanged");
    }

    // Control: links to live notes of all three kinds are accepted, by every kind of note and by an
    // edit (which may link a note to itself). A front cover links to notes like any other decision.
    const notes = [note.id, decision.id, definition.id];
    const linked = await knowledge.writeMemory({ text: "Links to every kind", links: notes });
    await assertCreated(transactions, linked, "memory", { text: "Links to every kind", links: notes });
    const decided = await knowledge.recordDecision({ title: "Keep it linked", text: "Behind the cover", frontCoverOf: story.id, links: notes });
    await assertCreated(transactions, decided, "decision", { title: "Keep it linked", text: "Behind the cover", frontCoverOf: story.id, links: notes });
    const defined = await knowledge.defineTerm({ term: "Everything", meaning: "All of it", links: notes });
    await assertCreated(transactions, defined, "definition", { term: "Everything", meaning: "All of it", links: notes });
    const relinked = await knowledge.editNote(note.id, { links: [note.id, linked.id, ...notes] });
    assert.deepEqual(relinked?.fields, { text: "Mailgun needs a verified domain", links: [note.id, linked.id, ...notes] });
  });
}

/**
 * Assert that `record` is a new record of `type` holding exactly `fields`, under an id the library
 * generated, and that it is stored exactly as returned.
 */
async function assertCreated(
  transactions: Transactions,
  record: RecordEnvelope,
  type: RecordType,
  fields: Record<string, unknown>,
): Promise<void> {
  assert.match(record.id, new RegExp(`^${type}_[0-9a-f]{12}$`), `a generated ${type} id: ${record.id}`);
  assert.deepEqual(
    record,
    { id: record.id, type, version: 1, fields, createdAt: record.createdAt, updatedAt: record.createdAt },
    `a new ${type}, holding exactly the fields given`,
  );
  assert.deepEqual(await transactions.get(record.id), record, `the ${type} is stored as returned`);
}

/** Wait until the clock has passed `timestamp`, so whatever is written next is stamped strictly later. */
async function clockPast(timestamp: string): Promise<void> {
  while (Date.now() <= Date.parse(timestamp)) await sleep(1);
}

/**
 * Create records one after another with `create`, each strictly later than the one before, until
 * there are at least `count` and their ids' own order is NOT their creation order. Any order a
 * test then sees them in can only be creation order, never the id order `list` hands back.
 */
async function createInOrder<R extends { readonly id: string; readonly createdAt: string }>(
  count: number,
  create: (n: number) => Promise<R>,
): Promise<R[]> {
  const created: R[] = [];
  while (created.length < count || inIdOrder(created)) {
    const record = await create(created.length);
    created.push(record);
    await clockPast(record.createdAt);
  }
  return created;
}

function inIdOrder(records: readonly { readonly id: string }[]): boolean {
  return records.every((record, n) => n === 0 || at(records, n - 1).id < record.id);
}

/** The item at `index`, which the test has made sure is there. */
function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

/**
 * An assert.rejects check: a MissingReferenceError for field `frontCoverOf` holding `id`, which may
 * name only a live story or capability. `found` is the type the id does name, when it names a live
 * record of another type. The message names the field and the id.
 */
function missingCover(id: string, found: RecordType | undefined): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "frontCoverOf", id, expected: "story or capability", found },
      error.message,
    );
    for (const part of [JSON.stringify("frontCoverOf"), JSON.stringify(id)]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    return true;
  };
}

/**
 * An assert.rejects check: a MissingReferenceError for field `links` holding `id`, a live work
 * record of type `found`, which a note may not link to. The message names the field and the id.
 */
function linkToWork(id: string, found: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "links", id, expected: "note", found },
      error.message,
    );
    for (const part of [JSON.stringify("links"), JSON.stringify(id)]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    return true;
  };
}

/** An assert.rejects check: a SchemaError (capability 3) for `type` whose fields at fault are exactly `fields`. */
function schemaError(type: RecordType, fields: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
    assert.equal(error.type, type, error.message);
    assert.deepEqual([...error.fields].sort(), [...fields].sort(), `the fields at fault: ${error.message}`);
    return true;
  };
}

