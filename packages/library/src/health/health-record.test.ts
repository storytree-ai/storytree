import assert from "node:assert/strict";
import { test } from "node:test";

import { waitUntil } from "@storytree/test-waits";

import { connect } from "../projects/open/index.js";
import { MissingReferenceError, NewerSchemaError, SchemaError, SchemaRecords, type RecordType, type SchemaRecord } from "../storage/rules/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../storage/store/index.js";
import { WorkModel, type ProjectTree } from "../plan/index.js";
import { WorkInFlight } from "../work/arcs/index.js";
import { capabilityStatus, capabilityWhy, HealthRecord, wordAndWhy, type AnnotatedTree, type HealthColumn, type HealthEntry, type NodeHealth } from "./index.js";

interface Library {
  readonly health: HealthRecord;
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
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
    const work = new WorkModel(records);
    const flight = new WorkInFlight(records);
    return { health: new HealthRecord(records, work, flight), work, flight, records, transactions, cleanup: async () => {} };
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
      const { health, work, flight, records, transactions } = project;
      return { health, work, flight, records, transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const UNCHECKED: NodeHealth = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };

const NO_CONTRACT = "contract_000000000000";

const UNSTORABLE = ["contract_\u0000", "contract_\uD83C"];

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

  contract("5.1", "a node with no health entries reads reported: not-checked, verified: not-checked", async ({ health, work, flight, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    const bare = await work.addStory({ title: "Visitor can leave" });
    const empty = await work.addCapability({ title: "Password rules", story: story.id });
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const before = await transactions.history();

    for (const node of [story, capability, contract, bare, empty]) {
      assert.deepEqual(await health.health(node.id), UNCHECKED, `the ${node.type} "${node.fields.title}"`);
    }
    assert.deepEqual(await health.healthHistory(contract.id), [], "a contract with no entries has no history");

    const tree = await work.projectTree();
    const asGiven = structuredClone(tree);
    assert.deepEqual(await health.annotate(tree), { ...withHealth(tree, () => UNCHECKED), unverified: true });
    assert.deepEqual(tree, asGiven, "annotate leaves the tree it is given unchanged");
    assert.equal(countNodes(tree), 5, "control: the tree holds all five nodes");
    assert.deepEqual(tree.arcs, [{ id: arc.id, title: "Launch v1", stories: [story.id] }], "control: and the arc");
    assert.deepEqual(await health.annotate(), { ...withHealth(tree, () => UNCHECKED), unverified: true });

    assert.deepEqual(await transactions.history(), before, "reading health writes nothing");

    const note = await records.create("definition", { term: "Delivery", meaning: "Mailgun needs a verified domain", links: [story.id] });
    const dropped = await work.addContract({ title: "Accepts a plus address", capability: capability.id });
    await records.retire(dropped.id, "out of scope");
    const history = await transactions.history();
    for (const id of [NO_CONTRACT, contract.id.toUpperCase(), "", arc.id, note.id, dropped.id, ...UNSTORABLE]) {
      assert.deepEqual(await health.health(id), UNCHECKED, `health(${JSON.stringify(id)})`);
      assert.deepEqual(await health.healthHistory(id), [], `healthHistory(${JSON.stringify(id)})`);
    }
    assert.deepEqual(await transactions.history(), history, "reading health writes nothing");
  });

  contract("5.2", "after an agent reports a contract passing, it reads reported: passing, verified: not-checked", async ({ health, work, transactions }) => {
    const { contract, sibling } = await smallPlan(work);

    const start = Date.now();
    const reported = await health.reportHealth(contract.id, "passing", { by: "agent", note: "3 of 3 cases pass" });
    assertTimestamp(reported.at, start, Date.now());
    assert.deepEqual(
      reported,
      { column: "reported", state: "passing", by: "agent", at: reported.at, note: "3 of 3 cases pass" },
      "the entry as written",
    );
    assert.deepEqual(await health.health(contract.id), {
      reported: { state: "passing", by: "agent", at: reported.at, note: "3 of 3 cases pass" },
      verified: { state: "not-checked" },
    });
    assert.deepEqual(await health.health(sibling.id), UNCHECKED, "the contract beside it has no entry, and still reads not-checked");

    const stored = await healthRecordsOf(transactions, contract.id);
    assert.equal(stored.length, 1, "one health record");
    const record = at(stored, 0);
    assert.deepEqual(record.fields, { node: contract.id, column: "reported", state: "passing", by: "agent", note: "3 of 3 cases pass" });
    assert.equal(record.version, 1);

    const failing = await health.reportHealth(contract.id, "failing");
    assert.deepEqual(failing, { column: "reported", state: "failing", at: failing.at });
    assert.deepEqual(await health.health(contract.id), { reported: { state: "failing", at: failing.at }, verified: { state: "not-checked" } });
    const passing = await health.reportHealth(contract.id, "passing", { by: "agent-b" });
    const latest = { reported: { state: "passing", by: "agent-b", at: passing.at }, verified: { state: "not-checked" } };
    assert.deepEqual(await health.health(contract.id), latest);
    assert.deepEqual((await healthRecordsOf(transactions, contract.id)).map((kept) => kept.id), [record.id], "still one record");
    assert.deepEqual(
      (await transactions.history({ id: record.id })).map((entry) => ({ action: entry.action, fields: entry.record.fields })),
      [
        { action: "created", fields: { node: contract.id, column: "reported", state: "passing", by: "agent", note: "3 of 3 cases pass" } },
        { action: "updated", fields: { node: contract.id, column: "reported", state: "failing" } },
        { action: "updated", fields: { node: contract.id, column: "reported", state: "passing", by: "agent-b" } },
      ],
      "each report is a save of the one record, and its history holds them all",
    );

    const before = await transactions.history();
    for (const state of ["passed", "Passing", "PASSING", "pass", "green", "not checked", "notChecked", "", null, 1, undefined]) {
      await assert.rejects(health.reportHealth(contract.id, untyped(state)), schemaError("health", ["state"]), `state ${String(state)}`);
      await assert.rejects(health.recordVerified(contract.id, untyped(state)), schemaError("health", ["state"]), `state ${String(state)}`);
    }
    await assert.rejects(health.reportHealth(contract.id, "passing", untyped({ by: 7 })), schemaError("health", ["by"]));
    await assert.rejects(health.reportHealth(contract.id, "passing", untyped({ note: ["looks fine"] })), schemaError("health", ["note"]));
    await assert.rejects(health.recordVerified(contract.id, "failing", { by: "story\u0000tree" }), schemaError("health", ["by"]));
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await health.health(contract.id), latest, "the contract still reads its last entry");
  });

  contract("5.3", "after storytree records the same contract verified failing, both columns are kept side by side (reported: passing, verified: failing)", async ({ health, work, transactions }) => {
    const { contract, sibling } = await smallPlan(work);

    const reported = await health.reportHealth(contract.id, "passing", { by: "agent" });
    const verified = await health.recordVerified(contract.id, "failing", { by: "storytree", note: "1 of 3 cases fail" });
    assert.deepEqual(verified, { column: "verified", state: "failing", by: "storytree", at: verified.at, note: "1 of 3 cases fail" });
    const sideBySide = {
      reported: { state: "passing", by: "agent", at: reported.at },
      verified: { state: "failing", by: "storytree", at: verified.at, note: "1 of 3 cases fail" },
    };
    assert.deepEqual(await health.health(contract.id), sideBySide, "reported: passing, verified: failing");
    assert.deepEqual(healthInTree(await health.annotate(await work.projectTree())).get(contract.id), sideBySide, "and so in the annotated tree");

    assert.deepEqual(
      (await healthRecordsOf(transactions, contract.id)).map((record) => record.fields).sort(byColumn),
      [
        { node: contract.id, column: "reported", state: "passing", by: "agent" },
        { node: contract.id, column: "verified", state: "failing", by: "storytree", note: "1 of 3 cases fail" },
      ],
    );

    const rereported = await health.reportHealth(contract.id, "failing", { by: "agent", note: "found the bug" });
    const newReport = { state: "failing", by: "agent", at: rereported.at, note: "found the bug" };
    assert.deepEqual(await health.health(contract.id), { reported: newReport, verified: sideBySide.verified });
    const reverified = await health.recordVerified(contract.id, "passing", { by: "storytree" });
    assert.deepEqual(await health.health(contract.id), {
      reported: newReport,
      verified: { state: "passing", by: "storytree", at: reverified.at },
    });
    assert.equal((await healthRecordsOf(transactions, contract.id)).length, 2, "still one record per column");

    const seen = await health.recordVerified(sibling.id, "passing", { by: "storytree" });
    assert.deepEqual(await health.health(sibling.id), {
      reported: { state: "not-checked" },
      verified: { state: "passing", by: "storytree", at: seen.at },
    });
  });

