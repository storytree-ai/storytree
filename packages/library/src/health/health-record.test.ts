/**
 * Capability 5 · Health record: one test per contract 5.1-5.5 in the library story, each run on
 * BOTH backends, as capabilities 2-4 and 6 are:
 *
 * - memory: a HealthRecord over SchemaRecords and a WorkModel over a fresh MemoryTransactions;
 * - postgres: the `health` of a fresh project, opened through capability 1 on the server
 *   `pnpm test` provides and named with uniqueProjectName(). Its database is dropped afterwards,
 *   pass or fail. Other test files share that server, so a test only ever reads its own project.
 *
 * The plan that health rolls up over is built with capability 4's WorkModel. Whether anything was
 * written is judged one layer down, through the same project's Transactions: every change appends
 * a history entry (capability 2), so an unchanged history means nothing was written. What the
 * spec fixes is restated here rather than taken from the code: the three states, the two columns,
 * and the roll-up rule.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { NewerSchemaError, SchemaError, SchemaRecords, type RecordType, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { WorkModel, type ProjectTree } from "../work/index.js";
import { HealthRecord, type AnnotatedTree, type HealthEntry, type NodeHealth } from "./index.js";

/** A fresh, empty library: the health record under test, and the layers it runs over. */
interface Library {
  readonly health: HealthRecord;
  readonly work: WorkModel;
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
    return { health: new HealthRecord(records, work), work, records, transactions, cleanup: async () => {} };
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
      // The project handle's own health record and layers: health as later stories reach it.
      const project = await storytree.openProject(name);
      const { health, work, records, transactions } = project;
      return { health, work, records, transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

/** The health of a node with no entries: not-checked in both columns, and nothing else. */
const UNCHECKED: NodeHealth = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };

/** An id of the right shape that names no record. */
const NO_CONTRACT = "contract_000000000000";

/** Text the library cannot store (capability 3 refuses it): a NUL, and a lone UTF-16 surrogate. */
const UNSTORABLE = ["contract_\u0000", "contract_\uD83C"];

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

