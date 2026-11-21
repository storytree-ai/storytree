// Capability 9 · Knowledge entrances
import assert from "node:assert/strict";
import { test } from "node:test";

import { waitUntil } from "@storytree/test-waits";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type RecordType } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { Knowledge, type NewDefinition } from "./index.js";

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
const NO_CAPABILITY = "capability_000000000000";

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

  contract("9.1", "a decision can be the front cover of a story or a capability, and frontCovers lists a node's covers, founding first", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const form = await records.create("capability", { title: "Email form", story: story.id, proposed: true });
    const login = await records.create("capability", { title: "Login", story: story.id, proposed: true });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: form.id });

    const titles = ["Check the address on the server", "Send mail through a queue", "Show the error beside the field"];
    const shelf = await createInOrder(titles.length, (n) =>
      knowledge.recordDecision({ status: "accepted", title: titles[n % titles.length] ?? "Another cover", text: "Chosen for the email form", frontCoverOf: form.id }),
    );
    const founding = at(shelf, 0);
    await assertCreated(transactions, founding, "decision", { title: titles[0], text: "Chosen for the email form", frontCoverOf: form.id });

    const storyCover = await knowledge.recordDecision({ status: "accepted", title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    const loginCover = await knowledge.recordDecision({ status: "accepted", title: "Magic links, no passwords", text: "Nothing to forget", frontCoverOf: login.id });
    const shared = await knowledge.recordDecision({ status: "accepted", title: "Keep queues in Postgres", text: "One database to run", links: [at(shelf, 1).id, loginCover.id], justifications: { [at(shelf, 1).id]: "Linked in this test.", [loginCover.id]: "Linked in this test too." } });
    const inside = await knowledge.defineTerm({ term: "Delivery", meaning: "The check rejects plus-addresses", links: [founding.id] });

    assert.deepEqual(await knowledge.frontCovers(form.id), shelf, "the email form's covers, founding first, as stored");
    assert.deepEqual(await knowledge.frontCovers(story.id), [storyCover], "a story's own shelf holds only its own covers");
    assert.deepEqual(await knowledge.frontCovers(login.id), [loginCover]);
    for (const id of [contract.id, shared.id, founding.id, inside.id, NO_CAPABILITY]) {
      assert.deepEqual(await knowledge.frontCovers(id), [], `frontCovers(${JSON.stringify(id)})`);
    }
    assert.deepEqual(await knowledge.frontCovers(form.id.slice(0, -1)), []);
    assert.deepEqual(await knowledge.frontCovers(form.id.toUpperCase()), []);
    assert.deepEqual(await knowledge.relatedNotes(founding.id), [inside]);
    assert.deepEqual(await knowledge.relatedNotes(loginCover.id), [shared]);

    await records.retire(at(shelf, 2).id, "folded into the first cover");
    const kept = shelf.filter((_, n) => n !== 2);
    assert.deepEqual(await knowledge.frontCovers(form.id), kept);
    const moved = await knowledge.editNote(loginCover.id, { frontCoverOf: form.id });
    assert.deepEqual(await knowledge.frontCovers(form.id), [...kept, moved]);
    assert.deepEqual(await knowledge.frontCovers(login.id), []);

    await clockPast(moved?.updatedAt ?? assert.fail("the cover was not moved"));
    const replacement = await knowledge.recordDecision({
      status: "accepted",
      title: "Check the address on the server and in the browser",
      text: "Faster feedback",
      frontCoverOf: form.id,
      links: [founding.id],
      justifications: { [founding.id]: "Linked in this test." },
    });
    const unshelved = await knowledge.editNote(founding.id, { frontCoverOf: undefined });
    assert.deepEqual(unshelved?.fields, { status: "accepted", number: founding.fields.number, title: titles[0], text: "Chosen for the email form" }, "the mark is gone, and nothing else changed");
    assert.deepEqual(await knowledge.frontCovers(form.id), [...kept.slice(1), moved, replacement]);
    assert.deepEqual(await knowledge.relatedNotes(founding.id), [inside, replacement]);
  });

  contract("9.2", "a front cover naming anything but a live story or capability is refused, and nothing is written", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const capability = await records.create("capability", { title: "Email form", story: story.id, proposed: true });
    const arc = await records.create("arc", { title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: capability.id });
    const health = await records.create("health", { node: contract.id, column: "reported", state: "passing" });
    const note = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest" });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const retired = await records.create("story", { title: "Visitor can pay" });
    await records.retire(retired.id, "out of scope");
    const before = await transactions.history();

    const refused: [id: string, found: RecordType | undefined][] = [
      [contract.id, "contract"],
      [arc.id, "arc"],
      [health.id, "health"],
      [note.id, "definition"],
      [decision.id, "decision"],
      [definition.id, "definition"],
      [NO_STORY, undefined],
      [retired.id, undefined],
      [story.id.toUpperCase(), undefined],
      ["", undefined],
    ];
    for (const [id, found] of refused) {
      await assert.rejects(knowledge.recordDecision({ status: "accepted", title: "Use Postmark", text: "Better delivery", frontCoverOf: id }), missingCover(id, found));
      await assert.rejects(knowledge.editNote(decision.id, { text: "Reconsidered", frontCoverOf: id }), missingCover(id, found));
    }
    const both = [story.id, capability.id] as unknown as string;
    await assert.rejects(knowledge.recordDecision({ status: "accepted", title: "Use Postmark", text: "Better delivery", frontCoverOf: both }), schemaError("decision", ["frontCoverOf"]));
    await assert.rejects(knowledge.editNote(decision.id, { frontCoverOf: both }), schemaError("decision", ["frontCoverOf"]));
    await assert.rejects(
      knowledge.defineTerm({ term: "Delivery", meaning: "Wants to be a cover", frontCoverOf: story.id } as unknown as NewDefinition),
      schemaError("definition", ["frontCoverOf"]),
    );
    await assert.rejects(
      knowledge.defineTerm({ term: "Cover", meaning: "Wants to be one", frontCoverOf: capability.id } as unknown as NewDefinition),
      schemaError("definition", ["frontCoverOf"]),
    );
    await assert.rejects(knowledge.editNote(note.id, { frontCoverOf: story.id }), schemaError("definition", ["frontCoverOf"]));
    for (const bad of UNSTORABLE) {
      await assert.rejects(knowledge.recordDecision({ status: "accepted", title: "Odd", text: "Cover", frontCoverOf: bad }), schemaError("decision", ["frontCoverOf"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(decision.id), decision, "the edited decision is unchanged");

    const storyCover = await knowledge.recordDecision({ status: "accepted", title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    await assertCreated(transactions, storyCover, "decision", { title: "Signup is one page", text: "Nothing to click through", frontCoverOf: story.id });
    const covered = await knowledge.editNote(decision.id, { frontCoverOf: capability.id });
    assert.deepEqual(covered?.fields, { ...decision.fields, frontCoverOf: capability.id });
  });

  contract("9.3", "a note linking to a story, capability, contract, arc or health entry is refused, and nothing is written", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const capability = await records.create("capability", { title: "Email form", story: story.id, proposed: true });
    const arc = await records.create("arc", { title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const contract = await records.create("contract", { title: "Rejects a bad email", capability: capability.id });
    const health = await records.create("health", { node: contract.id, column: "reported", state: "passing" });
    const note = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const decision = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: capability.id });
    const definition = await knowledge.defineTerm({ term: "Bounce", meaning: "A message sent back" });
    const before = await transactions.history();

    for (const work of [story, capability, arc, contract, health]) {
      const attempts: (() => Promise<unknown>)[] = [
        () => knowledge.defineTerm({ term: "Delivery", meaning: "About the work", links: [work.id] }),
        () => knowledge.recordDecision({ status: "accepted", title: "About the work", text: "Linked", links: [note.id, work.id] }),
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

    const notes = [note.id, decision.id, definition.id];
    const linked = await knowledge.defineTerm({ term: "Delivery", meaning: "Links to every kind", links: notes });
    await assertCreated(transactions, linked, "definition", { term: "Delivery", meaning: "Links to every kind", links: notes });
    const decided = await knowledge.recordDecision({ status: "accepted", title: "Keep it linked", text: "Behind the cover", frontCoverOf: story.id, links: notes, justifications: { [decision.id]: "Linked in this test." } });
    await assertCreated(transactions, decided, "decision", { title: "Keep it linked", text: "Behind the cover", frontCoverOf: story.id, links: notes, justifications: { [decision.id]: "Linked in this test." } });
    const defined = await knowledge.defineTerm({ term: "Everything", meaning: "All of it", links: notes });
    await assertCreated(transactions, defined, "definition", { term: "Everything", meaning: "All of it", links: notes });
    const relinked = await knowledge.editNote(note.id, { links: [decision.id, definition.id] });
    assert.deepEqual(relinked?.fields, { term: "Delivery", meaning: "Mailgun needs a verified domain", links: [decision.id, definition.id] });
  });

  contract("9.4", "a link that would close a loop between notes, a note linking to itself included, is refused, naming the chain it closes, and nothing is written", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const cover = await knowledge.recordDecision({ status: "accepted", title: "Use Mailgun", text: "Its API is the simplest", frontCoverOf: story.id });
    const below = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [cover.id] });
    const deepest = await knowledge.defineTerm({ term: "Verified domain", meaning: "One Mailgun may send from", links: [below.id] });
    const role = await knowledge.writeKnowledge("agent", { title: "Mailer", description: "Sends mail", oneLine: "Sends mail", role: "Mailer", outcome: "Mail sent", context: [deepest.id], tools: "Mailgun", workflow: "Send" });
    const before = await transactions.history();

    const loops: [() => Promise<unknown>, string[]][] = [
      [() => knowledge.editNote(cover.id, { links: [cover.id], justifications: { [cover.id]: "A loop, refused." } }), [cover.id, cover.id]],
      [() => knowledge.editNote(cover.id, { text: "Reconsidered", links: [below.id] }), [cover.id, below.id, cover.id]],
      [() => knowledge.editNote(cover.id, { links: [deepest.id] }), [cover.id, deepest.id, below.id, cover.id]],
      [() => knowledge.editNote(below.id, { links: [cover.id, role.id] }), [below.id, role.id, deepest.id, below.id]],
      [() => knowledge.editNote(role.id, { rules: [role.id] }), [role.id, role.id]],
      [() => knowledge.editNote(role.id, { stepRefs: [{ step: "Send", refs: [role.id] }] }), [role.id, role.id]],
    ];
    for (const [attempt, chain] of loops) await assert.rejects(attempt(), linkLoop(chain));
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");

    const also = await knowledge.defineTerm({ term: "Delivery", meaning: "Mailgun bills per message", links: [cover.id, below.id, deepest.id] });
    const relinked = await knowledge.editNote(role.id, { context: [deepest.id, below.id, also.id], rules: [cover.id] });
    assert.deepEqual(relinked?.type === "agent" && [relinked.fields.context, relinked.fields.rules], [[deepest.id, below.id, also.id], [cover.id]]);
  });
}

function linkLoop(chain: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof Error && error.name === "LinkLoopError", `expected a LinkLoopError, got: ${String(error)}`);
    assert.deepEqual((error as Error & { path?: unknown }).path, chain, error.message);
    assert.ok(error.message.includes(chain.join(" → ")), `the message names the chain: ${error.message}`);
    return true;
  };
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
    await clockPast(record.createdAt);
  }
  return created;
}

function inIdOrder(records: readonly { readonly id: string }[]): boolean {
  return records.every((record, n) => n === 0 || at(records, n - 1).id < record.id);
}

function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

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

function linkToWork(id: string, found: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "links", id, expected: "artifact", found },
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

