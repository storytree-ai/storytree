/**
 * Capability 6 · Knowledge and memory: one test per contract 6.1-6.5 in stories/library.md, each
 * run on BOTH backends, as capabilities 2-4 are:
 *
 * - memory: a Knowledge over SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `knowledge` of a fresh project, opened through capability 1 on the server
 *   `pnpm test` provides and named with uniqueProjectName(). Its database is dropped afterwards,
 *   pass or fail. Other test files share that server, so a test only ever reads its own project.
 *
 * Notes link only to other notes (capability 9, stories/library.md). The few work records these
 * tests need are written straight through the typed layer (capability 3), since capability 6
 * depends on 3 alone.
 * Whether anything was written is judged one layer down, through the same project's
 * Transactions: every change appends a history entry (capability 2), so an unchanged history
 * means nothing was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SchemaError, SchemaRecords, type RecordType } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { Knowledge, type Note } from "./index.js";

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
      // The project handle's own knowledge and layers: knowledge as later stories reach it.
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
const NO_MEMORY = "memory_000000000000";

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

  contract("6.1", "a memory note is found by search on any word it contains, whatever its case", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    // A note for the memory to link to, holding none of the words searched for below.
    const signup = await knowledge.defineTerm({ term: "Signup", meaning: "Joining the site" });
    await laterThan(signup);
    const memory = await knowledge.writeMemory({ text: "Mailgun needs a verified domain", links: [signup.id] });
    await assertCreated(transactions, memory, "memory", { text: "Mailgun needs a verified domain", links: [signup.id] });

    // Each word it contains finds it, in any case.
    for (const word of ["Mailgun", "needs", "a", "verified", "domain"]) {
      for (const query of [word, word.toLowerCase(), word.toUpperCase(), alternateCase(word)]) {
        assert.deepEqual(await knowledge.search(query), [memory], `search(${JSON.stringify(query)})`);
      }
    }
    // A word is found wherever it appears in the text, so part of a word finds it too.
    assert.deepEqual(await knowledge.search("MAIL"), [memory]);
    // Several words find it when every one of them is in it, in any order, however spaced.
    assert.deepEqual(await knowledge.search("domain VERIFIED mailgun"), [memory]);
    assert.deepEqual(await knowledge.search("  needs\tA\n domain "), [memory]);
    // One word it does not contain rules it out, even beside words it does.
    assert.deepEqual(await knowledge.search("mailgun postmark"), []);
    assert.deepEqual(await knowledge.search("sendgrid"), []);
    // A link is an id, not a word: the linked note's id does not find the note that links to it.
    assert.deepEqual(await knowledge.search(signup.id), []);
    await laterThan(memory);

    // Beside other notes: exactly the notes holding every word, of all three kinds, in creation
    // order. A decision is searched by its title and its text, a definition by its term and its
    // meaning. Records that are not notes are never returned, whatever words they hold.
    const decision = await knowledge.recordDecision({ title: "Use Mailgun", text: "Its API is the simplest to call", links: [signup.id] });
    await laterThan(decision);
    const definition = await knowledge.defineTerm({ term: "Verified domain", meaning: "A domain whose DNS records prove we own it" });
    await laterThan(definition);
    const pricing = await knowledge.writeMemory({ text: "The pricing page needs a rewrite" });
    await records.create("story", { title: "Mailgun webhook", description: "Verified domain events" });
    await records.create("capability", { title: "Mailgun webhook receiver", story: story.id });
    await records.create("arc", { title: "Mailgun migration", intent: "An intent", endState: "An end state" });

    const searches: [query: string, found: Note[]][] = [
      ["mailgun", [memory, decision]],
      ["MAILGUN simplest", [decision]], // across a decision's title and text
      ["api", [decision]], // a decision's text
      ["use", [decision]], // a decision's title
      ["verified domain", [memory, definition]], // a definition's term
      ["dns OWN", [definition]], // a definition's meaning
      ["needs a", [memory, pricing]],
      ["webhook", []], // held only by records that are not notes
      ["migration", []],
    ];
    for (const [query, found] of searches) {
      assert.deepEqual(await knowledge.search(query), found, `search(${JSON.stringify(query)})`);
    }
    // An empty query holds no word for a note to miss, so every note matches it (the rule, read literally).
    assert.deepEqual(await knowledge.search(""), [signup, memory, decision, definition, pricing]);
    assert.deepEqual(await knowledge.search(" \t\n"), [signup, memory, decision, definition, pricing]);

    // Search reads the notes as they are now: a retired note is not found, and an edited one is
    // found by its new words and no longer by its old ones.
    await records.retire(pricing.id, "rewritten");
    assert.deepEqual(await knowledge.search("pricing"), []);
    const edited = await knowledge.editNote(memory.id, { text: "Postmark needs a verified sender" });
    assert.deepEqual(await knowledge.search("postmark SENDER"), [edited]);
    assert.deepEqual(await knowledge.search("mailgun"), [decision]);
    // The edited note keeps its place: results come in creation order, not in order of the latest change.
    assert.deepEqual(await knowledge.search("verified"), [edited, definition]);

    // Case is ignored beyond ASCII too.
    const accented = await knowledge.defineTerm({ term: "Déjà vu", meaning: "Élan, café and naïveté" });
    assert.deepEqual(await knowledge.search("DÉJÀ élan"), [accented]);
    assert.deepEqual(await knowledge.search("CAFÉ naÏvetÉ"), [accented]);
  });

  contract("6.2", "relatedNotes(noteId) returns every note, decision and definition that links to that note", async ({ knowledge, records }) => {
    const target = await knowledge.defineTerm({ term: "Signup", meaning: "Joining the site" });
    const other = await knowledge.writeMemory({ text: "Sign in comes next" });
    const quiet = await knowledge.writeMemory({ text: "Nothing links here" });

    // Notes of all three kinds linking to the target, created one after another in an order that
    // is neither their ids' order nor grouped by kind. The decisions list the other note first.
    const linking = await createInOrder<Note>(3, (n) => {
      if (n % 3 === 0) return knowledge.defineTerm({ term: `Term ${n}`, meaning: "Defined", links: [target.id] });
      if (n % 3 === 1) return knowledge.writeMemory({ text: `Memory ${n}`, links: [target.id] });
      return knowledge.recordDecision({ title: `Decision ${n}`, text: "Chosen", links: [other.id, target.id] });
    });
    // Notes that do not link to it: one with no links, one listing none, one linking elsewhere.
    const unlinked = await knowledge.writeMemory({ text: "Links nothing" });
    await knowledge.recordDecision({ title: "Nothing to link", text: "Yet", links: [] });
    const elsewhere = await knowledge.defineTerm({ term: "Sign in", meaning: "Coming back", links: [other.id] });

    assert.deepEqual(
      await knowledge.relatedNotes(target.id),
      linking,
      "every note linking to it, of all three kinds, as stored, in creation order",
    );
    assert.deepEqual(await knowledge.relatedNotes(other.id), [...linking.filter((note) => note.type === "decision"), elsewhere]);
    assert.deepEqual(await knowledge.relatedNotes(quiet.id), [], "a note no note links to");
    assert.deepEqual(await knowledge.relatedNotes(NO_MEMORY), [], "an id naming no record");
    // A link is to one exact id: part of it, or the same letters in another case, is another id.
    assert.deepEqual(await knowledge.relatedNotes(target.id.slice(0, -1)), [], "part of a linked id");
    assert.deepEqual(await knowledge.relatedNotes(target.id.toUpperCase()), [], "a linked id in another case");

    // A note linking to a note that links to the target is related to the note it links to, not
    // to the target. A story has no related notes: no note may link to one (capability 9), and its
    // knowledge is reached through its front covers instead.
    const decision = at(linking, 2);
    const followUp = await knowledge.writeMemory({ text: "Revisit this decision", links: [decision.id] });
    const story = await records.create("story", { title: "Visitor can sign up" });
    assert.deepEqual(await knowledge.relatedNotes(decision.id), [followUp]);
    assert.deepEqual(await knowledge.relatedNotes(story.id), []);
    assert.deepEqual(await knowledge.relatedNotes(target.id), linking);

    // Links as they are now: a retired note drops out, as does a note edited to drop its link,
    // and a note edited to add the link comes in.
    await records.retire(at(linking, 0).id, "superseded");
    await knowledge.editNote(at(linking, 1).id, { links: [] });
    const joined = await knowledge.editNote(unlinked.id, { links: [quiet.id, target.id] });
    assert.deepEqual(await knowledge.relatedNotes(target.id), [...linking.slice(2), joined]);
    // A note edited after the others keeps its place: the order is creation order, not the order
    // of the latest change.
    await clockPast(joined?.updatedAt ?? assert.fail("the note was not edited"));
    const revised = await knowledge.editNote(at(linking, 2).id, { text: "Chosen again" });
    assert.deepEqual(await knowledge.relatedNotes(target.id), [revised, ...linking.slice(3), joined]);
  });

  contract("6.3", "editing a decision keeps its old wording in history", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const domain = await knowledge.defineTerm({ term: "Sending domain", meaning: "The domain our mail comes from" });
    const decision = await knowledge.recordDecision({ title: "Use Mailgun", text: "Its API is the simplest to call", links: [domain.id] });
    await assertCreated(transactions, decision, "decision", { title: "Use Mailgun", text: "Its API is the simplest to call", links: [domain.id] });

    // Reworded, then retitled: each edit changes only the fields it names.
    const reworded = await knowledge.editNote(decision.id, { text: "Postmark delivers more of our mail" });
    assert.ok(reworded);
    assert.deepEqual(reworded, {
      ...decision,
      fields: { title: "Use Mailgun", text: "Postmark delivers more of our mail", links: [domain.id] },
      updatedAt: reworded.updatedAt,
    });
    const retitled = await knowledge.editNote(decision.id, { title: "Use Postmark" });
    assert.deepEqual(retitled?.fields, { title: "Use Postmark", text: "Postmark delivers more of our mail", links: [domain.id] });
    assert.deepEqual(await records.get(decision.id), retitled, "get reads the latest wording");

    // history({ id }) keeps every wording, oldest first: the old text and the old title are still there.
    const kept = await records.history({ id: decision.id });
    assert.deepEqual(
      kept.map(({ action, record }) => ({ action, record })),
      [
        { action: "created", record: decision },
        { action: "updated", record: reworded },
        { action: "updated", record: retitled },
      ],
    );
    assert.equal(kept[0]?.record.fields.text, "Its API is the simplest to call", "the old wording is kept");
    assert.equal(kept[1]?.record.fields.title, "Use Mailgun", "and so is the old title");

    // A memory note and a definition keep their old wording the same way; a link can be removed.
    const memory = await knowledge.writeMemory({ text: "Mailgun needs a verified domain", links: [decision.id] });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message the server sent back" });
    const rewritten = await knowledge.editNote(memory.id, { text: "Postmark needs a verified sender", links: undefined });
    assert.deepEqual(rewritten?.fields, { text: "Postmark needs a verified sender" });
    await knowledge.editNote(definition.id, { meaning: "A message that could not be delivered" });
    assert.deepEqual(
      (await records.history({ id: memory.id })).map(({ record }) => record.fields),
      [{ text: "Mailgun needs a verified domain", links: [decision.id] }, { text: "Postmark needs a verified sender" }],
    );
    assert.deepEqual(
      (await records.history({ id: definition.id })).map(({ record }) => record.fields),
      [
        { term: "Bounce", meaning: "A message the server sent back" },
        { term: "Bounce", meaning: "A message that could not be delivered" },
      ],
    );

    // editNote edits notes only: a story, a capability, a retired or missing note is not changed
    // through it; it returns null and writes nothing. A field the note's kind does not have, or an
    // edit that would leave it invalid, is refused by the schema check, naming the field.
    const capability = await records.create("capability", { title: "Email form", story: story.id });
    const dropped = await knowledge.writeMemory({ text: "Dropped" });
    await records.retire(dropped.id, "written by mistake");
    const before = await transactions.history();
    for (const id of [story.id, capability.id, dropped.id, NO_MEMORY, ...UNSTORABLE]) {
      assert.equal(await knowledge.editNote(id, { title: "Renamed" }), null, `editNote(${JSON.stringify(id)})`);
    }
    await assert.rejects(knowledge.editNote(memory.id, { title: "Memories have no title" }), schemaError("memory", ["title"]));
    await assert.rejects(knowledge.editNote(decision.id, { text: "" }), schemaError("decision", ["text"]));
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(story.id), story, "the story keeps its title");
  });

  contract("6.4", "a link to a record that does not exist is refused", async ({ knowledge, records, transactions }) => {
    // A live note of every kind, and a retired one. (A link to a work record is refused as well,
    // since notes link only to notes: that is capability 9's contract 9.3.)
    const memory = await knowledge.writeMemory({ text: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ title: "Use Mailgun", text: "Its API is the simplest" });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const retired = await knowledge.writeMemory({ text: "Postmark is cheaper" });
    await records.retire(retired.id, "out of date");
    const before = await transactions.history();

    const refused: [attempt: () => Promise<unknown>, id: string][] = [
      [() => knowledge.writeMemory({ text: "Linked to nothing", links: [NO_STORY] }), NO_STORY],
      [() => knowledge.writeMemory({ text: "Linked to nothing", links: [decision.id, NO_MEMORY] }), NO_MEMORY],
      [() => knowledge.recordDecision({ title: "Use Postmark", text: "Better delivery", links: [retired.id] }), retired.id],
      [
        () => knowledge.recordDecision({ title: "Use Postmark", text: "Better delivery", links: [memory.id, memory.id.toUpperCase()] }),
        memory.id.toUpperCase(),
      ],
      [() => knowledge.defineTerm({ term: "Hard bounce", meaning: "A permanent failure", links: [""] }), ""],
      // The first bad link is the one named.
      [
        () => knowledge.defineTerm({ term: "Hard bounce", meaning: "A permanent failure", links: [definition.id, "definition_000000000000", NO_STORY] }),
        "definition_000000000000",
      ],
      [() => knowledge.editNote(memory.id, { links: [NO_STORY] }), NO_STORY],
      [() => knowledge.editNote(decision.id, { text: "Reconsidered", links: [memory.id, retired.id] }), retired.id],
    ];
    for (const [attempt, id] of refused) {
      await assert.rejects(attempt(), missingLink(id));
    }
    // An id holding text the library cannot store is never looked up (Postgres cannot even be
    // asked for one): the write's schema check refuses it, naming links, on both backends.
    for (const bad of UNSTORABLE) {
      await assert.rejects(knowledge.writeMemory({ text: "Odd link", links: [bad] }), schemaError("memory", ["links"]));
      await assert.rejects(knowledge.editNote(definition.id, { links: [memory.id, bad] }), schemaError("definition", ["links"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(memory.id), memory, "the edited notes are unchanged");
    assert.deepEqual(await transactions.get(decision.id), decision);
    assert.deepEqual(await transactions.get(definition.id), definition);

    // Control: links to live notes of every kind are accepted, by every kind of note and by an
    // edit (which may link a note to itself).
    const notes = [memory, decision, definition].map((record) => record.id);
    const linked = await knowledge.writeMemory({ text: "Links to every kind", links: notes });
    await assertCreated(transactions, linked, "memory", { text: "Links to every kind", links: notes });
    const decided = await knowledge.recordDecision({ title: "Keep it all", text: "Linked", links: notes });
    await assertCreated(transactions, decided, "decision", { title: "Keep it all", text: "Linked", links: notes });
    const defined = await knowledge.defineTerm({ term: "Everything", meaning: "All of it", links: notes });
    await assertCreated(transactions, defined, "definition", { term: "Everything", meaning: "All of it", links: notes });
    const relinked = await knowledge.editNote(memory.id, { links: [linked.id, ...notes] });
    assert.deepEqual(relinked?.fields, { text: "Mailgun needs a verified domain", links: [linked.id, ...notes] });
  });

  contract("6.5", "definitions() returns every live definition, and nothing else, in creation order", async ({ knowledge, records }) => {
    const claim = await knowledge.defineTerm({ term: "Claim", meaning: "Holding a capability while you build it" });
    await laterThan(claim);
    await knowledge.writeMemory({ text: "Claim before you build" });
    await knowledge.recordDecision({ title: "Claims have no queue", text: "A second agent picks other work" });
    const quiet = await knowledge.defineTerm({ term: "Quiet time", meaning: "How long a session may say nothing before it reads as idle" });
    const retired = await knowledge.defineTerm({ term: "Wisp", meaning: "0.2's picture of a claim" });
    await records.retire(retired.id, "not in 0.3");
    const edited = await knowledge.editNote(claim.id, { meaning: "Holding a capability while you build it, so nobody else takes it" });
    assert.deepEqual(await knowledge.definitions(), [edited, quiet]);
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

/** Wait until the clock has passed `record`'s creation, so the next record is created strictly later. */
async function laterThan(record: { readonly createdAt: string }): Promise<void> {
  await clockPast(record.createdAt);
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
    await laterThan(record);
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

/** `word` with its letters' case alternating: `mAiLgUn`. */
function alternateCase(word: string): string {
  return [...word].map((letter, n) => (n % 2 === 0 ? letter.toLowerCase() : letter.toUpperCase())).join("");
}

/**
 * An assert.rejects check: a MissingReferenceError for field `links` holding `id`, which may name
 * only a live note (capability 9), and names no live record at all. The message names the field and the id.
 */
function missingLink(id: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "links", id, expected: "note", found: undefined },
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