  contract("5.1", "a node with no health entries reads reported: not-checked, verified: not-checked", async ({ health, work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    // A story with no capabilities, and a capability with no contracts: nothing to roll up.
    const bare = await work.addStory({ title: "Visitor can leave" });
    const empty = await work.addCapability({ title: "Password rules", story: story.id });
    // An arc, which is part of the tree but has no health.
    const arc = await work.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const before = await transactions.history();

    for (const node of [story, capability, contract, bare, empty]) {
      assert.deepEqual(await health.health(node.id), UNCHECKED, `the ${node.type} "${node.fields.title}"`);
    }
    assert.deepEqual(await health.healthHistory(contract.id), [], "a contract with no entries has no history");

    // The annotated tree is projectTree()'s tree with health added to every story, capability and
    // contract, every one of them reading not-checked in both columns, and its arcs as they were.
    // The tree it is given is left as it was.
    const tree = await work.projectTree();
    const asGiven = structuredClone(tree);
    assert.deepEqual(await health.annotate(tree), withHealth(tree, () => UNCHECKED));
    assert.deepEqual(tree, asGiven, "annotate leaves the tree it is given unchanged");
    assert.equal(countNodes(tree), 5, "control: the tree holds all five nodes");
    assert.deepEqual(tree.arcs, [{ id: arc.id, title: "Launch v1", stories: [story.id] }], "control: and the arc");
    // Given no tree, it annotates the plan as it is now.
    assert.deepEqual(await health.annotate(), withHealth(tree, () => UNCHECKED));

    assert.deepEqual(await transactions.history(), before, "reading health writes nothing");

    // An id naming no live story, capability or contract has no entries either, and reads the same:
    // never passing, and never an error.
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

    // Stored as ONE health record, for this contract's reported column (seen one layer down).
    const stored = await healthRecordsOf(transactions, contract.id);
    assert.equal(stored.length, 1, "one health record");
    const record = at(stored, 0);
    assert.deepEqual(record.fields, { node: contract.id, column: "reported", state: "passing", by: "agent", note: "3 of 3 cases pass" });
    assert.equal(record.version, 1);

    // The agent reports again: the newest entry is what the column reads. Each entry stands alone
    // (the earlier by and note are not carried over), and it is a save of that same record.
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

    // A column is only ever passing, failing or not-checked: any other state is refused, naming the
    // state, and so is a who or a note that is not text the library can store. None writes anything.
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

    // Two health records now, one per column.
    assert.deepEqual(
      (await healthRecordsOf(transactions, contract.id)).map((record) => record.fields).sort(byColumn),
      [
        { node: contract.id, column: "reported", state: "passing", by: "agent" },
        { node: contract.id, column: "verified", state: "failing", by: "storytree", note: "1 of 3 cases fail" },
      ],
    );

    // Each column moves on its own: a new report leaves the verification as it was, and a new
    // verification leaves the report.
    const rereported = await health.reportHealth(contract.id, "failing", { by: "agent", note: "found the bug" });
    const newReport = { state: "failing", by: "agent", at: rereported.at, note: "found the bug" };
    assert.deepEqual(await health.health(contract.id), { reported: newReport, verified: sideBySide.verified });
    const reverified = await health.recordVerified(contract.id, "passing", { by: "storytree" });
    assert.deepEqual(await health.health(contract.id), {
      reported: newReport,
      verified: { state: "passing", by: "storytree", at: reverified.at },
    });
    assert.equal((await healthRecordsOf(transactions, contract.id)).length, 2, "still one record per column");

    // Verified before anything was reported: the reported column stays not-checked.
    const seen = await health.recordVerified(sibling.id, "passing", { by: "storytree" });
    assert.deepEqual(await health.health(sibling.id), {
      reported: { state: "not-checked" },
      verified: { state: "passing", by: "storytree", at: seen.at },
    });
  });

  contract("5.4", "a capability or story's health is rolled up from its contracts, column by column: failing if any is failing, passing only if there is one and all are passing, otherwise not-checked", async ({ health, work, records }) => {
    // Story S holds capability A (contracts A1, A2), capability B (contract B1) and capability E,
    // which has no contracts. Story T has no capabilities. Story U holds capability F, with no contracts.
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

    /**
     * Check every node's health against `expected`: two letters per node, its reported and its
     * verified state (P passing, F failing, - not-checked). health(id) and the annotated tree must
     * both say so. A rolled-up column holds its state and nothing else: no one wrote it.
     */
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

    // The plan as it is now: a new, never-checked contract holds its capability and story back
    // until it is retired; a capability moved to another story takes its contracts' health along.
    const B2 = await work.addContract({ title: "The link works once", capability: B.id });
    await expectHealth("B2 added, never checked", { S: "--", A: "PP", A1: "PP", A2: "PP", B: "--", B1: "PP", E: "--", T: "--", U: "--", F: "--" });
    await records.retire(B2.id, "covered by B1");
    await expectHealth("B2 retired", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "PP", B1: "PP", E: "--", T: "--", U: "--", F: "--" });
    await work.editCapability(B.id, { story: U.id });
    await expectHealth("B moved to U", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "PP", B1: "PP", E: "--", T: "--", U: "PP", F: "--" });
    await health.reportHealth(B1.id, "failing");
    await expectHealth("B1 reported failing, now under U", { S: "PP", A: "PP", A1: "PP", A2: "PP", B: "FP", B1: "FP", E: "--", T: "--", U: "FP", F: "--" });

    // A capability whose story has been retired is no longer in the tree, but it is still a
    // capability: its health is still rolled up from its contracts. The retired story, like any
    // record that is gone, reads not-checked.
    await records.retire(U.id, "merged into sign up");
    const inTree = healthInTree(await health.annotate(await work.projectTree()));
    for (const node of [U, B, B1, F]) assert.equal(inTree.has(node.id), false, `${node.fields.title} has left the tree`);
    assert.deepEqual(await health.health(U.id), UNCHECKED);
    assert.deepEqual(await health.health(B.id), { reported: { state: "failing" }, verified: { state: "passing" } });
    assert.deepEqual(await health.health(F.id), UNCHECKED);
    assert.deepEqual(await health.health(S.id), { reported: { state: "passing" }, verified: { state: "passing" } });
  });

  contract("5.5", "every health entry is kept in history with who wrote it and when, and an entry for a node that does not exist is refused", async ({ health, work, records, transactions }) => {
    const { story, capability, contract, sibling } = await smallPlan(work);

    // Entries in both columns, interleaved, with and without a who and a note; one on another contract.
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

    // healthHistory holds every entry of both columns, in the order written, each with its column,
    // its state, who wrote it and when, and its note.
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
    // Each column reads its latest entry.
    assert.deepEqual(await health.health(contract.id), { reported: columnOf(at(written, 4)), verified: columnOf(at(written, 5)) });

    // The library's own history (capability 2) keeps the same entries: each one a change to a health
    // record, made by the entry's writer at the entry's moment. Each column is one record, saved
    // once per entry.
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

    // Entries racing each other are all kept, each once, and the column reads whichever was written last.
    await warmUp(transactions);
    const racers = await Promise.all(
      Array.from({ length: 8 }, (_, n) => health.reportHealth(contract.id, "passing", { by: `racer-${n}` })),
    );
    const everything = await health.healthHistory(contract.id);
    assert.deepEqual(everything.slice(0, history.length), history, "the earlier entries are untouched");
    const raced = everything.slice(history.length);
    assert.deepEqual([...raced].sort(byWriter), [...racers].sort(byWriter), "every racing entry, once");
    assert.deepEqual((await health.health(contract.id)).reported, columnOf(at(raced, raced.length - 1)));

    // A column's record retired by hand (capability 2's retire, which the library API offers): the
    // column has no entry now, so it reads not-checked; the retirement is not an entry, and the
    // entries before it stay in the history; the next entry starts the column again.
    const reportedRecord = at((await healthRecordsOf(transactions, contract.id)).filter((record) => record.fields.column === "reported"), 0);
    await records.retire(reportedRecord.id, "cleared by hand");
    assert.deepEqual(await health.health(contract.id), { reported: { state: "not-checked" }, verified: columnOf(at(written, 5)) });
    assert.deepEqual(await health.healthHistory(contract.id), everything);
    const fresh = await health.reportHealth(contract.id, "failing", { by: "agent-c" });
    assert.deepEqual(await health.healthHistory(contract.id), [...everything, fresh]);
    assert.deepEqual((await health.health(contract.id)).reported, columnOf(fresh));

    // Refused: an entry for a node that does not exist (missing, retired, a near miss, an id the
    // library cannot store), or for a record that is not a contract. For a story or a capability the
    // error says why: their health is rolled up from their contracts. Nothing is written.
    const arc = await work.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
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

    // A retired contract keeps its entries in its history. Like any record that is gone it reads
    // not-checked, and a new entry for it is refused.
    await records.retire(contract.id, "replaced by a stricter contract");
    assert.deepEqual(await health.healthHistory(contract.id), [...everything, fresh]);
    assert.deepEqual(await health.health(contract.id), UNCHECKED);
    const afterRetiring = await transactions.history();
    await assert.rejects(health.reportHealth(contract.id, "passing"), missingNode(contract.id));
    await assert.rejects(health.recordVerified(contract.id, "passing"), missingNode(contract.id));
    assert.deepEqual(await transactions.history(), afterRetiring, "nothing was written");

    // An entry written on a newer schema version than this code knows (as a later storytree could
    // write one) is refused when read, as capability 3 refuses reading any such record: in the
    // column, and in the history.
    const siblingRecord = at(await healthRecordsOf(transactions, sibling.id), 0);
    await transactions.save({ id: siblingRecord.id, type: "health", version: 2, fields: { ...siblingRecord.fields, state: "failing" } });
    await assert.rejects(health.health(sibling.id), NewerSchemaError);
    await assert.rejects(health.healthHistory(sibling.id), NewerSchemaError);
  });
}

