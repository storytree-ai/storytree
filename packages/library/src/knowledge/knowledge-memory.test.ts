// Capability 6 · Knowledge artifacts
import assert from "node:assert/strict";
import { test } from "node:test";

import { waitUntil } from "@storytree/test-waits";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type RecordType } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { Knowledge, type Note } from "./index.js";

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

const NO_STORY = "story_000000000000";
const NO_MEMORY = "memory_000000000000";

const UNSTORABLE = ["story_\u0000", "story_\uD83C"];

for (const backend of [memory, postgres]) {
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

  contract("6.1", "a definition is found by search on any word it contains, whatever its case", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const signup = await knowledge.defineTerm({ term: "Signup", meaning: "Joining the site" });
    await laterThan(signup);
    const memory = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [signup.id] });
    await assertCreated(transactions, memory, "definition", { term: "Delivery", meaning: "Mailgun needs a verified domain", links: [signup.id] });

    for (const word of ["Mailgun", "needs", "a", "verified", "domain"]) {
      for (const query of [word, word.toLowerCase(), word.toUpperCase(), alternateCase(word)]) {
        assert.deepEqual(await knowledge.search(query), [memory], `search(${JSON.stringify(query)})`);
      }
    }
    assert.deepEqual(await knowledge.search("MAIL"), [memory]);
    assert.deepEqual(await knowledge.search("domain VERIFIED mailgun"), [memory]);
    assert.deepEqual(await knowledge.search("  needs\tA\n domain "), [memory]);
    assert.deepEqual(await knowledge.search("mailgun postmark"), []);
    assert.deepEqual(await knowledge.search("sendgrid"), []);
    assert.deepEqual(await knowledge.search(signup.id), []);
    await laterThan(memory);

    const decision = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest to call", links: [signup.id] });
    await laterThan(decision);
    const definition = await knowledge.defineTerm({ term: "Verified domain", meaning: "A domain whose DNS records prove we own it" });
    await laterThan(definition);
    const pricing = await knowledge.defineTerm({ term: "Delivery", meaning: "The pricing page needs a rewrite" });
    await records.create("story", { title: "Mailgun webhook", description: "Verified domain events" });
    await records.create("capability", { title: "Mailgun webhook receiver", story: story.id, proposed: true });
    await records.create("arc", { title: "Mailgun migration", intent: "An intent", endState: "An end state" });

    const searches: [query: string, found: Note[]][] = [
      ["mailgun", [memory, decision]],
      ["MAILGUN simplest", [decision]],
      ["api", [decision]],
      ["use", [decision]],
      ["verified domain", [memory, definition]],
      ["dns OWN", [definition]],
      ["needs a", [memory, pricing]],
      ["webhook", []],
      ["migration", []],
    ];
    for (const [query, found] of searches) {
      assert.deepEqual(await knowledge.search(query), found, `search(${JSON.stringify(query)})`);
    }
    assert.deepEqual(await knowledge.search(""), [signup, memory, decision, definition, pricing]);
    assert.deepEqual(await knowledge.search(" \t\n"), [signup, memory, decision, definition, pricing]);

    await records.retire(pricing.id, "rewritten");
    assert.deepEqual(await knowledge.search("pricing"), []);
    const edited = await knowledge.editNote(memory.id, { meaning: "Postmark needs a verified sender" });
    assert.deepEqual(await knowledge.search("postmark SENDER"), [edited]);
    assert.deepEqual(await knowledge.search("mailgun"), [decision]);
    assert.deepEqual(await knowledge.search("verified"), [edited, definition]);

    const accented = await knowledge.defineTerm({ term: "Déjà vu", meaning: "Élan, café and naïveté" });
    assert.deepEqual(await knowledge.search("DÉJÀ élan"), [accented]);
    assert.deepEqual(await knowledge.search("CAFÉ naÏvetÉ"), [accented]);
  });

  contract("6.2", "relatedNotes(noteId) returns every note, decision and definition that links to that note", async ({ knowledge, records }) => {
    const target = await knowledge.defineTerm({ term: "Signup", meaning: "Joining the site" });
    const other = await knowledge.defineTerm({ term: "Delivery", meaning: "Sign in comes next" });
    const quiet = await knowledge.defineTerm({ term: "Delivery", meaning: "Nothing links here" });

    const linking = await createInOrder<Note>(3, (n) => {
      if (n % 3 === 0) return knowledge.defineTerm({ term: `Term ${n}`, meaning: "Defined", links: [target.id] });
      if (n % 3 === 1) return knowledge.defineTerm({ term: "Delivery", meaning: `Memory ${n}`, links: [target.id] });
      return knowledge.recordDecision({ status: "accepted", title: `Decision ${n}`, text: "Chosen", links: [other.id, target.id] });
    });
    const unlinked = await knowledge.defineTerm({ term: "Delivery", meaning: "Links nothing" });
    await knowledge.recordDecision({ status: "accepted", title: "Nothing to link", text: "Yet", links: [] });
    const elsewhere = await knowledge.defineTerm({ term: "Sign in", meaning: "Coming back", links: [other.id] });

    assert.deepEqual(
      await knowledge.relatedNotes(target.id),
      linking,
      "every note linking to it, of all three kinds, as stored, in creation order",
    );
    assert.deepEqual(await knowledge.relatedNotes(other.id), [...linking.filter((note) => note.type === "decision"), elsewhere]);
    assert.deepEqual(await knowledge.relatedNotes(quiet.id), [], "a note no note links to");
    assert.deepEqual(await knowledge.relatedNotes(NO_MEMORY), [], "an id naming no record");
    assert.deepEqual(await knowledge.relatedNotes(target.id.slice(0, -1)), [], "part of a linked id");
    assert.deepEqual(await knowledge.relatedNotes(target.id.toUpperCase()), [], "a linked id in another case");

    const decision = at(linking, 2);
    const followUp = await knowledge.defineTerm({ term: "Delivery", meaning: "Revisit this decision", links: [decision.id] });
    const story = await records.create("story", { title: "Visitor can sign up" });
    assert.deepEqual(await knowledge.relatedNotes(decision.id), [followUp]);
    assert.deepEqual(await knowledge.relatedNotes(story.id), []);
    assert.deepEqual(await knowledge.relatedNotes(target.id), linking);

    await records.retire(at(linking, 0).id, "superseded");
    await knowledge.editNote(at(linking, 1).id, { links: [] });
    const joined = await knowledge.editNote(unlinked.id, { links: [quiet.id, target.id] });
    assert.deepEqual(await knowledge.relatedNotes(target.id), [...linking.slice(2), joined]);
    await clockPast(joined?.updatedAt ?? assert.fail("the note was not edited"));
    const revised = await knowledge.editNote(at(linking, 2).id, { text: "Chosen again" });
    assert.deepEqual(await knowledge.relatedNotes(target.id), [revised, ...linking.slice(3), joined]);
  });

  contract("6.3", "editing a decision keeps its old wording in history", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const domain = await knowledge.defineTerm({ term: "Sending domain", meaning: "The domain our mail comes from" });
    const decision = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest to call", links: [domain.id] });
    await assertCreated(transactions, decision, "decision", { title: "Use Mailgun", text: "Its API is the simplest to call", links: [domain.id] });

    const reworded = await knowledge.editNote(decision.id, { text: "Postmark delivers more of our mail" });
    assert.ok(reworded);
    assert.deepEqual(reworded, {
      ...decision,
      fields: { ...decision.fields, text: "Postmark delivers more of our mail" },
      updatedAt: reworded.updatedAt,
    });
    const retitled = await knowledge.editNote(decision.id, { title: "Use Postmark" });
    assert.deepEqual(retitled?.fields, { ...decision.fields, title: "Use Postmark", text: "Postmark delivers more of our mail" });
    assert.deepEqual(await records.get(decision.id), retitled, "get reads the latest wording");

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

    const memory = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [decision.id] });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message the server sent back" });
    const rewritten = await knowledge.editNote(memory.id, { meaning: "Postmark needs a verified sender", links: undefined });
    assert.deepEqual(rewritten?.fields, { term: "Delivery", meaning: "Postmark needs a verified sender" });
    await knowledge.editNote(definition.id, { meaning: "A message that could not be delivered" });
    assert.deepEqual(
      (await records.history({ id: memory.id })).map(({ record }) => record.fields),
      [{ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [decision.id] }, { term: "Delivery", meaning: "Postmark needs a verified sender" }],
    );
    assert.deepEqual(
      (await records.history({ id: definition.id })).map(({ record }) => record.fields),
      [
        { term: "Bounce", meaning: "A message the server sent back" },
        { term: "Bounce", meaning: "A message that could not be delivered" },
      ],
    );

    const capability = await records.create("capability", { title: "Email form", story: story.id, proposed: true });
    const dropped = await knowledge.defineTerm({ term: "Delivery", meaning: "Dropped" });
    await records.retire(dropped.id, "written by mistake");
    const before = await transactions.history();
    for (const id of [story.id, capability.id, dropped.id, NO_MEMORY, ...UNSTORABLE]) {
      assert.equal(await knowledge.editNote(id, { title: "Renamed" }), null, `editNote(${JSON.stringify(id)})`);
    }
    await assert.rejects(knowledge.editNote(memory.id, { title: "Memories have no title" }), schemaError("definition", ["title"]));
    await assert.rejects(knowledge.editNote(decision.id, { text: "" }), schemaError("decision", ["text"]));
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(story.id), story, "the story keeps its title");
  });

  contract("6.4", "a link to a record that does not exist is refused", async ({ knowledge, records, transactions }) => {
    const memory = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest" });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const retired = await knowledge.defineTerm({ term: "Delivery", meaning: "Postmark is cheaper" });
    await records.retire(retired.id, "out of date");
    const before = await transactions.history();

    const refused: [attempt: () => Promise<unknown>, id: string][] = [
      [() => knowledge.defineTerm({ term: "Delivery", meaning: "Linked to nothing", links: [NO_STORY] }), NO_STORY],
      [() => knowledge.defineTerm({ term: "Delivery", meaning: "Linked to nothing", links: [decision.id, NO_MEMORY] }), NO_MEMORY],
      [() => knowledge.recordDecision({ status: "accepted", title: "Use Postmark", text: "Better delivery", links: [retired.id] }), retired.id],
      [
        () => knowledge.recordDecision({ status: "accepted", title: "Use Postmark", text: "Better delivery", links: [memory.id, memory.id.toUpperCase()] }),
        memory.id.toUpperCase(),
      ],
      [() => knowledge.defineTerm({ term: "Hard bounce", meaning: "A permanent failure", links: [""] }), ""],
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
    for (const bad of UNSTORABLE) {
      await assert.rejects(knowledge.defineTerm({ term: "Delivery", meaning: "Odd link", links: [bad] }), schemaError("definition", ["links"]));
      await assert.rejects(knowledge.editNote(definition.id, { links: [memory.id, bad] }), schemaError("definition", ["links"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(memory.id), memory, "the edited notes are unchanged");
    assert.deepEqual(await transactions.get(decision.id), decision);
    assert.deepEqual(await transactions.get(definition.id), definition);

    const notes = [memory, decision, definition].map((record) => record.id);
    const linked = await knowledge.defineTerm({ term: "Delivery", meaning: "Links to every kind", links: notes });
    await assertCreated(transactions, linked, "definition", { term: "Delivery", meaning: "Links to every kind", links: notes });
    const decided = await knowledge.recordDecision({ status: "accepted", title: "Keep it all", text: "Linked", links: notes, justifications: { [decision.id]: "Linked in this test." } });
    await assertCreated(transactions, decided, "decision", { title: "Keep it all", text: "Linked", links: notes, justifications: { [decision.id]: "Linked in this test." } });
    const defined = await knowledge.defineTerm({ term: "Everything", meaning: "All of it", links: notes });
    await assertCreated(transactions, defined, "definition", { term: "Everything", meaning: "All of it", links: notes });
    const relinked = await knowledge.editNote(memory.id, { links: [decision.id, definition.id] });
    assert.deepEqual(relinked?.fields, { term: "Delivery", meaning: "Mailgun needs a verified domain", links: [decision.id, definition.id] });
  });

  contract("6.5", "definitions() returns every live definition, and nothing else, in creation order", async ({ knowledge, records }) => {
    const claim = await knowledge.defineTerm({ term: "Claim", meaning: "Holding a capability while you build it" });
    await laterThan(claim);
    await knowledge.recordDecision({ status: "accepted", title: "Claim first", text: "Claim before you build" });
    await knowledge.recordDecision({ status: "accepted", title: "Claims have no queue", text: "A second agent picks other work" });
    const quiet = await knowledge.defineTerm({ term: "Quiet time", meaning: "How long a session may say nothing before it reads as idle" });
    const retired = await knowledge.defineTerm({ term: "Wisp", meaning: "0.2's picture of a claim" });
    await records.retire(retired.id, "not in 0.3");
    const edited = await knowledge.editNote(claim.id, { meaning: "Holding a capability while you build it, so nobody else takes it" });
    assert.deepEqual(await knowledge.definitions(), [edited, quiet]);
  });
}

async function assertCreated(
  transactions: Transactions,
  record: RecordEnvelope,
  type: RecordType,
  fields: Record<string, unknown>,
): Promise<void> {
  assert.match(record.id, new RegExp(`^${type}_[0-9a-f]{12}$`), `a generated ${type} id: ${record.id}`);
  const number = record.fields["number"];
  if (type === "decision") assert.ok(Number.isSafeInteger(number) && (number as number) > 0, `a decision is numbered: ${String(number)}`);
  const expected = type === "decision" ? { status: "accepted", ...fields, number } : fields;
  assert.deepEqual(
    record,
    { id: record.id, type, version: SCHEMA_VERSIONS[type], fields: expected, createdAt: record.createdAt, updatedAt: record.createdAt },
    `a new ${type}, holding exactly the fields given`,
  );
  assert.deepEqual(await transactions.get(record.id), record, `the ${type} is stored as returned`);
}

async function laterThan(record: { readonly createdAt: string }): Promise<void> {
  await clockPast(record.createdAt);
}

async function clockPast(timestamp: string): Promise<void> {
  await waitUntil(() => Date.now() > Date.parse(timestamp), 5_000, `the clock to pass ${timestamp}`);
}

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

function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

function alternateCase(word: string): string {
  return [...word].map((letter, n) => (n % 2 === 0 ? letter.toLowerCase() : letter.toUpperCase())).join("");
}

function missingLink(id: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "links", id, expected: "artifact", found: undefined },
      error.message,
    );
    for (const part of [JSON.stringify("links"), JSON.stringify(id)]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    return true;
  };
}

function schemaError(type: RecordType, fields: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
    assert.equal(error.type, type, error.message);
    assert.deepEqual([...error.fields].sort(), [...fields].sort(), `the fields at fault: ${error.message}`);
    return true;
  };
}
