import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../projects/open/index.js";
import { MissingReferenceError, SCHEMA_VERSIONS, SchemaError, SchemaRecords, type RecordType } from "../../storage/rules/index.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../../storage/store/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";
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
      return { knowledge: new Knowledge(project.records), records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const NO_STORY = "story_000000000000";

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

  contract("13.26", "a front cover naming anything but a live story or capability is refused, and nothing is written", async ({ knowledge, records, transactions }) => {
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

function schemaError(type: RecordType, fields: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
    assert.equal(error.type, type, error.message);
    assert.deepEqual([...error.fields].sort(), [...fields].sort(), `the fields at fault: ${error.message}`);
    return true;
  };
}