/** One story › one capability › two contracts: the plan most of these tests write health on. */
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

/** What each letter of 5.4's table stands for. */
const STATE_OF: Readonly<Record<string, string>> = { P: "passing", F: "failing", "-": "not-checked" };

/**
 * `tree` with `health` added to every story, capability and contract node, as `healthOf` gives it:
 * the shape the spec asks annotate for, restated here.
 */
function withHealth(tree: ProjectTree, healthOf: (id: string) => NodeHealth): AnnotatedTree {
  return {
    stories: tree.stories.map((story) => ({
      ...story,
      health: healthOf(story.id),
      capabilities: story.capabilities.map((capability) => ({
        ...capability,
        health: healthOf(capability.id),
        contracts: capability.contracts.map((contract) => ({ ...contract, health: healthOf(contract.id) })),
      })),
    })),
    arcs: tree.arcs,
  };
}

/** Every node of an annotated tree, by id, with the health it shows. */
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

/** How many stories, capabilities and contracts a tree holds. */
function countNodes(tree: ProjectTree): number {
  return tree.stories.reduce(
    (count, story) => count + 1 + story.capabilities.reduce((sum, capability) => sum + 1 + capability.contracts.length, 0),
    0,
  );
}

/** The live health records about `nodeId`, seen one layer down. */
async function healthRecordsOf(transactions: Transactions, nodeId: string): Promise<RecordEnvelope[]> {
  return (await transactions.list("health")).filter((record) => record.fields.node === nodeId);
}