  contract("5.4", "a capability or story's health is rolled up from its contracts, column by column: failing if any is failing, passing only if there is one and all are passing, otherwise not-checked", async ({ health, work, records }) => {
    const S = await work.addStory({ title: "Visitor can sign up" });
    const A = await work.addCapability({ title: "Email form", story: S.id });
    const A1 = await work.addContract({ title: "Rejects a bad email", capability: A.id });
    const A2 = await work.addContract({ title: "Accepts a plus address", capability: A.id });
    const B = await work.addCapability({ title: "Confirmation link", story: S.id });
    const B1 = await work.addContract({ title: "The link expires", capability: B.id });
    const E = await work.addCapability({ title: "Welcome email", story: S.id });
    const T = await work.addStory({ title: "Visitor can leave" });
    const U = await work.addStory({ title: "Visitor can sign in" });
    const F = await work.addCapability({ title: "Password form", story: U.id });
    const nodes = { S, A, A1, A2, B, B1, E, T, U, F };

    const expectHealth = async (step: string, expected: Readonly<Record<keyof typeof nodes, string>>): Promise<void> => {
      const inTree = healthInTree(await health.annotate(await work.projectTree()));
      for (const [name, node] of Object.entries(nodes)) {
        const letters = expected[name as keyof typeof nodes];
        const want = { reported: STATE_OF[letters.charAt(0)], verified: STATE_OF[letters.charAt(1)] };
        const got = await health.health(node.id);
        if (node.type === "contract") {
          assert.deepEqual({ reported: got.reported.state, verified: got.verified.state }, want, `${step}: contract ${name}`);
        } else {
          assert.deepEqual(got, { reported: { state: want.reported }, verified: { state: want.verified } }, `${step}: ${node.type} ${name}`);
        }
        assert.deepEqual(inTree.get(node.id), got, `${step}: ${name} reads the same in the annotated tree`);
      }
    };

    await expectHealth("nothing written", { S: "--", A: "--", A1: "--", A2: "--", B: "--", B1: "--", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(A1.id, "passing");
    await expectHealth("A1 reported passing; A2 never checked", { S: "--", A: "--", A1: "P-", A2: "--", B: "--", B1: "--", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(A2.id, "passing");
    await expectHealth("A1 and A2 reported passing; B1 never checked keeps S not-checked", { S: "--", A: "P-", A1: "P-", A2: "P-", B: "--", B1: "--", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(B1.id, "passing");
    await expectHealth("every contract of S reported passing; E, with none, holds nothing back but is itself not-checked", { S: "P-", A: "P-", A1: "P-", A2: "P-", B: "P-", B1: "P-", E: "--", T: "--", U: "--", F: "--" });

    await health.recordVerified(A1.id, "failing");
    await expectHealth("A1 verified failing: column by column", { S: "PF", A: "PF", A1: "PF", A2: "P-", B: "P-", B1: "P-", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(A2.id, "failing");
    await expectHealth("A2 reported failing: one failing contract is enough", { S: "FF", A: "FF", A1: "PF", A2: "F-", B: "P-", B1: "P-", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(A2.id, "not-checked");
    await expectHealth("A2 reported not-checked: not passing, and failing still beats not-checked", { S: "-F", A: "-F", A1: "PF", A2: "--", B: "P-", B1: "P-", E: "--", T: "--", U: "--", F: "--" });

    await health.recordVerified(A1.id, "passing");
    await health.recordVerified(A2.id, "passing");
    await health.recordVerified(B1.id, "passing");
    await expectHealth("every contract verified passing, A2 still reported not-checked", { S: "-P", A: "-P", A1: "PP", A2: "-P", B: "PP", B1: "PP", E: "--", T: "--", U: "--", F: "--" });

    await health.reportHealth(A2.id, "passing");
    await expectHealth("every contract passing in both columns", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "PP", B1: "PP", E: "--", T: "--", U: "--", F: "--" });

    const B2 = await work.addContract({ title: "The link works once", capability: B.id });
    await expectHealth("B2 added, never checked", { S: "--", A: "PP", A1: "PP", A2: "PP", B: "--", B1: "PP", E: "--", T: "--", U: "--", F: "--" });
    await records.retire(B2.id, "covered by B1");
    await expectHealth("B2 retired", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "PP", B1: "PP", E: "--", T: "--", U: "--", F: "--" });
    await work.editCapability(B.id, { story: U.id });
    await expectHealth("B moved to U", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "PP", B1: "PP", E: "--", T: "--", U: "PP", F: "--" });
    await health.reportHealth(B1.id, "failing");
    await expectHealth("B1 reported failing, now under U", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "FP", B1: "FP", E: "--", T: "--", U: "FP", F: "--" });

    await records.retire(U.id, "merged into sign up");
    const inTree = healthInTree(await health.annotate(await work.projectTree()));
    for (const node of [U, B, B1, F]) assert.equal(inTree.has(node.id), false, `${node.fields.title} has left the tree`);
    assert.deepEqual(await health.health(U.id), UNCHECKED);
    assert.deepEqual(await health.health(B.id), { reported: { state: "failing" }, verified: { state: "passing" } });
    assert.deepEqual(await health.health(F.id), UNCHECKED);
    assert.deepEqual(await health.health(S.id), { reported: { state: "passing" }, verified: { state: "passing" } });
  });

  contract("5.5", "every health entry is kept in history with who wrote it and when, and an entry for a node that does not exist is refused", async ({ health, work, flight, records, transactions }) => {
    const { story, capability, contract, sibling } = await smallPlan(work);

    const start = Date.now();
    const written: HealthEntry[] = [];
    written.push(await health.reportHealth(contract.id, "passing", { by: "agent-a", note: "all cases pass locally" }));
    written.push(await health.recordVerified(contract.id, "failing", { by: "storytree", note: "1 of 3 cases fail" }));
    written.push(await health.reportHealth(contract.id, "failing", { by: "agent-b" }));
    const elsewhere = await health.reportHealth(sibling.id, "passing", { by: "agent-a" });
    written.push(await health.recordVerified(contract.id, "passing", { note: "fixed upstream" }));
    written.push(await health.reportHealth(contract.id, "not-checked"));
    written.push(await health.recordVerified(contract.id, "not-checked", { by: "storytree", note: "the suite was not run" }));
    const end = Date.now();

    const history = await health.healthHistory(contract.id);
    assert.deepEqual(history, written, "exactly the entries written, as the writes returned them");
    assert.deepEqual(
      history.map(({ at: _at, ...entry }) => entry),
      [
        { column: "reported", state: "passing", by: "agent-a", note: "all cases pass locally" },
        { column: "verified", state: "failing", by: "storytree", note: "1 of 3 cases fail" },
        { column: "reported", state: "failing", by: "agent-b" },
        { column: "verified", state: "passing", note: "fixed upstream" },
        { column: "reported", state: "not-checked" },
        { column: "verified", state: "not-checked", by: "storytree", note: "the suite was not run" },
      ],
    );
    let previous = start;
    for (const entry of history) {
      assertTimestamp(entry.at, previous, end);
      previous = Date.parse(entry.at);
    }
    assert.deepEqual(await health.healthHistory(sibling.id), [elsewhere], "each contract's history is its own");
    assert.deepEqual(await health.health(contract.id), { reported: columnOf(at(written, 4)), verified: columnOf(at(written, 5)) });

    const kept = (await transactions.history()).filter((entry) => entry.type === "health" && entry.record.fields.node === contract.id);
    assert.deepEqual(
      kept.map((entry) => ({ at: entry.at, actor: entry.actor, fields: entry.record.fields })),
      history.map((entry) => ({ at: entry.at, actor: entry.by, fields: healthFields(contract.id, entry) })),
    );
    const saves = new Map<string, string[]>();
    for (const entry of kept) saves.set(entry.recordId, [...(saves.get(entry.recordId) ?? []), entry.action]);
    assert.deepEqual([...saves.values()], [
      ["created", "updated", "updated"],
      ["created", "updated", "updated"],
    ]);

    await warmUp(transactions);
    const racers = await Promise.all(
      Array.from({ length: 8 }, (_, n) => health.reportHealth(contract.id, "passing", { by: `racer-${n}` })),
    );
    const everything = await health.healthHistory(contract.id);
    assert.deepEqual(everything.slice(0, history.length), history, "the earlier entries are untouched");
    const raced = everything.slice(history.length);
    assert.deepEqual([...raced].sort(byWriter), [...racers].sort(byWriter), "every racing entry, once");
    assert.deepEqual((await health.health(contract.id)).reported, columnOf(at(raced, raced.length - 1)));

    const reportedRecord = at((await healthRecordsOf(transactions, contract.id)).filter((record) => record.fields.column === "reported"), 0);
    await records.retire(reportedRecord.id, "cleared by hand");
    assert.deepEqual(await health.health(contract.id), { reported: { state: "not-checked" }, verified: columnOf(at(written, 5)) });
    assert.deepEqual(await health.healthHistory(contract.id), everything);
    const fresh = await health.reportHealth(contract.id, "failing", { by: "agent-c" });
    assert.deepEqual(await health.healthHistory(contract.id), [...everything, fresh]);
    assert.deepEqual((await health.health(contract.id)).reported, columnOf(fresh));

    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const note = await records.create("definition", { term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const healthRecord = at(await healthRecordsOf(transactions, contract.id), 0);
    const retired = await work.addContract({ title: "Accepts a plus address", capability: capability.id });
    await records.retire(retired.id, "out of scope");
    const before = await transactions.history();
    const refused: [id: string, found?: RecordType][] = [
      [NO_CONTRACT],
      [retired.id],
      [contract.id.toUpperCase()],
      [""],
      ...UNSTORABLE.map((id): [string] => [id]),
      [story.id, "story"],
      [capability.id, "capability"],
      [arc.id, "arc"],
      [note.id, "definition"],
      [healthRecord.id, "health"],
    ];
    for (const [id, found] of refused) {
      await assert.rejects(health.reportHealth(id, "passing", { by: "agent" }), missingNode(id, found), `reportHealth(${JSON.stringify(id)})`);
      await assert.rejects(health.recordVerified(id, "failing", { by: "storytree" }), missingNode(id, found), `recordVerified(${JSON.stringify(id)})`);
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");

    await records.retire(contract.id, "replaced by a stricter contract");
    assert.deepEqual(await health.healthHistory(contract.id), [...everything, fresh]);
    assert.deepEqual(await health.health(contract.id), UNCHECKED);
    const afterRetiring = await transactions.history();
    await assert.rejects(health.reportHealth(contract.id, "passing"), missingNode(contract.id));
    await assert.rejects(health.recordVerified(contract.id, "passing"), missingNode(contract.id));
    assert.deepEqual(await transactions.history(), afterRetiring, "nothing was written");

    const siblingRecord = at(await healthRecordsOf(transactions, sibling.id), 0);
    await transactions.save({ id: siblingRecord.id, type: "health", version: 2, fields: { ...siblingRecord.fields, state: "failing" } });
    await assert.rejects(health.health(sibling.id), NewerSchemaError);
    await assert.rejects(health.healthHistory(sibling.id), NewerSchemaError);
  });

  contract("5.6", "a capability's word is proposed while its flag is on, and once the agent switches it off comes from the verified column alone: healthy, unhealthy or untested", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    const wordOf = async (): Promise<string | undefined> =>
      (await health.annotate()).stories.flatMap((story) => story.capabilities).find(({ id }) => id === capability.id)?.status;

    await health.recordVerified(contract.id, "passing");
    await health.recordVerified(sibling.id, "passing");
    assert.equal(await wordOf(), "proposed", "while proposed, even every contract verified passing reads proposed");

    await work.setProposed(capability.id, false);
    assert.equal(await wordOf(), "healthy", "every contract verified passing");

    await health.recordVerified(sibling.id, "failing");
    assert.equal(await wordOf(), "unhealthy", "any contract verified failing");
    await health.recordVerified(sibling.id, "not-checked");
    assert.equal(await wordOf(), "untested", "a contract with no verified result");

    const fresh = await work.addCapability({ title: "Password rules", story: capability.fields.story });
    const reported = await work.addContract({ title: "Refuses a short password", capability: fresh.id });
    await work.setProposed(fresh.id, false);
    await health.reportHealth(reported.id, "passing");
    const freshWord = (await health.annotate()).stories.flatMap((story) => story.capabilities).find(({ id }) => id === fresh.id)?.status;
    assert.equal(freshWord, "untested", "reported passing, nothing verified");

    await work.setProposed(capability.id, true);
    assert.equal(await wordOf(), "proposed", "switched back on, it reads proposed again");
  });

  contract("5.7", "a verified entry carries the kind of skip that left it not checked and the earlier verdict it did not reproduce, read back as written", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    await work.setProposed(capability.id, false);
    const failed = await health.recordVerified(contract.id, "failing", { by: "storytree test run" });
    const skipped = await health.recordVerified(contract.id, "not-checked", {
      by: "storytree test run",
      note: "not re-run at abc123: 0 of 1 tests ran",
      skip: "owner",
      was: { state: "failing", at: failed.at },
    });
    assert.equal(skipped.skip, "owner");
    assert.deepEqual(skipped.was, { state: "failing", at: failed.at });
    const read = (await health.health(contract.id)).verified;
    assert.equal(read.state, "not-checked");
    assert.equal(read.skip, "owner");
    assert.deepEqual(read.was, { state: "failing", at: failed.at });
    const inTree = (await health.annotate()).stories[0]!.capabilities[0]!.contracts.find(({ id }) => id === contract.id)!;
    assert.deepEqual(inTree.health.verified, read);

    await health.recordVerified(sibling.id, "passing", { by: "storytree test run" });
    const plain = (await health.health(sibling.id)).verified;
    assert.equal("skip" in plain, false, "an entry without a skip has none");
    assert.equal("was" in plain, false, "an entry without an earlier verdict has none");
    await assert.rejects(health.recordVerified(sibling.id, "not-checked", { skip: untyped("because") }), schemaError("health", ["skip"]));
  });

  contract("5.17", "a verified entry carries where it was seen, verified locally or read from CI, read back as written; one written without it has none", async ({ health, work }) => {
    const { contract, sibling } = await smallPlan(work);
    const local = await health.recordVerified(contract.id, "passing", { by: "factory plugin's tests", source: "local" });
    assert.equal(local.source, "local");
    assert.equal((await health.health(contract.id)).verified.source, "local");
    await health.recordVerified(contract.id, "failing", { by: "the project's CI", source: "ci" });
    const read = (await health.health(contract.id)).verified;
    assert.equal(read.source, "ci");
    assert.deepEqual((await health.healthHistory(contract.id)).map(({ source }) => source), ["local", "ci"]);
    const inTree = (await health.annotate()).stories[0]!.capabilities[0]!.contracts.find(({ id }) => id === contract.id)!;
    assert.deepEqual(inTree.health.verified, read);

    await health.recordVerified(sibling.id, "passing", { by: "storytree test run" });
    assert.equal("source" in (await health.health(sibling.id)).verified, false, "an entry written without a source has none");
    await assert.rejects(health.recordVerified(sibling.id, "passing", { source: untyped("laptop") }), schemaError("health", ["source"]));
  });

  contract("5.25", "a verified entry keeps the names of the tests that judged it, read back as written; one written without them has none", async ({ health, work }) => {
    const { contract, sibling } = await smallPlan(work);
    const tests = ["4.47 · the fold names its tests", "4.47 · a contract no run judged says neither"];
    const written = await health.recordVerified(contract.id, "passing", { by: "storytree test run", source: "local", tests });
    assert.deepEqual(written.tests, tests);
    const read = (await health.health(contract.id)).verified;
    assert.deepEqual(read.tests, tests);
    const inTree = (await health.annotate()).stories[0]!.capabilities[0]!.contracts.find(({ id }) => id === contract.id)!;
    assert.deepEqual(inTree.health.verified.tests, tests);

    await health.recordVerified(sibling.id, "passing", { by: "storytree test run" });
    assert.equal("tests" in (await health.health(sibling.id)).verified, false, "an entry written without test names has none");
  });

  contract("5.27", "a contract's newest verified entry read from CI is kept beside its newest verified entry, so a later local entry never replaces it; one CI never read carries none", async ({ health, work }) => {
    const { contract, sibling } = await smallPlan(work);
    const ci = await health.recordVerified(contract.id, "failing", { by: "the project's CI", source: "ci" });
    const local = await health.recordVerified(contract.id, "passing", { by: "storytree test run", source: "local" });
    const read = await health.health(contract.id);
    assert.equal(read.verified.state, "passing", "the newest entry is the local one");
    const { at, ...kept } = read.ci ?? {};
    assert.deepEqual(kept, { state: "failing", by: "the project's CI", source: "ci" }, "CI's stays beside it");
    assert.ok(at !== undefined && at >= ci.at && at <= local.at, "kept when CI wrote it");
    const inTree = (await health.annotate()).stories[0]!.capabilities[0]!.contracts.find(({ id }) => id === contract.id)!;
    assert.deepEqual(inTree.health.ci, read.ci);
    assert.deepEqual((await health.healthHistory(contract.id)).map(({ at }) => at), [ci.at, local.at], "CI's kept copy is no extra entry");

    await health.recordVerified(sibling.id, "passing", { by: "storytree test run", source: "local" });
    assert.equal("ci" in (await health.health(sibling.id)), false, "CI never read it: none");
  });

  contract("5.27", "a verified entry read from CI keeps its copy as the record health_<contract>_ci, beside the contract's plain verified record health_<contract>_verified", async ({ health, work, transactions }) => {
    const { contract } = await smallPlan(work);
    await health.recordVerified(contract.id, "failing", { by: "the project's CI", source: "ci" });
    await later();
    await health.recordVerified(contract.id, "passing", { by: "storytree test run", source: "local" });
    const stored = await healthRecordsOf(transactions, contract.id);
    assert.deepEqual(stored.map(({ id, fields }) => ({ id, state: fields.state, by: fields.by })).toSorted((a, b) => (a.id < b.id ? -1 : 1)), [
      { id: `health_${contract.id}_ci`, state: "failing", by: "the project's CI" },
      { id: `health_${contract.id}_verified`, state: "passing", by: "storytree test run" },
    ]);
  });

  contract("5.29", "recordVerifiedAll writes in one write each verdict that tells nothing, as recordVerified would, leaves each that would tell for recordVerified, and refuses them all for one that names no live contract", async ({ health, work, records, transactions }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    const failing = await work.addContract({ title: "Refuses a blank email", capability: capability.id });
    const mended = await work.addContract({ title: "Trims the email", capability: capability.id });
    await health.recordVerified(mended.id, "failing", { by: "an earlier run" });
    const fyis = (await records.list("fyi")).length;
    const ci = { by: "storytree test run on CI", source: "ci" as const };
    const entries = await health.recordVerifiedAll([
      { contractId: contract.id, state: "passing", options: { ...ci, note: "2/2 tests passed", tests: ["1.1 it does a"] } },
      { contractId: sibling.id, state: "not-checked", options: { ...ci, skip: "owner" } },
      { contractId: failing.id, state: "failing", options: ci },
      { contractId: mended.id, state: "passing", options: ci },
    ]);
    assert.deepEqual(entries.map((entry) => entry?.state), ["passing", "not-checked", undefined, undefined], "the two that tell are left");
    const read = await health.health(contract.id);
    assert.deepEqual({ ...read.verified, at: undefined }, { state: "passing", by: ci.by, source: "ci", note: "2/2 tests passed", tests: ["1.1 it does a"], at: undefined });
    assert.deepEqual({ ...read.ci, at: undefined }, { ...read.verified, at: undefined }, "with CI's copy beside it");
    assert.equal((await health.health(sibling.id)).verified.skip, "owner");
    assert.equal((await health.health(failing.id)).verified.state, "not-checked", "a failing verdict is not written here");
    assert.equal((await health.health(mended.id)).verified.state, "failing", "nor one turning green again");
    assert.equal((await records.list("fyi")).length, fyis, "and nothing is told");

    const before = await transactions.history();
    await assert.rejects(health.recordVerifiedAll([{ contractId: contract.id, state: "passing" }, { contractId: NO_CONTRACT, state: "passing" }]), MissingReferenceError);
    await assert.rejects(health.recordVerifiedAll([{ contractId: contract.id, state: "passing" }, { contractId: capability.id, state: "passing" }]), MissingReferenceError);
    await assert.rejects(health.recordVerifiedAll([{ contractId: contract.id, state: "passing" }, { contractId: contract.id, state: "failing" }]), RangeError);
    assert.deepEqual(await transactions.history(), before, "a refusal writes nothing");
  });

  contract("5.8", "a capability that is not healthy carries its reason in the annotated tree, and a healthy one none", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    const whyOf = async () => (await health.annotate()).stories[0]!.capabilities.find(({ id }) => id === capability.id)!.why;
    const elsewhere = await work.addCapability({ title: "Elsewhere", story: capability.fields.story });
    await health.recordVerified((await work.addContract({ title: "Checked elsewhere", capability: elsewhere.id })).id, "passing");
    assert.deepEqual(await whyOf(), { reason: "not built", mover: "agent", contracts: [] });
    await work.setProposed(capability.id, false);
    const inOrder = (await health.annotate()).stories[0]!.capabilities.find(({ id }) => id === capability.id)!.contracts.map(({ id }) => id);
    assert.deepEqual(inOrder.toSorted(), [contract.id, sibling.id].toSorted());
    assert.deepEqual(await whyOf(), { reason: "no test names it", mover: "agent", contracts: inOrder }, "in the capability's order");
    await health.recordVerified(contract.id, "passing");
    await work.editContract(sibling.id, { proof: { by: "agentic-user-acceptance-testing", reason: "Only a user's eye can tell." } });
    assert.deepEqual(await whyOf(), { reason: "acceptance test not run", mover: "agent", contracts: [sibling.id] }, "proved by acceptance testing, never recorded");
    const owner = await health.recordVerified(sibling.id, "not-checked", { skip: "owner" });
    assert.deepEqual(await whyOf(), { reason: "needs owner", mover: "owner", contracts: [sibling.id], since: owner.at });
    await health.recordVerified(sibling.id, "passing");
    assert.equal(await whyOf(), undefined, "healthy: no reason");
  });
  contract("5.10", "in a project whose health nothing verifies, a built capability carries no reason, is marked as shown by the agent's report, says so, and is off the worklist", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    const annotated = async () => {
      const tree = await health.annotate();
      return { tree, capability: tree.stories[0]!.capabilities[0]! };
    };
    assert.deepEqual((await annotated()).capability.why, { reason: "not built", mover: "agent", contracts: [] }, "not built is the agent's to build, verified or not");
    await work.setProposed(capability.id, false);
    await health.reportHealth(contract.id, "passing");
    await health.reportHealth(sibling.id, "passing");

    const unverified = await annotated();
    assert.equal(unverified.tree.unverified, true, "no verified entry anywhere in the project");
    assert.equal(unverified.capability.why, undefined, "no reason the agent could act on");
    assert.equal(unverified.capability.reportOnly, true);
    assert.equal(wordAndWhy(unverified.capability), "the agent reports passing; storytree does not check this project's tests yet");
    assert.deepEqual(await health.worklist(), [], "nothing for an agent to move");

    await health.recordVerified(contract.id, "passing");
    const verified = await annotated();
    assert.equal("unverified" in verified.tree, false);
    assert.equal("reportOnly" in verified.capability, false);
    assert.deepEqual(verified.capability.why, { reason: "no test names it", mover: "agent", contracts: [sibling.id] }, "once something verifies the project, today's reasons");
  });

  contract("5.9", "the health worklist lists each capability not healthy with its reason and since when, oldest first, leaving off one an open increment lists among its capabilities", async ({ health, work, flight }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const untested = await work.addCapability({ title: "Thank-you page", story: story.id });
    const failing = await work.addCapability({ title: "Email form", story: story.id });
    const check = await work.addContract({ title: "2.1 · Rejects a bad email", capability: failing.id });
    await later();
    const proposed = await work.addCapability({ title: "Password rules", story: story.id });
    const healthy = await work.addCapability({ title: "Sign-up button", story: story.id });
    const shown = await work.addContract({ title: "4.1 · Shows the button", capability: healthy.id });
    await later();
    const routed = await work.addCapability({ title: "Welcome email", story: story.id });
    for (const built of [untested, failing, healthy, routed]) await work.setProposed(built.id, false);
    await health.recordVerified(shown.id, "passing");
    await later();
    const failed = await health.recordVerified(check.id, "failing");
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const fix = await flight.addIncrement({ arc: arc.id, title: "Send the welcome email", objective: "Test it", body: "Red then green", capabilities: [routed.id] });

    const listed = await health.worklist();
    assert.deepEqual(listed.map(({ capability, title, story: of, status, why, since }) => ({ capability, title, story: of, status, reason: why.reason, mover: why.mover, since })), [
      { capability: untested.id, title: "1 · Thank-you page", story: story.id, status: "untested", reason: "no test names it", mover: "agent", since: untested.createdAt },
      { capability: proposed.id, title: "3 · Password rules", story: story.id, status: "proposed", reason: "not built", mover: "agent", since: proposed.createdAt },
      { capability: failing.id, title: "2 · Email form", story: story.id, status: "unhealthy", reason: "failing", mover: "agent", since: failed.at },
    ], "oldest first by since: a recorded reason's time, else the capability's own; the healthy one and the routed one left off");
    assert.deepEqual(listed[2]!.why.contracts, [check.id]);

    await flight.closeIncrement(fix.id, { disposition: "landed", pr: "1" });
    assert.deepEqual((await health.worklist()).map(({ capability }) => capability), [untested.id, proposed.id, routed.id, failing.id], "its route closed, it is offered again");
  });
  contract("5.30", "a capability a settled owner question records its answer leaves unbuilt is routed by that question: off the health worklist while the question stands", async ({ health, work, flight }) => {
    const { capability } = await smallPlan(work);
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state" });
    const question = await flight.raiseQuestion({ arc: arc.id, title: "Build social sign-in?", stakes: "Sign-in", statement: "Build it now?", context: "It is retired", options: "A. Build it. B. Leave it unbuilt." });
    const offered = async (): Promise<boolean> => (await health.worklist()).some((item) => item.capability === capability.id);
    assert.equal(await offered(), true, "not built, and nothing routes it");

    await flight.settleQuestion(question.id, { answer: "Just leave it as unbuilt" });
    assert.equal(await offered(), true, "settled without recording what it leaves unbuilt, it routes nothing");
    await flight.editQuestion(question.id, { unbuilt: [capability.id] });
    assert.equal(await offered(), false, "its answer leaves it unbuilt, so the question routes it");

    await flight.retireQuestion(question.id, "Asked in error");
    assert.equal(await offered(), true, "the question gone, it is offered again");
  });

  contract("5.31", "a live reading recorded for a contract proved by observability is its verified state: passing while within its freshness, not re-run once older, failing when it saw a fail", async ({ health, work, records }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    await work.setProposed(capability.id, false);
    await health.recordVerified(sibling.id, "passing");
    await work.editContract(contract.id, { proof: OBSERVED });
    const reading = await health.recordObserved(contract.id, "passing", { machine: "mint", evidence: "12 lines from mint and the laptop read back in order" });
    const hours = (count: number): Date => new Date(Date.parse(reading.at) + count * 3_600_000);
    const verified = async (now: Date): Promise<HealthColumn> => (await health.health(contract.id, { now })).verified;
    const whyAt = async (now: Date) => (await health.worklist({ now })).find((item) => item.capability === capability.id)?.why;

    assert.deepEqual(await verified(hours(47)), { state: "passing", by: OBSERVED.watcher, at: reading.at, note: "12 lines from mint and the laptop read back in order, taken on mint", source: "local" }, "within its freshness it passes, saying the watcher, the machine and the evidence");
    assert.equal(await whyAt(hours(47)), undefined, "and its capability is healthy");
    assert.equal((await health.annotate(undefined, undefined, hours(47))).stories[0]!.capabilities[0]!.status, "healthy");

    const stale = await verified(hours(49));
    assert.deepEqual({ state: stale.state, was: stale.was, by: stale.by }, { state: "not-checked", was: { state: "passing", at: reading.at }, by: OBSERVED.watcher }, "older than its freshness it is not re-run, never passing on an old reading");
    assert.match(stale.note ?? "", /^not re-run: its newest live reading, at .*, is older than its freshness of 2 days: 12 lines from mint and the laptop read back in order, taken on mint$/);
    assert.deepEqual(await whyAt(hours(49)), { reason: "not re-run", mover: "agent", contracts: [contract.id], since: reading.at });
    assert.equal((await health.annotate(undefined, undefined, hours(49))).stories[0]!.capabilities[0]!.status, "untested");
    await work.editContract(contract.id, { proof: { ...OBSERVED, freshness: "50h" } });
    assert.equal((await verified(hours(49))).state, "passing", "a freshness in hours: 50 hours covers 49");
    assert.equal((await verified(hours(51))).state, "not-checked", "and not 51");
    await work.editContract(contract.id, { proof: { ...OBSERVED, freshness: "1h" } });
    assert.match((await verified(hours(2))).note ?? "", /older than its freshness of 1 hour: /, "one hour, said in the singular");
    await work.editContract(contract.id, { proof: { ...OBSERVED, freshness: "1d" } });
    assert.equal((await verified(hours(23))).state, "passing");
    assert.match((await verified(hours(25))).note ?? "", /older than its freshness of 1 day: /, "one day, said in the singular");
    await work.editContract(contract.id, { proof: OBSERVED });
    const told = async () => (await records.list("fyi")).filter(({ fields }) => fields.about === contract.id).map(({ fields }) => fields.title);
    assert.deepEqual(await told(), [], "a passing reading tells nothing");

    await later();
    const failed = await health.recordObserved(contract.id, "failing", { machine: "laptop", evidence: "the box's lines did not reach the laptop" });
    const after = (count: number): Date => new Date(Date.parse(failed.at) + count * 3_600_000);
    assert.equal((await verified(after(1))).state, "failing", "a reading that saw it fail fails it");
    assert.equal((await verified(after(100))).state, "failing", "and it stays failing until a reading passes");
    assert.equal((await whyAt(after(1)))?.reason, "failing");
    assert.deepEqual(await told(), ["Red: 1.1 · Rejects a bad email"], "a reading that turns red tells the owner, as a test run's verdict does");
    await later();
    await health.recordObserved(contract.id, "passing", { machine: "mint", evidence: "seen again" });
    assert.deepEqual((await told()).toSorted(), ["Green again: 1.1 · Rejects a bad email", "Red: 1.1 · Rejects a bad email"], "and one that turns green again");
    await assert.rejects(health.recordObserved("contract_000000000000", "passing", { machine: "mint", evidence: "seen" }), MissingReferenceError, "a reading for no live contract is refused");

    await assert.rejects(health.recordObserved(sibling.id, "passing", { machine: "mint", evidence: "seen" }), /is not proved by observability as proof/, "a reading for a contract another proof proves is refused");
  });

  contract("5.31", "a live reading the library already holds as health_<contract>_observed is the contract's verified state while fresh; a test run's verdict goes to health_<contract>_verified beside it, leaving it untouched and out of the history, and the next reading updates that same record", async ({ health, work, records, transactions }) => {
    const { contract } = await smallPlan(work);
    await work.editContract(contract.id, { proof: OBSERVED });
    const observedId = `health_${contract.id}_observed`;
    const held = await records.create("health", { node: contract.id, column: "verified", state: "passing", by: OBSERVED.watcher, note: "12 lines read back in order, taken on mint", source: "local" }, { id: observedId });
    const heldAt = (await records.history({ id: observedId })).at(-1)!.at;
    const fresh = new Date(Date.parse(heldAt) + 3_600_000);
    const asHeld = { state: "passing", by: OBSERVED.watcher, at: heldAt, note: "12 lines read back in order, taken on mint", source: "local" };
    assert.deepEqual((await health.health(contract.id, { now: fresh })).verified, asHeld, "the held reading is the verified state");

    await later();
    await health.recordVerified(contract.id, "passing", { by: "storytree test run", source: "local" });
    assert.deepEqual((await health.health(contract.id, { now: fresh })).verified, asHeld, "a test run's pass does not stand in for the held reading");
    assert.deepEqual((await records.get(observedId))?.fields, held.fields, "the held reading is not written over");
    assert.deepEqual((await healthRecordsOf(transactions, contract.id)).map(({ id }) => id).toSorted(), [observedId, `health_${contract.id}_verified`].toSorted(), "the test run's verdict is its own record");
    assert.deepEqual((await health.healthHistory(contract.id)).map(({ by }) => by), ["storytree test run"], "the history holds the test run's verdict, not the live reading");

    await later();
    const failed = await health.recordObserved(contract.id, "failing", { machine: "laptop", evidence: "the box's lines did not reach the laptop" });
    assert.deepEqual((await healthRecordsOf(transactions, contract.id)).map(({ id }) => id).toSorted(), [observedId, `health_${contract.id}_verified`].toSorted(), "the next reading is written to the held record");
    assert.deepEqual((await health.health(contract.id)).verified, { state: "failing", by: OBSERVED.watcher, at: failed.at, note: "the box's lines did not reach the laptop, taken on laptop", source: "local" });
  });

  contract("5.32", "for a contract proved by observability a test run's skip or pass does not stand in for its live reading, a test's fail still fails it, and with no reading its reason is no live reading", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    await work.setProposed(capability.id, false);
    await health.recordVerified(sibling.id, "passing");
    await work.editContract(contract.id, { proof: OBSERVED });
    const whyOf = async () => (await health.annotate()).stories[0]!.capabilities[0]!.why;
    assert.deepEqual(await whyOf(), { reason: "no live reading", mover: "agent", contracts: [contract.id] }, "never read, its reason is no live reading, not a missing test");

    await health.recordVerified(contract.id, "passing", { by: "storytree test run on CI", source: "ci" });
    assert.equal((await health.health(contract.id)).verified.state, "not-checked", "a test's pass does not stand in for a live reading");
    assert.deepEqual(await whyOf(), { reason: "no live reading", mover: "agent", contracts: [contract.id] });

    const reading = await health.recordObserved(contract.id, "passing", { machine: "mint", evidence: "seen" });
    await health.recordVerified(contract.id, "not-checked", { by: "storytree test run on CI", source: "ci", skip: "other", was: { state: "passing", at: reading.at }, note: "not re-run: its live test skipped" });
    assert.equal((await health.health(contract.id)).verified.state, "passing", "CI's skip of a live-only test does not count against it");
    assert.equal(await whyOf(), undefined);

    await health.recordVerified(contract.id, "failing", { by: "storytree test run on CI", source: "ci", note: "1 failed" });
    const red = (await health.health(contract.id)).verified;
    assert.deepEqual({ state: red.state, note: red.note }, { state: "failing", note: "1 failed" }, "a test's fail still fails it");
  });

  contract("5.11", "a capability whose every contract carrying its reason a run in progress will record says it waits on that run; once the run records it, or the run's time is up, it is offered by what it records", async ({ health, work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const bad = await work.addContract({ title: "1.1 · Rejects a bad email", capability: form.id });
    const plus = await work.addContract({ title: "1.2 · Accepts a plus address", capability: form.id });
    await later();
    const page = await work.addCapability({ title: "Thank-you page", story: story.id });
    const shown = await work.addContract({ title: "2.1 · Shows thanks", capability: page.id });
    for (const built of [form, page]) await work.setProposed(built.id, false);
    await health.recordVerified(bad.id, "passing");
    await later();
    const run = { by: "storytree test run on CI", note: "Own health run at commit abc123 in progress" };
    const pending = await health.markVerifiedPending(plus.id, run);
    await later();
    const newer = await health.markVerifiedPending(shown.id, run);
    assert.deepEqual(await health.health(plus.id), { reported: { state: "not-checked" }, verified: { state: "not-checked" } }, "a pending mark is no verdict");

    const waiting = await health.worklist();
    assert.deepEqual(waiting.map(({ capability, why, waits }) => ({ capability, reason: why.reason, waits })), [
      { capability: form.id, reason: "no test names it", waits: { since: pending.at, by: run.by, note: run.note } },
      { capability: page.id, reason: "no test names it", waits: { since: newer.at, by: run.by, note: run.note } },
    ], "held back, saying the run they wait on");
    const recording = new Date(Date.parse(newer.at) + 60 * 60 * 1000);
    assert.equal((await health.worklist({ now: recording })).filter(({ waits }) => waits !== undefined).length, 2, "a run an hour into recording, inside Own health's time limit, still holds them");
    const ended = new Date(Date.parse(newer.at) + 2 * 60 * 60 * 1000);
    assert.deepEqual((await health.worklist({ now: ended })).map(({ waits }) => waits), [undefined, undefined], "a run past its time waits for nothing");

    await later();
    await health.recordVerified(plus.id, "passing");
    await health.recordVerified(shown.id, "failing");
    assert.deepEqual((await health.worklist()).map(({ capability, why, waits }) => ({ capability, reason: why.reason, waits })), [
      { capability: page.id, reason: "failing", waits: undefined },
    ], "the run recorded them: the healthy one is off the list, the failing one offered");
  });

  contract("5.11", "a pending mark is written as the record health_<contract>_pending, beside the contract's plain verified record health_<contract>_verified", async ({ health, work, transactions }) => {
    const { contract } = await smallPlan(work);
    await health.recordVerified(contract.id, "passing", { by: "an earlier run" });
    await later();
    await health.markVerifiedPending(contract.id, { by: "storytree test run on CI", note: "Own health run at commit abc123 in progress" });
    const stored = await healthRecordsOf(transactions, contract.id);
    assert.deepEqual(stored.map(({ id, fields }) => ({ id, state: fields.state, by: fields.by })).toSorted((a, b) => (a.id < b.id ? -1 : 1)), [
      { id: `health_${contract.id}_pending`, state: "not-checked", by: "storytree test run on CI" },
      { id: `health_${contract.id}_verified`, state: "passing", by: "an earlier run" },
    ]);
  });
  contract("5.12", "a capability whose story's code changed on main after its contracts carrying its reason were last verified waits on that commit's run; once they are verified after it, or the time is up, it is offered by what is recorded", async ({ health, work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const other = await work.addStory({ title: "Visitor can sign in" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const bad = await work.addContract({ title: "1.1 · Rejects a bad email", capability: form.id });
    const page = await work.addCapability({ title: "Thank-you page", story: story.id });
    const shown = await work.addContract({ title: "2.1 · Shows thanks", capability: page.id });
    const empty = await work.addCapability({ title: "Welcome email", story: story.id });
    const login = await work.addCapability({ title: "Login form", story: other.id });
    await work.addContract({ title: "1.1 · Logs in", capability: login.id });
    for (const built of [form, page, empty, login]) await work.setProposed(built.id, false);
    await later();
    await health.recordVerified(bad.id, "failing");
    await later();
    const merged = { commit: "8c3903b4", at: new Date().toISOString() };
    const changed = new Map([[story.id, merged]]);
    await later();
    const recorded = await health.recordVerified(shown.id, "failing");

    const waiting = await health.worklist({ changed });
    assert.deepEqual(new Map(waiting.map(({ capability, why, waits }) => [capability, { reason: why.reason, held: waits !== undefined }])), new Map([
      [empty.id, { reason: "no test names it", held: false }],
      [login.id, { reason: "no test names it", held: false }],
      [form.id, { reason: "failing", held: true }],
      [page.id, { reason: "failing", held: false }],
    ]), "only the one verified before its story's newest commit waits: one verified since, one in a story that did not change, and one no contract carries are offered");
    const waits = waiting.find(({ capability }) => capability === form.id)!.waits!;
    assert.equal(waits.since, merged.at);
    assert.match(waits.note ?? "", /8c3903b4/, "it says the commit it waits on");
    assert.ok(recorded.at > merged.at);

    const recording = new Date(Date.parse(merged.at) + 2 * 60 * 60 * 1000);
    assert.notEqual((await health.worklist({ changed, now: recording })).find(({ capability }) => capability === form.id)!.waits, undefined, "a commit whose run may still be recording two hours on still holds it");
    const over = new Date(Date.parse(merged.at) + 3 * 60 * 60 * 1000);
    assert.equal((await health.worklist({ changed, now: over })).find(({ capability }) => capability === form.id)!.waits, undefined, "a commit past its run's time waits for nothing");

    await later();
    await health.recordVerified(bad.id, "failing");
    assert.equal((await health.worklist({ changed })).find(({ capability }) => capability === form.id)!.waits, undefined, "verified since the commit: offered by what is recorded");
  });

  contract("5.13", "a capability not proven carries the arcs that park it in the annotated tree; a healthy or unhealthy one, or one not parked, carries none (ADR-0992)", async ({ health, work }) => {
    const { capability, contract, sibling } = await smallPlan(work);
    const other = await work.addCapability({ title: "Elsewhere", story: capability.fields.story });
    const parked = new Map([[capability.id, [{ arc: "arc-1", title: "Shelved" }]]]);
    const parkedOf = async (id: string) => (await health.annotate(undefined, parked)).stories[0]!.capabilities.find((one) => one.id === id)!.parkedOn;
    assert.deepEqual(await parkedOf(capability.id), [{ arc: "arc-1", title: "Shelved" }], "proposed and parked");
    assert.equal(await parkedOf(other.id), undefined, "not parked");
    assert.equal((await health.annotate()).stories[0]!.capabilities.find((one) => one.id === capability.id)!.parkedOn, undefined, "nothing parked is given");
    await work.setProposed(capability.id, false);
    await health.recordVerified(contract.id, "failing");
    assert.equal(await parkedOf(capability.id), undefined, "red stays red on a parked arc");
    await health.recordVerified(contract.id, "passing");
    assert.deepEqual(await parkedOf(capability.id), [{ arc: "arc-1", title: "Shelved" }], "untested and parked");
    await health.recordVerified(sibling.id, "passing");
    assert.equal(await parkedOf(capability.id), undefined, "green is unchanged");
  });

  contract("5.19", "each capability in the annotated tree carries the open increments naming it, the active ones first, then the rest in parked order; one no open increment names carries none (ADR-1253 D1)", async ({ health, work, flight }) => {
    const { story, capability } = await smallPlan(work);
    const other = await work.addCapability({ title: "Elsewhere", story: story.id });
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const add = async (title: string, capabilities: string[]) => {
      const increment = await flight.addIncrement({ arc: arc.id, title, objective: "Test it", body: "Red then green" });
      await flight.editIncrement(increment.id, { capabilities });
      await later();
      return increment;
    };
    const first = await add("First parked", [capability.id]);
    const second = await add("Second parked", [capability.id, other.id]);
    const started = await add("Started last", [capability.id]);
    const landed = await add("Already landed", [capability.id]);
    await flight.advanceIncrement(started.id, "active");
    await flight.closeIncrement(landed.id, { disposition: "landed", pr: "1" });
    const openOf = async (id: string) => (await health.annotate()).stories[0]!.capabilities.find((one) => one.id === id)!.openWork;
    assert.deepEqual(await openOf(capability.id), [
      { increment: started.id, title: "Started last", active: true },
      { increment: first.id, title: "First parked" },
      { increment: second.id, title: "Second parked" },
    ], "the active one first, then parked order; the closed one left off");
    assert.deepEqual(await openOf(other.id), [{ increment: second.id, title: "Second parked" }]);
    await flight.closeIncrement(second.id, { disposition: "withdrawn", note: "Not needed" });
    assert.equal(await openOf(other.id), undefined, "no open increment names it");
  });

  contract("5.28", "the open increment that moves a capability, its first, says what still holds it: the work it waits on, by title and whether that is under way or ready to take, a claim, a question, or a wait for the owner or an event; the increments behind it say nothing", async ({ health, work, flight }) => {
    const { story } = await smallPlan(work);
    const harness = await work.addCapability({ title: "Test harness", story: story.id });
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const leads = new Map<string, string[]>();
    const add = async (title: string, extra: { heldOn?: string[]; arc?: string } = {}, capabilities?: string[]) => {
      const increment = await flight.addIncrement({ arc: extra.arc ?? arc.id, title, objective: "Test it", body: "Red then green", ...(extra.heldOn === undefined ? {} : { heldOn: extra.heldOn }) });
      const named = capabilities ?? [(await work.addCapability({ title: `${title} capability`, story: story.id })).id];
      await flight.editIncrement(increment.id, { capabilities: named });
      leads.set(increment.id, named);
      await later();
      return increment;
    };
    const oracle = await add("Test harness and DB oracle", {}, [harness.id]);
    const task = await add("Task 1");
    await flight.addWait(task.id, oracle.id, "needs the harness");
    const question = await flight.raiseQuestion({ arc: arc.id, title: "Copy?", stakes: "Blocks the form", statement: "Which words?", context: "None yet", options: "Short or long" });
    const held = await add("Held task", { heldOn: [question.id] });
    const owner = await add("Owner task");
    await flight.addWaitFor(owner.id, { releaser: "owner", note: "sign in to the store", why: "the build is published" });
    const free = await add("Free task");
    const claimed = await add("Claim task");
    await flight.addWait(claimed.id, harness.id, "waits on its claim");
    const mail = await flight.createArc({ title: "Mail", intent: "An intent", endState: "An end state", stories: [story.id] });
    const after = await flight.createArc({ title: "After mail", intent: "An intent", endState: "An end state", stories: [story.id] });
    await flight.addWait(after.id, mail.id, "needs mail first");
    const arcWait = await add("Arc task", { arc: after.id });
    const behind = await add("Held behind the free task", { heldOn: [question.id] }, leads.get(free.id));
    const waitsOf = async () => new Map((await health.annotate()).stories[0]!.capabilities.flatMap((one) => one.openWork ?? []).map(({ increment, waits }) => [increment, waits]));

    let waits = await waitsOf();
    assert.deepEqual(waits.get(task.id), [{ kind: "work", on: oracle.id, title: "Test harness and DB oracle", state: "ready" }], "a blocker nothing holds and nobody started is ready to take");
    assert.deepEqual(waits.get(held.id), [{ kind: "question", on: question.id }]);
    assert.deepEqual(waits.get(owner.id), [{ kind: "owner", note: "sign in to the store" }]);
    assert.equal(waits.get(free.id), undefined, "nothing holds it");
    assert.ok(waits.has(behind.id) && waits.get(behind.id) === undefined, "held, but behind the one that moves its capability, so it says nothing");
    assert.deepEqual(waits.get(claimed.id), [{ kind: "claim", on: harness.id, title: harness.fields.title }], "a claim wait, by its capability's title");
    assert.deepEqual(waits.get(arcWait.id), [{ kind: "work", on: mail.id, title: "Mail" }], "its arc's wait on another arc, by that arc's title");
    await flight.advanceIncrement(oracle.id, "active");
    waits = await waitsOf();
    assert.deepEqual(waits.get(task.id), [{ kind: "work", on: oracle.id, title: "Test harness and DB oracle", state: "active" }], "a started blocker is under way");
    await flight.closeIncrement(oracle.id, { disposition: "landed", pr: "1" });
    assert.equal((await waitsOf()).get(task.id), undefined, "a landed blocker holds nothing");
  });

  contract("5.26", "a capability one of whose contracts an open increment links carries that increment among its open work, as one the increment names does, once and in the same order", async ({ health, work, flight }) => {
    const { story, capability, contract, sibling } = await smallPlan(work);
    const other = await work.addCapability({ title: "Elsewhere", story: story.id });
    const arc = await flight.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const add = async (title: string, edit: { capabilities?: string[]; links?: string[] }) => {
      const increment = await flight.addIncrement({ arc: arc.id, title, objective: "Test it", body: "Red then green" });
      await flight.editIncrement(increment.id, edit);
      await later();
      return increment;
    };
    const linking = await add("Links a contract", { links: [contract.id, sibling.id] });
    const both = await add("Names it and links", { capabilities: [capability.id], links: [contract.id] });
    const started = await add("Started, links it", { links: [sibling.id] });
    await flight.advanceIncrement(started.id, "active");
    const openOf = async (id: string) => (await health.annotate()).stories[0]!.capabilities.find((one) => one.id === id)!.openWork;
    assert.deepEqual(await openOf(capability.id), [
      { increment: started.id, title: "Started, links it", active: true },
      { increment: linking.id, title: "Links a contract" },
      { increment: both.id, title: "Names it and links" },
    ], "linked as named: the active one first, then parked order, each once");
    assert.equal(await openOf(other.id), undefined, "no open increment names it or links its contracts");
    await flight.closeIncrement(started.id, { disposition: "withdrawn", note: "Not needed" });
    assert.deepEqual((await openOf(capability.id))!.map(({ increment }) => increment), [linking.id, both.id], "a closed one is left off");
  });

  contract("5.14", "a proposed capability with at least one contract and every contract verified passing is on the worklist still not built and the agent's, marked that its contracts already pass; one with no contract or any contract not passing is not so marked", async ({ health, work }) => {
    const { story, capability, contract, sibling } = await smallPlan(work);
    const empty = await work.addCapability({ title: "Nothing promised", story: story.id });
    const itemOf = async (id: string) => (await health.worklist()).find((item) => item.capability === id)!;
    await health.recordVerified(contract.id, "passing");
    assert.equal((await itemOf(capability.id)).contractsPass, undefined, "one contract not verified");
    await health.recordVerified(sibling.id, "passing");
    const passing = await itemOf(capability.id);
    assert.equal(passing.contractsPass, true);
    assert.deepEqual([passing.status, passing.why.reason, passing.why.mover], ["proposed", "not built", "agent"], "its reason and mover unchanged");
    assert.equal((await itemOf(empty.id)).contractsPass, undefined, "no contract");
    await health.recordVerified(sibling.id, "failing");
    assert.equal((await itemOf(capability.id)).contractsPass, undefined, "one failing");
  });

  contract("5.15", "a capability whose every contract carrying \"no test names it\" a test on main names is held back, saying so with main's commit, until a run records it; one with any such contract unnamed on main is offered as before", async ({ health, work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const bad = await work.addContract({ title: "1.1 · Rejects a bad email", capability: form.id });
    const plus = await work.addContract({ title: "1.2 · Accepts a plus address", capability: form.id });
    const page = await work.addCapability({ title: "Thank-you page", story: story.id });
    const shown = await work.addContract({ title: "2.1 · Shows thanks", capability: page.id });
    const said = await work.addContract({ title: "2.2 · Says the address", capability: page.id });
    const empty = await work.addCapability({ title: "Welcome email", story: story.id });
    for (const built of [form, page, empty]) await work.setProposed(built.id, false);
    await health.recordVerified(bad.id, "passing");
    const named = { commit: "5d1e0a77", at: new Date().toISOString(), contracts: [plus.id, shown.id] };

    const waiting = await health.worklist({ named });
    assert.deepEqual(new Map(waiting.map(({ capability, why, waits }) => [capability, { reason: why.reason, held: waits !== undefined }])), new Map([
      [form.id, { reason: "no test names it", held: true }],
      [page.id, { reason: "no test names it", held: false }],
      [empty.id, { reason: "no test names it", held: false }],
    ]), "held only when a test on main names every contract carrying it; one with a contract unnamed, or none, is offered");
    const waits = waiting.find(({ capability }) => capability === form.id)!.waits!;
    assert.equal(waits.since, named.at);
    assert.match(waits.note ?? "", /5d1e0a77/, "it says main's commit");
    assert.match(waits.note ?? "", /1\.2/, "it names the contract by its number");
    assert.match(waits.note ?? "", /no recorded run/, "it says what it waits on");

    await health.recordVerified(plus.id, "failing");
    await later();
    await health.recordVerified(said.id, "failing");
    assert.deepEqual((await health.worklist({ named })).filter(({ capability }) => capability !== empty.id).map(({ capability, why, waits }) => ({ capability, reason: why.reason, waits })), [
      { capability: form.id, reason: "failing", waits: undefined },
      { capability: page.id, reason: "failing", waits: undefined },
    ], "a run recorded them: offered by what it records, a named test no hold on another reason");
  });

  contract("5.18", "a health worklist item whose reason is failing carries the verified note of the first contract carrying it, with the failure's message that note holds; an item with any other reason carries none", async ({ health, work }) => {
    const { story, capability, contract, sibling } = await smallPlan(work);
    const page = await work.addCapability({ title: "Thank-you page", story: story.id });
    await work.addContract({ title: "Shows thanks", capability: page.id });
    for (const built of [capability, page]) await work.setProposed(built.id, false);
    const note = "0/1 tests passed; first failure: ENOENT: no such file or directory, open 'torn-down.txt', at commit 6c38737";
    await health.recordVerified(sibling.id, "failing", { by: "storytree test run on CI", note });
    await later();
    await health.recordVerified(contract.id, "failing", { by: "storytree test run on CI", note: "1/2 tests passed" });
    const itemOf = async (id: string) => (await health.worklist()).find((item) => item.capability === id)!;
    const failing = await itemOf(capability.id);
    assert.equal(failing.why.reason, "failing");
    assert.equal(failing.failure, (await health.health(failing.why.contracts[0]!)).verified.note, "the first carrying contract's note, in the capability's order");
    assert.equal((await itemOf(page.id)).failure, undefined, "no test names it: no failure to quote");
    await health.recordVerified(contract.id, "passing");
    assert.equal((await itemOf(capability.id)).failure, note, "the one contract still failing says why");
  });

  contract("5.16", "an explored capability of an imported story has no health until it has a contract: no reason, and off the worklist; given a contract, it is read as any capability", async ({ health, work }) => {
    const { added: [app] } = await work.mapStories("/code/app", [{ package: ".", title: "app", folders: ["."] }]);
    const stats = await work.addCapability({ title: "Stats page", story: app!.id, covers: ["app/stats"] });
    const built = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: built.id });
    const annotated = (await health.annotate()).stories.flatMap((story) => story.capabilities);
    assert.equal(annotated.find(({ id }) => id === stats.id)!.why, undefined, "explored, with nothing promised");
    assert.equal(annotated.find(({ id }) => id === form.id)!.why?.reason, "not built", "a built story's empty capability still has its reason");
    assert.deepEqual((await health.worklist()).map(({ capability }) => capability), [form.id]);
    await work.addContract({ title: "Shows the week's totals", capability: stats.id });
    assert.equal((await health.worklist()).find(({ capability }) => capability === stats.id)?.why.reason, "not built", "a contract puts it on the ordinary ladder");
  });

  contract("5.20", "a capability's reading from tests no contract claims rolls into its verified health, its word and its story's, and when failing makes its reason failing with the reading's note on its worklist item; a not-checked reading counts for nothing, and the reading is refused on anything but a live capability", async ({ health, work }) => {
    const { added: [app] } = await work.mapStories("/code/app", [{ package: ".", title: "app", folders: ["."] }]);
    const stats = await work.addCapability({ title: "Stats page", story: app!.id, covers: ["app/stats"] });
    const cart = await work.addCapability({ title: "Cart", story: app!.id, covers: ["app/cart"] });
    const totals = await work.addContract({ title: "Shows the week's totals", capability: cart.id });
    await health.recordVerified(totals.id, "passing", { by: "a local test run" });
    const read = async () => {
      const [story] = (await health.annotate()).stories;
      return { story: story!, of: (id: string) => story!.capabilities.find((capability) => capability.id === id)! };
    };
    const before = await read();
    assert.equal(before.of(stats.id).health.verified.state, "not-checked", "control: explored, with nothing promised");
    assert.equal(before.of(stats.id).why, undefined);
    assert.equal(before.story.health.verified.state, "passing", "control: the story reads its one passing contract");

    await health.recordUnclaimed(stats.id, "failing", { by: "a local test run", note: "0/1 tests passed; first failure: assert 3 == 4" });
    const failing = await read();
    assert.equal(failing.of(stats.id).health.verified.state, "failing");
    assert.equal(failing.of(stats.id).unclaimed?.state, "failing", "the reading is shown on the capability");
    assert.equal(failing.of(stats.id).why?.reason, "failing");
    assert.equal(failing.story.health.verified.state, "failing", "the story's roll-up holds it");
    assert.equal((await health.health(stats.id)).verified.state, "failing", "health() reads it as annotate does");
    const item = (await health.worklist()).find(({ capability }) => capability === stats.id);
    assert.equal(item?.why.reason, "failing");
    assert.equal(item?.failure, "0/1 tests passed; first failure: assert 3 == 4");

    await health.recordUnclaimed(cart.id, "failing", { by: "a local test run" });
    assert.equal((await read()).of(cart.id).health.verified.state, "failing");
    assert.equal((await read()).of(cart.id).why?.reason, "failing");
    await health.recordUnclaimed(cart.id, "passing", { by: "a local test run" });
    assert.equal((await read()).of(cart.id).health.verified.state, "passing");
    await health.recordUnclaimed(cart.id, "not-checked", { by: "a local test run" });
    assert.equal((await read()).of(cart.id).health.verified.state, "passing", "not checked leaves its contract's passing standing");
    await health.recordUnclaimed(stats.id, "not-checked", { by: "a local test run" });
    assert.equal((await read()).of(stats.id).health.verified.state, "not-checked");
    assert.equal((await read()).of(stats.id).why, undefined, "back to explored, with nothing promised");

    for (const id of [totals.id, app!.id, NO_CONTRACT]) {
      await assert.rejects(health.recordUnclaimed(id, "failing"), (error) => error instanceof MissingReferenceError && error.field === "node" && error.id === id, id);
    }
  });

  contract("5.21", "an explored capability of an imported story with a verified result tied to it takes its verified word and reason even while proposed; with none tied it stays proposed, and a built story's stays proposed whatever its health", async ({ health, work }) => {
    const { added: [app] } = await work.mapStories("/code/app", [{ package: ".", title: "app", folders: ["."] }]);
    const retrieval = await work.addCapability({ title: "Retrieval", story: app!.id, covers: ["app/retrieval"] });
    const api = await work.addCapability({ title: "API", story: app!.id, covers: ["app/api"] });
    const unclaimedOnly = await work.addCapability({ title: "Compiler", story: app!.id, covers: ["app/compiler"] });
    const untied = await work.addCapability({ title: "Help", story: app!.id, covers: ["app/help"] });
    const fails = await work.addContract({ title: "Finds what the caller may read", capability: retrieval.id });
    const [passes, open] = [await work.addContract({ title: "Answers a ping", capability: api.id }), await work.addContract({ title: "Pages a list", capability: api.id })];
    await work.addContract({ title: "Shows help", capability: untied.id });
    const built = await smallPlan(work);
    await health.recordVerified(fails.id, "failing", { by: "a local test run" });
    await health.recordVerified(passes.id, "passing", { by: "a local test run" });
    await health.recordUnclaimed(unclaimedOnly.id, "passing", { by: "a local test run" });
    await health.recordVerified(built.contract.id, "failing", { by: "a local test run" });
    const read = async () => new Map((await health.annotate()).stories.flatMap((story) => story.capabilities).map((capability) => [capability.id, capability]));
    let of = await read();
    assert.ok([retrieval, api, unclaimedOnly, untied, built.capability].every(({ id }) => of.get(id)!.proposed), "control: every one is still proposed");
    assert.equal(of.get(retrieval.id)!.status, "unhealthy", "a failing test reads red");
    assert.deepEqual(of.get(retrieval.id)!.why, { reason: "failing", mover: "agent", contracts: [fails.id], since: of.get(retrieval.id)!.contracts[0]!.health.verified.at });
    assert.equal(of.get(api.id)!.status, "untested", "one passing, one with no test: the roll-up says untested");
    assert.deepEqual(of.get(api.id)!.why, { reason: "no test names it", mover: "agent", contracts: [open.id] });
    assert.equal(of.get(unclaimedOnly.id)!.status, "healthy", "tests no contract claims, all passing, read green");
    assert.equal(of.get(unclaimedOnly.id)!.why, undefined);
    assert.equal(of.get(untied.id)!.status, "proposed", "no result tied: still proposed");
    assert.equal(of.get(untied.id)!.why?.reason, "not built");
    assert.equal(of.get(built.capability.id)!.status, "proposed", "a built story's capability stays proposed while its flag is on");
    assert.equal(of.get(built.capability.id)!.why?.reason, "not built");
    await health.recordVerified(passes.id, "failing", { by: "a local test run" });
    of = await read();
    assert.equal(of.get(api.id)!.status, "unhealthy", "and turns red when a tied test fails");
  });

  contract("5.22", "each edge in the annotated tree carries its contracts with their own health; an edge contract's health rolls into neither capability's nor its story's", async ({ health, work, records }) => {
    const { story, capability: form, contract } = await smallPlan(work);
    const link = await work.addCapability({ title: "Confirmation link", story: story.id, dependsOn: [form.id] });
    const edge = (await records.list("edge"))[0]!;
    const fails = await work.addContract({ title: "The link reads the form's address", edge: edge.id });
    await later();
    const open = await work.addContract({ title: "The address arrives checked", edge: edge.id });
    await health.recordVerified(contract.id, "passing", { by: "a local test run" });
    await health.recordVerified(fails.id, "failing", { by: "a local test run" });
    await health.reportHealth(fails.id, "passing");
    const [annotated] = (await health.annotate()).stories;
    assert.deepEqual(annotated!.edges?.map(({ id, from, to, contracts }) => ({ id, from, to, contracts: contracts.map(({ id, health }) => [id, health.reported.state, health.verified.state]) })), [
      { id: edge.id, from: link.id, to: form.id, contracts: [[fails.id, "passing", "failing"], [open.id, "not-checked", "not-checked"]] },
    ]);
    const capabilities = new Map(annotated!.capabilities.map((capability) => [capability.id, capability]));
    assert.equal(capabilities.get(form.id)!.health.verified.state, "not-checked", "the form's own contracts: one passing, one not checked");
    assert.equal(capabilities.get(link.id)!.health.verified.state, "not-checked", "the dependent holds no contract of its own");
    assert.equal(annotated!.health.verified.state, "not-checked", "the story rolls up its capabilities' contracts only, never the failing edge contract");
  });

  contract("5.23", "a verified verdict that turns failing, or stays failing but releases a fix waiting on it, records one FYI for the owner with the contract, its cause and what is being done; one that turns passing again records one; a verdict that stays as it was records none", async ({ work, flight, records }) => {
    const health = new HealthRecord(records, work, flight);
    const { capability, contract, sibling } = await smallPlan(work);
    const told = async (act: () => Promise<unknown>) => {
      const before = new Set((await records.list("fyi")).map(({ id }) => id));
      await act();
      return (await records.list("fyi")).filter(({ id }) => !before.has(id)).map(({ fields }) => fields);
    };

    assert.deepEqual(await told(() => health.recordVerified(contract.id, "passing", { by: "run 1" })), [], "a first passing verdict tells nothing");
    const [red, ...extra] = await told(() => health.recordVerified(contract.id, "failing", { by: "run 2", note: "0/1 tests passed; first failure: bad@ accepted" }));
    assert.deepEqual(extra, [], "one FYI for the flip");
    assert.equal(red!.about, contract.id);
    for (const said of ["Rejects a bad email", "failing", "bad@ accepted", "nothing routed"]) assert.ok(`${red!.title} ${red!.what}`.includes(said), `the red FYI says ${said}`);
    assert.deepEqual(await told(() => health.recordVerified(contract.id, "failing", { by: "run 3" })), [], "a verdict that stays red tells nothing more");
    assert.deepEqual(await told(() => health.recordVerified(contract.id, "not-checked", { by: "run 4", skip: "other", was: { state: "failing", at: new Date().toISOString() } })), [], "a not-checked reading tells nothing");
    assert.deepEqual(await told(() => health.recordVerified(contract.id, "failing", { by: "run 5" })), [], "nor does red again after it, the verdict it kept");

    const arc = await flight.createArc({ title: "Fix sign-up", intent: "An intent", endState: "An end state" });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const fix = await flight.addIncrement({ arc: arc.id, title: "Fix the email check", objective: "Do it", body: "The steps.", capabilities: [capability.id], waitsFor: [{ releaser: "event", note: "the next run", checkBack: tomorrow }] });
    const linked = await flight.addIncrement({ arc: arc.id, title: "Re-check the email rule", objective: "Do it", body: "The steps.", links: [contract.id] });
    const [uncured, ...more] = await told(() => health.recordVerified(contract.id, "failing", { by: "run 6", note: "still accepts bad@" }));
    assert.deepEqual(more, [], "a fix that did not cure it is told once");
    for (const said of ["still accepts bad@", fix.id, "Fix the email check", linked.id]) assert.ok(`${uncured!.title} ${uncured!.what}`.includes(said), `the uncured FYI says ${said}`);
    assert.deepEqual(await told(() => health.recordVerified(contract.id, "failing", { by: "run 7" })), [], "once released, red again tells nothing");

    const [green, ...again] = await told(() => health.recordVerified(contract.id, "passing", { by: "run 8" }));
    assert.deepEqual(again, [], "one FYI for the return");
    assert.equal(green!.about, contract.id);
    for (const said of ["Rejects a bad email", "passing"]) assert.ok(`${green!.title} ${green!.what}`.includes(said), `the green FYI says ${said}`);
    assert.deepEqual(await told(() => health.recordVerified(contract.id, "passing", { by: "run 9" })), [], "a verdict that stays green tells nothing more");
    assert.deepEqual(await told(() => health.reportHealth(sibling.id, "failing")), [], "an agent's report is no verdict");
    assert.equal(((await records.get(fix.id))?.fields as { waitsFor?: unknown }).waitsFor, undefined, "the release 10.44 does is unchanged");
  });

  contract("5.24", "a verified verdict's turn since a given time that told nothing, its writer's role refusing the FYI (3.20), is told at the verdict's own time: red, green again, and a fix it was waiting on released as still red; a turn told when it was written, a verdict that stayed as it was and a second telling tell nothing more", async ({ work, flight, records }) => {
    const health = new HealthRecord(records, work, flight);
    const ci = new HealthRecord(onlyHealth(records), work);
    const onCi = (id: string, state: "passing" | "failing", by: string) =>
      ci.recordVerified(id, state, { by, source: "ci" }).catch((error: { code?: string }) => {
        if (error.code !== "42501") throw error;
      });
    const { capability, contract, sibling } = await smallPlan(work);
    const gone = await work.addContract({ title: "Retired since", capability: capability.id });
    for (const id of [contract.id, sibling.id, gone.id]) await health.recordVerified(id, "passing", { by: "run 1" });
    await later();
    const from = new Date().toISOString();
    const fyis = async () => (await records.list("fyi")).map(({ fields }) => fields).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const verdictAt = async (id: string) => (await health.health(id)).verified.at!;

    await onCi(gone.id, "failing", "CI run 2");
    await records.retire(gone.id, "no longer promised");
    await onCi(contract.id, "failing", "CI run 2");
    const redAt = await verdictAt(contract.id);
    await onCi(contract.id, "failing", "CI run 3");
    await health.recordVerified(sibling.id, "failing", { by: "a local run" });
    await onCi(sibling.id, "passing", "CI run 4");
    const greenAt = await verdictAt(sibling.id);
    const arc = await flight.createArc({ title: "Fix sign-up", intent: "An intent", endState: "An end state" });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const fix = await flight.addIncrement({ arc: arc.id, title: "Fix the email check", objective: "Do it", body: "The steps.", capabilities: [capability.id], waitsFor: [{ releaser: "event", note: "the next run", checkBack: tomorrow }] });
    const before = new Set((await fyis()).map((fyi) => `${fyi.about} ${fyi.at} ${fyi.title}`));

    const turns = await health.tellUntold(from);
    assert.deepEqual(turns.map(({ contract: id, at }) => [id, at]), [[contract.id, redAt], [sibling.id, greenAt]], "the red and the green again CI could not tell; not the turn told locally, nor a retired contract's");
    const told = (await fyis()).filter((fyi) => !before.has(`${fyi.about} ${fyi.at} ${fyi.title}`));
    assert.equal(told.length, 2);
    const toldAbout = new Map(told.map((fyi) => [fyi.about, fyi]));
    assert.deepEqual(new Map([...toldAbout].map(([about, { at }]) => [about, at])), new Map([[contract.id, redAt], [sibling.id, greenAt]]), "one FYI each, at the verdict's own time, in no promised order: the two can share a millisecond");
    for (const said of ["Red", "Rejects a bad email", "CI run 2"]) assert.ok(`${toldAbout.get(contract.id)!.title} ${toldAbout.get(contract.id)!.what}`.includes(said), `the red FYI says ${said}`);
    for (const said of ["Green again", "Accepts a plus address", "CI run 4"]) assert.ok(`${toldAbout.get(sibling.id)!.title} ${toldAbout.get(sibling.id)!.what}`.includes(said), `the green FYI says ${said}`);
    assert.deepEqual(((await records.get(fix.id))?.fields as { waitsFor?: unknown[] }).waitsFor, [{ releaser: "event", note: "the next run", checkBack: tomorrow }], "a fix made to wait after the red is not released by it");

    await onCi(contract.id, "failing", "CI run 5");
    const [uncured, ...more] = await health.tellUntold(from);
    assert.deepEqual(more, [], "only the red the fix waited on is new");
    assert.deepEqual(uncured!.released, [fix.id], "the fix it waited on is released");
    assert.equal(((await records.get(fix.id))?.fields as { waitsFor?: unknown[] }).waitsFor, undefined);
    assert.ok((await fyis()).some(({ about, title }) => about === contract.id && title.startsWith("Still red after a fix")));

    const recheck = await flight.addIncrement({ arc: arc.id, title: "Re-check the plus address", objective: "Do it", body: "The steps.", links: [sibling.id], waitsFor: [{ releaser: "event", note: "the next run", checkBack: tomorrow }] });
    const unreleased = await fyis();
    await new HealthRecord(records, work).recordVerified(sibling.id, "failing", { by: "a run with no work in flight" });
    assert.equal((await fyis()).length, unreleased.length + 1, "a writer with no work in flight tells the red but releases nothing");
    const [releasing, ...others] = await health.tellUntold(from);
    assert.deepEqual(others, []);
    assert.deepEqual(releasing!.released, [recheck.id], "the red already told releases the work it could not");
    assert.equal((await fyis()).length, unreleased.length + 1, "and is not told twice");

    const count = (await fyis()).length;
    assert.deepEqual(await health.tellUntold(from), [], "told once, never again");
    assert.equal((await fyis()).length, count);
  });

  contract("5.33", "a failing verified verdict naming a flaky test parks one investigation increment for that test, on that test's own arc, or attaches the flake as evidence to the investigation already open for it; telling again adds nothing, and a failing verdict naming no flaky test parks none", async ({ work, flight, records }) => {
    const health = new HealthRecord(records, work, flight);
    const ci = new HealthRecord(onlyHealth(records), work);
    const onCi = (id: string, state: "passing" | "failing", note: string, flaky?: string[]) =>
      ci.recordVerified(id, state, { by: "storytree test run on CI", source: "ci", note, ...(flaky === undefined ? {} : { flaky }) }).catch((error: { code?: string }) => {
        if (error.code !== "42501") throw error;
      });
    const { story, contract, sibling } = await smallPlan(work);
    const flaky = "email form › 1.1 rejects a bad email";
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    const from = new Date().toISOString();
    const open = async () => (await records.list("increment")).filter(({ fields }) => fields.status !== "closed");

    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${first}`, [flaky]);
    await onCi(sibling.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${first}`, [flaky]);
    assert.equal((await health.health(contract.id)).verified.state, "failing", "a flake still records red");
    assert.deepEqual(await open(), [], "CI's role parks nothing itself");
    await health.tellUntold(from);
    const [investigation, ...extra] = await open();
    assert.deepEqual(extra, [], "the first flake of a test parks one investigation, however many contracts its test fails");
    const { fields } = investigation!;
    for (const said of [flaky, first, "fix the test", "question"]) assert.ok(`${fields.title} ${fields.objective} ${fields.body}`.includes(said), `the investigation says ${said}`);
    assert.ok(fields.links?.includes(contract.id), "it links the contract the flake turned red");
    const arc = await records.get(fields.arc);
    assert.deepEqual((arc?.fields as { stories?: string[] }).stories, [story.id], "on the test's own arc, under its story");
    assert.ok((await records.list("fyi")).some(({ fields: fyi }) => fyi.about === contract.id && fyi.what.includes(investigation!.id)), "the red FYI names the investigation");

    await onCi(contract.id, "passing", `1/1 tests passed, at commit ${first}`);
    await later();
    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out again, at commit ${second}`, [flaky]);
    await health.tellUntold(from);
    await health.tellUntold(from);
    const [same, ...more] = await open();
    assert.deepEqual(more, [], "a second flake of the same test parks no second investigation");
    assert.equal(same!.id, investigation!.id);
    const body = same!.fields.body;
    assert.ok(body.includes(second) && body.includes("timed out again"), "the repeat is attached to it as evidence");
    assert.equal(body.split("\n").filter((line) => line.includes(second)).length, 1, "telling again attaches it once");

    await onCi(sibling.id, "passing", `1/1 tests passed, at commit ${second}`);
    await later();
    await onCi(sibling.id, "failing", `0/1 tests passed; first failure: a real break, at commit ${second}`);
    await health.tellUntold(from);
    assert.deepEqual((await open()).map(({ id }) => id), [investigation!.id], "a red no passing run of its commit passed parks no investigation");

    await flight.closeIncrement(investigation!.id, { disposition: "withdrawn", note: "the test was fixed" });
    await onCi(contract.id, "passing", `1/1 tests passed, at commit ${second}`);
    await later();
    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${"c".repeat(40)}`, [flaky]);
    await health.tellUntold(from);
    const [next, ...others] = await open();
    assert.deepEqual(others, []);
    assert.notEqual(next!.id, investigation!.id, "once its investigation is closed, a new flake parks a new one");
    assert.equal(next!.fields.arc, fields.arc, "on the same test's arc");

    const elsewhere = { test: flaky, story: story.id, seen: "PR #9 at abc1234", evidence: "PR #9 at abc1234: retried as random", found: "The watcher retried PR #9 for it", by: "the watcher" };
    assert.equal(await health.investigateFlake(elsewhere), next!.id);
    assert.equal(await health.investigateFlake(elsewhere), next!.id);
    const [held] = await open();
    assert.equal(held!.fields.body.split("\n").filter((line) => line.includes("PR #9 at abc1234")).length, 1, "its evidence is added once");
    const fresh = await health.investigateFlake({ ...elsewhere, test: "a test own health never saw flake", contract: contract.id });
    const parked = (await open()).find(({ id }) => id === fresh)!;
    assert.ok(parked.fields.body.includes("the watcher") && parked.fields.links?.includes(contract.id), "a test first found elsewhere parks its investigation, saying who parked it");
    assert.notEqual(parked.fields.arc, fields.arc, "on that test's own arc");
  });

  contract("5.34", "a flake whose verdict predates the landed close of its test's investigation parks nothing and adds no evidence when told again; a flake verdict after that close parks a new investigation on the same arc", async ({ work, flight, records }) => {
    const health = new HealthRecord(records, work, flight);
    const ci = new HealthRecord(onlyHealth(records), work);
    const onCi = (id: string, state: "passing" | "failing", note: string, flaky?: string[]) =>
      ci.recordVerified(id, state, { by: "storytree test run on CI", source: "ci", note, ...(flaky === undefined ? {} : { flaky }) }).catch((error: { code?: string }) => {
        if (error.code !== "42501") throw error;
      });
    const { contract } = await smallPlan(work);
    const flaky = "email form › 1.1 rejects a bad email";
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    const third = "c".repeat(40);
    const from = new Date().toISOString();
    const open = async () => (await records.list("increment")).filter(({ fields }) => fields.status !== "closed");
    const increments = async () => (await records.list("increment")).map(({ id, updatedAt, fields }) => ({ id, updatedAt, fields })).sort((a, b) => a.id.localeCompare(b.id));

    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${first}`, [flaky]);
    await health.tellUntold(from);
    const [investigation] = await open();
    await onCi(contract.id, "passing", `1/1 tests passed, at commit ${first}`);
    await later();
    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${second}`, [flaky]);
    await later();
    await flight.closeIncrement(investigation!.id, { disposition: "landed", pr: "1055" });
    const closed = await increments();

    await health.tellUntold(from);
    assert.deepEqual(await open(), [], "a flake whose verdict predates the landed close parks no investigation, told again or told late");
    assert.deepEqual(await increments(), closed, "and adds its evidence to no increment");

    await later();
    await onCi(contract.id, "passing", `1/1 tests passed, at commit ${second}`);
    await later();
    await onCi(contract.id, "failing", `0/1 tests passed; first failure: timed out, at commit ${third}`, [flaky]);
    await health.tellUntold(from);
    const [next, ...others] = await open();
    assert.deepEqual(others, [], "one investigation for the flake after the close");
    assert.notEqual(next!.id, investigation!.id);
    assert.equal(next!.fields.arc, investigation!.fields.arc, "a flake verdict after the landed close parks a new investigation on the same test's arc");
    const body = next!.fields.body;
    assert.ok(body.includes(third), "its evidence is the flake after the close");
    assert.ok(!body.includes(first) && !body.includes(second), "and no flake that predates the close");
  });

  contract("5.35", "a parent capability's health in the annotated tree is the worst of its own contracts and every capability inside it, at any depth; a child's own health is not changed by its parent", async ({ health, work }) => {
    const story = await work.addStory({ title: "Host keeps running" });
    const watch = await work.addCapability({ title: "Watching the host", story: story.id });
    const restart = await work.addCapability({ title: "Restarting it", story: story.id });
    const backoff = await work.addCapability({ title: "Backing off", story: story.id });
    const sees = await work.addContract({ title: "Sees the host stop", capability: watch.id });
    const restarts = await work.addContract({ title: "Restarts it", capability: restart.id });
    const waits = await work.addContract({ title: "Waits longer each time", capability: backoff.id });
    for (const built of [watch, restart, backoff]) await work.setProposed(built.id, false);
    const record = async (contractId: string, state: "passing" | "failing") => {
      await health.reportHealth(contractId, state);
      await health.recordVerified(contractId, state);
    };
    const parents = new Map([[restart.id, watch.id], [backoff.id, restart.id]]);
    const read = async () => {
      const flat = await work.projectTree();
      const tree: ProjectTree = { ...flat, stories: flat.stories.map((each) => ({ ...each, capabilities: each.capabilities.map((node) => (parents.has(node.id) ? { ...node, parent: parents.get(node.id)! } : node)) })) };
      const capabilities = (await health.annotate(tree)).stories[0]!.capabilities;
      return [watch, restart, backoff].map(({ id }) => {
        const found = capabilities.find((capability) => capability.id === id)!;
        return { reported: found.health.reported.state, verified: found.health.verified.state, status: found.status };
      });
    };

    await record(sees.id, "passing");
    await record(restarts.id, "passing");
    await record(waits.id, "failing");
    assert.deepEqual(await read(), [
      { reported: "failing", verified: "failing", status: "unhealthy" },
      { reported: "failing", verified: "failing", status: "unhealthy" },
      { reported: "failing", verified: "failing", status: "unhealthy" },
    ], "a grandchild failing fails its parent and its grandparent, whose own contracts pass");

    await record(waits.id, "passing");
    await record(sees.id, "failing");
    assert.deepEqual(await read(), [
      { reported: "failing", verified: "failing", status: "unhealthy" },
      { reported: "passing", verified: "passing", status: "healthy" },
      { reported: "passing", verified: "passing", status: "healthy" },
    ], "a parent's own contract failing leaves the capabilities inside it as their own contracts read");

    await record(sees.id, "passing");
    assert.deepEqual(await read(), [
      { reported: "passing", verified: "passing", status: "healthy" },
      { reported: "passing", verified: "passing", status: "healthy" },
      { reported: "passing", verified: "passing", status: "healthy" },
    ], "every contract passing, every capability healthy");
  });

  contract("5.36", "a parent capability red only from a capability inside it gives its why as failing inside that capability, naming it and its failing contracts; a parent whose own contract fails keeps its own why", async ({ health, work }) => {
    const story = await work.addStory({ title: "Host keeps running" });
    const watch = await work.addCapability({ title: "Watching the host", story: story.id });
    const restart = await work.addCapability({ title: "Restarting it", story: story.id });
    const backoff = await work.addCapability({ title: "Backing off", story: story.id });
    const sees = await work.addContract({ title: "Sees the host stop", capability: watch.id });
    const restarts = await work.addContract({ title: "Restarts it", capability: restart.id });
    const waits = await work.addContract({ title: "Waits longer each time", capability: backoff.id });
    const caps = await work.addContract({ title: "Caps the wait", capability: backoff.id });
    for (const built of [watch, restart, backoff]) await work.setProposed(built.id, false);
    const record = async (contractId: string, state: "passing" | "failing") => {
      await health.reportHealth(contractId, state);
      await health.recordVerified(contractId, state);
    };
    const parents = new Map([[restart.id, watch.id], [backoff.id, restart.id]]);
    const parentOf = async () => {
      const flat = await work.projectTree();
      const tree: ProjectTree = { ...flat, stories: flat.stories.map((each) => ({ ...each, capabilities: each.capabilities.map((node) => (parents.has(node.id) ? { ...node, parent: parents.get(node.id)! } : node)) })) };
      return (await health.annotate(tree)).stories[0]!.capabilities.find((capability) => capability.id === watch.id)!;
    };
    const withoutSince = (why: object | undefined) => Object.fromEntries(Object.entries(why ?? {}).filter(([key]) => key !== "since"));

    for (const one of [sees, restarts, caps]) await record(one.id, "passing");
    await record(waits.id, "failing");
    const insideOnly = await parentOf();
    assert.deepEqual(withoutSince(insideOnly.why), { reason: "failing", mover: "agent", contracts: [waits.id], inside: [{ capability: backoff.id, title: "Backing off" }] }, "the why names the grandchild whose own contract fails and that contract, not the capability between them");
    assert.equal(wordAndWhy(insideOnly), "unhealthy — failing inside Backing off, the agent's to move");

    await record(sees.id, "failing");
    const ownFailing = await parentOf();
    assert.deepEqual(withoutSince(ownFailing.why), { reason: "failing", mover: "agent", contracts: [sees.id] }, "its own contract failing gives its own why, with nothing inside");
  });
}

function onlyHealth(records: SchemaRecords): SchemaRecords {
  const refused = (): Promise<never> => Promise.reject(Object.assign(new Error('new row violates row-level security policy for table "record_event"'), { code: "42501" }));
  return new Proxy(records, {
    get(target, key) {
      if (key === "create") return (type: RecordType, ...rest: unknown[]) => (type === "health" ? (target.create as (...args: unknown[]) => unknown)(type, ...rest) : refused());
      if (key === "edit") return refused;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function later(): Promise<void> {
  const now = Date.now();
  await waitUntil(() => Date.now() > now, 5_000, "the clock to move on");
}

const OBSERVED = { by: "observability-as-proof", reason: "Only the laptop and the Mint box doing real work show it.", freshness: "2d", watcher: "the Mint box's activity watcher" } as const;

async function smallPlan(work: WorkModel): Promise<{
  story: SchemaRecord<"story">;
  capability: SchemaRecord<"capability">;
  contract: SchemaRecord<"contract">;
  sibling: SchemaRecord<"contract">;
}> {
  const story = await work.addStory({ title: "Visitor can sign up" });
  const capability = await work.addCapability({ title: "Email form", story: story.id });
  const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
  const sibling = await work.addContract({ title: "Accepts a plus address", capability: capability.id });
  return { story, capability, contract, sibling };
}

const STATE_OF: Readonly<Record<string, string>> = { P: "passing", F: "failing", "-": "not-checked" };

function withHealth(tree: ProjectTree, healthOf: (id: string) => NodeHealth): AnnotatedTree {
  return {
    stories: tree.stories.map(({ edges, ...story }) => ({
      ...story,
      ...(edges === undefined ? {} : { edges: edges.map((edge) => ({ ...edge, contracts: edge.contracts.map((contract) => ({ ...contract, health: healthOf(contract.id) })) })) }),
      health: healthOf(story.id),
      capabilities: story.capabilities.map((capability) => {
        const why = capabilityWhy(capability.proposed, capability.contracts.map((contract) => ({ id: contract.id, verified: healthOf(contract.id).verified })));
        return {
          ...capability,
          health: healthOf(capability.id),
          contracts: capability.contracts.map((contract) => ({ ...contract, health: healthOf(contract.id) })),
          status: capabilityStatus(capability.proposed, capability.contracts.map((contract) => healthOf(contract.id).verified.state)),
          ...(why === undefined ? {} : { why }),
        };
      }),
    })),
    arcs: tree.arcs,
  };
}

function healthInTree(tree: AnnotatedTree): Map<string, NodeHealth> {
  const found = new Map<string, NodeHealth>();
  for (const story of tree.stories) {
    found.set(story.id, story.health);
    for (const capability of story.capabilities) {
      found.set(capability.id, capability.health);
      for (const contract of capability.contracts) found.set(contract.id, contract.health);
    }
  }
  return found;
}

function countNodes(tree: ProjectTree): number {
  return tree.stories.reduce(
    (count, story) => count + 1 + story.capabilities.reduce((sum, capability) => sum + 1 + capability.contracts.length, 0),
    0,
  );
}

async function healthRecordsOf(transactions: Transactions, nodeId: string): Promise<RecordEnvelope[]> {
  return (await transactions.list("health")).filter((record) => record.fields.node === nodeId);
}

function columnOf(entry: HealthEntry): Record<string, unknown> {
  const { column: _column, ...rest } = entry;
  return rest;
}

function healthFields(nodeId: string, entry: HealthEntry): Record<string, unknown> {
  const { at: _at, ...rest } = entry;
  return { node: nodeId, ...rest };
}

function byColumn(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(a.column).localeCompare(String(b.column));
}

function byWriter(a: HealthEntry, b: HealthEntry): number {
  return String(a.by).localeCompare(String(b.by));
}

function assertTimestamp(value: unknown, from: number, to: number): void {
  assert.equal(typeof value, "string", "a timestamp is a string");
  assert.equal(new Date(value as string).toISOString(), value, `${String(value)} is an ISO 8601 timestamp`);
  const time = Date.parse(value as string);
  assert.ok(time >= from && time <= to, `${String(value)} is between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}`);
}

async function warmUp(transactions: Transactions): Promise<void> {
  await Promise.all(Array.from({ length: 8 }, () => transactions.get("warm-up")));
}

function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

function untyped(value: unknown): never {
  return value as never;
}

function missingNode(id: string, found?: RecordType): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field: "node", id, expected: "contract", found },
      error.message,
    );
    for (const part of [JSON.stringify("node"), JSON.stringify(id), ...(found === undefined ? [] : [found])]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    if (found === "story" || found === "capability") {
      assert.match(error.message, new RegExp(`${found}'s health is rolled up from its contracts`), error.message);
    } else {
      assert.doesNotMatch(error.message, /rolled up/, error.message);
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

test("5.6 the word of a capability, from its flag and its contracts' verified states", () => {
  assert.equal(capabilityStatus(true, ["passing"]), "proposed");
  assert.equal(capabilityStatus(false, ["passing", "passing"]), "healthy");
  assert.equal(capabilityStatus(false, ["passing", "failing", "not-checked"]), "unhealthy");
  assert.equal(capabilityStatus(false, ["passing", "not-checked"]), "untested");
  assert.equal(capabilityStatus(false, []), "untested", "no contracts, nothing verified");
});

test("5.8 one reason per capability that is not healthy, the agent's work ranked before the owner's", () => {
  const c = (id: string, verified: HealthColumn) => ({ id, verified });
  const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const passing = { state: "passing", at: at(1) } as const;
  assert.deepEqual(capabilityWhy(true, [c("a", passing)]), { reason: "not built", mover: "agent", contracts: [] }, "proposed, whatever its health");
  assert.equal(capabilityWhy(false, [c("a", passing)]), undefined, "healthy");
  const failing = c("f", { state: "failing", at: at(20) });
  const notRerun = c("r", { state: "not-checked", at: at(28), was: { state: "failing", at: at(27) } });
  const otherSkip = c("o", { state: "not-checked", at: at(26), skip: "other" });
  const noTest = c("n", { state: "not-checked" });
  const platform = c("p", { state: "not-checked", at: at(25), skip: "platform:win32" });
  const owner = c("w", { state: "not-checked", at: at(24), skip: "owner", was: { state: "failing", at: at(3) } });
  const all = [owner, platform, noTest, otherSkip, notRerun, failing];
  assert.deepEqual(capabilityWhy(false, all), { reason: "failing", mover: "agent", contracts: ["f"], since: at(20) });
  assert.deepEqual(capabilityWhy(false, all.slice(0, 5)), { reason: "not re-run", mover: "agent", contracts: ["o", "r"], since: at(26) }, "an other-kind skip, or an earlier verdict not reproduced");
  assert.deepEqual(capabilityWhy(false, all.slice(0, 3)), { reason: "no test names it", mover: "agent", contracts: ["n"] }, "never recorded: no time");
  assert.deepEqual(capabilityWhy(false, all.slice(0, 2)), { reason: "out of CI's reach", mover: "agent", contracts: ["p"], since: at(25) });
  assert.deepEqual(capabilityWhy(false, [owner, c("a", passing)]), { reason: "needs owner", mover: "owner", contracts: ["w"], since: at(24) }, "an owner skip needs the owner, whatever it last saw");
  assert.deepEqual(capabilityWhy(false, []), { reason: "no test names it", mover: "agent", contracts: [] }, "no contracts");
  const judged = { ...c("u", { state: "not-checked" }), proof: "agentic-user-acceptance-testing" as const };
  assert.deepEqual(capabilityWhy(false, [owner, platform, judged]), { reason: "acceptance test not run", mover: "agent", contracts: ["u"] });
  assert.deepEqual(capabilityWhy(false, [judged, noTest]), { reason: "no test names it", mover: "agent", contracts: ["n"] }, "a test to write ranks first");
  assert.deepEqual(capabilityWhy(false, [{ ...judged, verified: { state: "failing", at: at(9) } }]), { reason: "failing", mover: "agent", contracts: ["u"], since: at(9) }, "a verdict it has speaks for itself");
});

test("5.29 [postgres] recordVerifiedAll writes a story's verdicts in as many round trips to the server for thirty contracts as for two", async () => {
  const name = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const { work, health, pool } = await storytree.openProject(name);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contracts = [];
    for (let n = 0; n < 32; n++) contracts.push((await work.addContract({ title: `Contract ${n}`, capability: capability.id })).id);
    let count = 0;
    const counted = new WeakSet<object>();
    const counting = <T extends { query: (...args: never[]) => unknown }>(client: T): T => {
      if (counted.has(client)) return client;
      counted.add(client);
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      client.query = ((...args: unknown[]) => (count++, query(...args))) as T["query"];
      return client;
    };
    type Taken = { query: (...args: never[]) => unknown };
    const connect = pool.connect.bind(pool) as unknown as (done?: (error: unknown, client: Taken | undefined, release: unknown) => void) => Promise<Taken> | undefined;
    pool.connect = ((done?: (error: unknown, client: Taken | undefined, release: unknown) => void) =>
      done === undefined ? connect()!.then(counting) : connect((error, client, release) => done(error, client === undefined ? client : counting(client), release))) as unknown as typeof pool.connect;
    const queries = async (ids: readonly string[]): Promise<number> => {
      count = 0;
      await health.recordVerifiedAll(ids.map((contractId) => ({ contractId, state: "passing" as const, options: { by: "storytree test run on CI", source: "ci" as const } })));
      return count;
    };
    const two = await queries(contracts.slice(0, 2));
    const thirty = await queries(contracts.slice(2));
    assert.ok(two > 0, "control: the queries are counted");
    assert.equal(thirty, two, `thirty contracts take ${thirty} queries, two ${two}`);
    assert.ok(two <= 10, `a few round trips, not a few per contract: ${two}`);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases([`storytree_${name}`]);
    }
  }
});