/** A contract's column as an entry leaves it: the entry without its column name. */
function columnOf(entry: HealthEntry): Record<string, unknown> {
  const { column: _column, ...rest } = entry;
  return rest;
}

/** The fields of the health record an entry about `nodeId` is stored as. */
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

/** Assert that `value` is an ISO 8601 UTC timestamp no earlier than `from` and no later than `to` (both ms). */
function assertTimestamp(value: unknown, from: number, to: number): void {
  assert.equal(typeof value, "string", "a timestamp is a string");
  assert.equal(new Date(value as string).toISOString(), value, `${String(value)} is an ISO 8601 timestamp`);
  const time = Date.parse(value as string);
  assert.ok(time >= from && time <= to, `${String(value)} is between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}`);
}

/** Start several reads at once, so a pooled backend has a connection ready for every racer that follows. */
async function warmUp(transactions: Transactions): Promise<void> {
  await Promise.all(Array.from({ length: 8 }, () => transactions.get("warm-up")));
}

/** The item at `index`, which the test has made sure is there. */
function at<T>(items: readonly T[], index: number): T {
  return items[index] ?? assert.fail(`there is no item ${index}`);
}

/** A value the compiler would refuse, sent the way a JavaScript caller or an agent could send it. */
function untyped(value: unknown): never {
  return value as never;
}

/**
 * An assert.rejects check: a MissingReferenceError for field `node` holding `id`, which must name a
 * live contract. `found` is the type of the record `id` names when it names one of another type.
 * For a story or a capability the message also says that their health is rolled up from their
 * contracts; for anything else it does not.
 */
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

/** An assert.rejects check: a SchemaError (capability 3) for `type` whose fields at fault are exactly `fields`. */
function schemaError(type: RecordType, fields: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
    assert.equal(error.type, type, error.message);
    assert.deepEqual([...error.fields].sort(), [...fields].sort(), `the fields at fault: ${error.message}`);
    return true;
  };
}
