/**
 * Capability 4 · Work model: one test per contract of 4 but its pending plan changes (pending-changes.test.ts; 4.9 is in library-api.test.ts) in the library story, each run on
 * BOTH backends, as capabilities 2 and 3 are:
 *
 * - memory: a WorkModel over SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `work` of a fresh project, opened through capability 1 on the server `pnpm test`
 *   provides and named with uniqueProjectName(). Its database is dropped afterwards, pass or fail.
 *   Other test files share that server, so a test only ever reads its own project.
 *
 * Whether anything was written is judged one layer down, through the same project's
 * Transactions: every change appends a history entry (capability 2), so an unchanged history
 * means nothing was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { waitUntil } from "@storytree/test-waits";

import { connect } from "../project/index.js";
import { DependencyLoopError, MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type RecordType, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { ANCHOR_ID, anchorGaps, WorkModel, type PluginPlan } from "./index.js";

/** A fresh, empty library: the work model under test, and the layers it runs over. */
interface Library {
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
    return { work: new WorkModel(records), records, transactions, cleanup: async () => {} };
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
      // The project handle's own work model and layers: the work model as later stories reach it.
      const project = await storytree.openProject(name);
      return { work: project.work, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

/** An id of the right shape that names no record. */
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

  contract("4.1", "a story, a capability under it and a contract under that come back from projectTree nested: story › capability › contract", async ({ work, records, transactions }) => {
    assert.deepEqual(await work.projectTree(), { stories: [], arcs: [] }, "an empty plan");

    const story = await work.addStory({ title: "Visitor can sign up", description: "By email, with a confirmation link" });
    await assertCreated(transactions, story, "story", { title: "Visitor can sign up", description: "By email, with a confirmation link" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    await assertCreated(transactions, capability, "capability", { title: "1 · Email form", story: story.id, proposed: true });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    await assertCreated(transactions, contract, "contract", { title: "1.1 · Rejects a bad email", capability: capability.id });

    const signUp = {
      id: story.id,
      title: "Visitor can sign up",
      description: "By email, with a confirmation link",
      capabilities: [
        { id: capability.id, title: "1 · Email form", dependsOn: [], proposed: true, contracts: [{ id: contract.id, title: "1.1 · Rejects a bad email" }] },
      ],
    };
    assert.deepEqual(
      await work.projectTree(),
      { stories: [signUp], arcs: [] },
      "the story holds its capability, which holds its contract; a description appears only where there is one",
    );

    // Every id is the library's own: an id in the input is refused as an unknown field, so no
    // caller can replace a record by naming it, and nothing is written.
    const before = await transactions.history();
    await assert.rejects(work.addStory(untyped({ id: story.id, title: "Replaced?" })), schemaError("story", ["id"]));
    await assert.rejects(
      work.addCapability(untyped({ id: capability.id, title: "Replaced?", story: story.id })),
      schemaError("capability", ["id"]),
    );
    await assert.rejects(
      work.addContract(untyped({ id: contract.id, title: "Replaced?", capability: capability.id })),
      schemaError("contract", ["id"]),
    );
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    await laterThan(contract);

    // A bigger plan. Every level holds several children, each created strictly after the one
    // before and under ids whose own order is not creation order, so the only order the tree can
    // show them in is creation order.
    const stories = await createInOrder(3, (n) => work.addStory({ title: `Story ${n}` }));
    const planned = at(stories, 0);
    const tried = at(stories, 1);
    const capabilities = await createInOrder(3, (n) => work.addCapability({ title: `Capability ${n}`, story: planned.id }));
    const first = at(capabilities, 0);
    const contracts = await createInOrder(3, (n) => work.addContract({ title: `Contract ${n}`, capability: first.id }));
    // Under the second story: a capability depending on two of the first story's, holding a
    // contract, each with a description.
    const link = await work.addCapability({
      title: "Confirmation link",
      story: tried.id,
      description: "Sent once the form is valid",
      dependsOn: [at(capabilities, 2).id, first.id],
    });
    await laterThan(link);
    const expiry = await work.addContract({ title: "The link expires", capability: link.id, description: "After 24 hours" });
    await laterThan(expiry);
    // A child added later to an earlier parent goes after that parent's older children.
    const late = await work.addCapability({ title: "Late capability", story: planned.id });
    // Records that are not part of the plan stay out of the tree.
    await records.create("definition", { term: "Delivery", meaning: "Not part of the plan", links: [planned.id] });
    await records.create("health", { node: expiry.id, column: "reported", state: "passing" });

    const leaf = (record: SchemaRecord<"capability">) => ({ id: record.id, title: record.fields.title, dependsOn: [], proposed: true, contracts: [] });
    const firstNode = {
      id: first.id,
      title: first.fields.title,
      dependsOn: [],
      proposed: true,
      contracts: contracts.map((record) => ({ id: record.id, title: record.fields.title })),
    };
    const linkNode = {
      id: link.id,
      title: link.fields.title,
      description: "Sent once the form is valid",
      dependsOn: [at(capabilities, 2).id, first.id],
      proposed: true,
      contracts: [{ id: expiry.id, title: expiry.fields.title, description: "After 24 hours" }],
    };
    const others = stories.slice(2).map((record) => ({ id: record.id, title: record.fields.title, capabilities: [] }));
    assert.deepEqual(
      await work.projectTree(),
      {
        stories: [
          signUp,
          { id: planned.id, title: "Story 0", capabilities: [firstNode, ...capabilities.slice(1).map(leaf), leaf(late)] },
          { id: tried.id, title: "Story 1", capabilities: [linkNode] },
          ...others,
        ],
        arcs: [],
      },
      "every child under its own parent, in creation order at every level",
    );

    // The tree is read from the records as they are now. An older capability moved to the second
    // story sits there before that story's newer one, and a retired contract is gone.
    const moved = at(capabilities, 1);
    await work.editCapability(moved.id, { story: tried.id });
    const dropped = at(contracts, 1);
    await records.retire(dropped.id, "covered by contract 0");
    assert.deepEqual(await work.projectTree(), {
      stories: [
        signUp,
        {
          id: planned.id,
          title: "Story 0",
          capabilities: [
            { ...firstNode, contracts: firstNode.contracts.filter((node) => node.id !== dropped.id) },
            ...capabilities.slice(2).map(leaf),
            leaf(late),
          ],
        },
        { id: tried.id, title: "Story 1", capabilities: [leaf(moved), linkNode] },
        ...others,
      ],
      arcs: [],
    });
  });

  contract("4.3", "a capability naming a missing or retired story is refused, as is a contract naming a missing capability", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const elsewhere = await work.addStory({ title: "Visitor can sign in" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    const arc = await records.create("arc", { title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
    const retiredStory = await work.addStory({ title: "Visitor can pay" });
    const retiredCapability = await work.addCapability({ title: "Card form", story: story.id });
    await records.retire(retiredStory.id, "out of scope");
    await records.retire(retiredCapability.id, "out of scope");
    const before = await transactions.history();

    const refused: [attempt: () => Promise<unknown>, field: string, id: string, found?: RecordType][] = [
      // A capability whose story is missing, retired, a near miss, or not a story at all...
      [() => work.addCapability({ title: "Email form", story: NO_STORY }), "story", NO_STORY],
      [() => work.addCapability({ title: "Email form", story: retiredStory.id }), "story", retiredStory.id],
      [() => work.addCapability({ title: "Email form", story: "" }), "story", ""],
      [() => work.addCapability({ title: "Email form", story: story.id.toUpperCase() }), "story", story.id.toUpperCase()],
      [() => work.addCapability({ title: "Email form", story: capability.id }), "story", capability.id, "capability"],
      [() => work.addCapability({ title: "Email form", story: arc.id }), "story", arc.id, "arc"],
      // ...and moving a capability onto such a story.
      [() => work.editCapability(capability.id, { story: NO_STORY }), "story", NO_STORY],
      [() => work.editCapability(capability.id, { story: retiredStory.id }), "story", retiredStory.id],
      [() => work.editCapability(capability.id, { title: "Renamed", story: contract.id }), "story", contract.id, "contract"],
      // A contract whose capability is missing, retired, or not a capability.
      [() => work.addContract({ title: "Rejects a bad email", capability: NO_CAPABILITY }), "capability", NO_CAPABILITY],
      [() => work.addContract({ title: "Rejects a bad email", capability: retiredCapability.id }), "capability", retiredCapability.id],
      [() => work.addContract({ title: "Rejects a bad email", capability: story.id }), "capability", story.id, "story"],
      [() => work.addContract({ title: "Rejects a bad email", capability: contract.id }), "capability", contract.id, "contract"],
    ];
    for (const [attempt, field, id, found] of refused) {
      await assert.rejects(attempt(), missingReference(field, id, found));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");

    // An id holding text the library cannot store is never looked up (Postgres cannot even be
    // asked for one): the write's own schema check refuses it, naming the field, on both backends.
    for (const bad of UNSTORABLE) {
      await assert.rejects(work.addCapability({ title: "Email form", story: bad }), schemaError("capability", ["story"]));
      await assert.rejects(work.editCapability(capability.id, { story: bad }), schemaError("capability", ["story"]));
      await assert.rejects(work.addContract({ title: "Rejects a bad email", capability: bad }), schemaError("contract", ["capability"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");

    // Editing something that is not a live capability edits nothing and returns null, as any edit
    // of a missing record does: a story, a contract or an arc is not changed through it.
    for (const id of [story.id, contract.id, arc.id, retiredCapability.id, NO_CAPABILITY, ...UNSTORABLE]) {
      assert.equal(await work.editCapability(id, { title: "Renamed" }), null, `editCapability(${JSON.stringify(id)})`);
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(story.id), story, "the story keeps its title");

    // Control: the same writes, naming live records of the right type, go through.
    const moved = await work.editCapability(capability.id, { story: elsewhere.id });
    assert.deepEqual(moved, { ...capability, fields: { title: "1 · Email form", story: elsewhere.id, proposed: true }, updatedAt: moved?.updatedAt });
    const second = await work.addCapability({ title: "Password rules", story: elsewhere.id });
    await assertCreated(transactions, second, "capability", { title: "2 · Password rules", story: elsewhere.id, proposed: true });
    const covered = await work.addContract({ title: "Refuses a short password", capability: second.id });
    await assertCreated(transactions, covered, "contract", { title: "2.1 · Refuses a short password", capability: second.id });
  });

  contract("4.4", "a capability depending on a capability that does not exist is refused", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const mailer = await work.addCapability({ title: "Mailer", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: form.id });
    const dropped = await work.addCapability({ title: "SMS sender", story: story.id });
    await records.retire(dropped.id, "email only, for now");
    const before = await transactions.history();

    const link = { title: "Confirmation link", story: story.id };
    const refused: [attempt: () => Promise<unknown>, id: string, found?: RecordType][] = [
      [() => work.addCapability({ ...link, dependsOn: [NO_CAPABILITY] }), NO_CAPABILITY],
      [() => work.addCapability({ ...link, dependsOn: [form.id, NO_CAPABILITY, mailer.id] }), NO_CAPABILITY],
      [() => work.addCapability({ ...link, dependsOn: [dropped.id] }), dropped.id],
      [() => work.addCapability({ ...link, dependsOn: [form.id, form.id.toUpperCase()] }), form.id.toUpperCase()],
      [() => work.addCapability({ ...link, dependsOn: [story.id] }), story.id, "story"],
      [() => work.addCapability({ ...link, dependsOn: [mailer.id, contract.id] }), contract.id, "contract"],
      [() => work.editCapability(form.id, { dependsOn: [NO_CAPABILITY] }), NO_CAPABILITY],
      [() => work.editCapability(form.id, { dependsOn: [mailer.id, dropped.id] }), dropped.id],
      [() => work.editCapability(form.id, { title: "Signup form", dependsOn: [story.id] }), story.id, "story"],
    ];
    for (const [attempt, id, found] of refused) {
      await assert.rejects(attempt(), missingReference("dependsOn", id, found));
    }
    for (const bad of UNSTORABLE) {
      await assert.rejects(work.addCapability({ ...link, dependsOn: [form.id, bad] }), schemaError("capability", ["dependsOn"]));
      await assert.rejects(work.editCapability(form.id, { dependsOn: [bad] }), schemaError("capability", ["dependsOn"]));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    assert.deepEqual(await transactions.get(form.id), form, "the edited capability is unchanged");

    // Control: dependencies on live capabilities are kept as given, on a new capability and on an edit (inside one
    // story, as edges, so the capability stores none of them: ADR-1282 D1).
    const linked = await work.addCapability({ ...link, dependsOn: [form.id, mailer.id] });
    assert.deepEqual(new Set(linked.fields.dependsOn), new Set([form.id, mailer.id]));
    assert.deepEqual((await transactions.get(linked.id))?.fields, { ...link, title: "3 · Confirmation link", dependsOn: [], proposed: true });
    const none = await work.addCapability({ title: "Welcome email", story: story.id, dependsOn: [] });
    await assertCreated(transactions, none, "capability", { title: "4 · Welcome email", story: story.id, dependsOn: [], proposed: true });
    const edited = await work.editCapability(form.id, { dependsOn: [mailer.id] });
    assert.deepEqual(edited?.fields, { title: "1 · Email form", story: story.id, proposed: true, dependsOn: [mailer.id] });
    // The tree shows each capability's dependencies (these were created too close together for
    // their order to be the point, so they are compared as sets).
    const tree = await work.projectTree();
    assert.deepEqual(
      Object.fromEntries(tree.stories.flatMap((node) => node.capabilities.map(({ id, dependsOn }) => [id, new Set(dependsOn)]))),
      { [form.id]: new Set([mailer.id]), [mailer.id]: new Set(), [linked.id]: new Set([form.id, mailer.id]), [none.id]: new Set() },
    );
  });

  contract("4.5", "a dependency loop between capabilities, A → B → A or longer, is refused and nothing is written", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const add = (title: string, dependsOn?: string[]) =>
      work.addCapability({ title, story: story.id, ...(dependsOn === undefined ? {} : { dependsOn }) });

    // B depends on A, so A depending on B would close the loop A → B → A.
    const a = await add("A");
    const b = await add("B", [a.id]);
    // A longer chain: B2 depends on C2 and C2 on A2, so A2 depending on B2 would close A2 → B2 → C2 → A2.
    const a2 = await add("A2");
    const c2 = await add("C2", [a2.id]);
    const b2 = await add("B2", [c2.id]);
    const deadEnd = await add("Dead end");
    const before = await transactions.history();

    const loops: [attempt: () => Promise<unknown>, path: string[]][] = [
      [() => work.editCapability(a.id, { dependsOn: [b.id] }), [a.id, b.id, a.id]],
      [() => work.editCapability(a.id, { dependsOn: [a.id] }), [a.id, a.id]],
      [() => work.editCapability(a2.id, { dependsOn: [b2.id] }), [a2.id, b2.id, c2.id, a2.id]],
      // Found wherever it hides: behind a dependency that leads nowhere, alongside other fields.
      [() => work.editCapability(a2.id, { title: "A2, renamed", dependsOn: [deadEnd.id, b.id, b2.id] }), [a2.id, b2.id, c2.id, a2.id]],
      // Closed from the middle of the chain: C2 depending on B2, which depends on C2.
      [() => work.editCapability(c2.id, { dependsOn: [a2.id, b2.id] }), [c2.id, b2.id, c2.id]],
    ];
    for (const [attempt, path] of loops) {
      await assert.rejects(attempt(), dependencyLoop(path));
    }
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");
    for (const record of [a, b, a2, b2, c2, deadEnd]) {
      assert.deepEqual(await work.dependsOn(record.id), record.fields.dependsOn ?? [], `${record.fields.title} is unchanged`);
    }

    // Control: edits that leave no loop go through. A diamond is not a loop: two paths from W
    // reach X, but nothing leads back to W.
    const x = await add("X");
    const y = await add("Y", [x.id]);
    const z = await add("Z", [x.id]);
    const w = await add("W");
    assert.deepEqual(new Set((await work.editCapability(w.id, { dependsOn: [y.id, z.id] }))?.fields.dependsOn), new Set([y.id, z.id]));
    assert.deepEqual((await work.editCapability(x.id, { dependsOn: [deadEnd.id] }))?.fields.dependsOn, [deadEnd.id]);
    // A capability inside a chain can change its other fields.
    assert.equal((await work.editCapability(c2.id, { title: "C2, renamed" }))?.fields.title, "C2, renamed");
    // Once B no longer depends on A, A may depend on B: the check is against the graph as it is now.
    assert.deepEqual((await work.editCapability(b.id, { dependsOn: [] }))?.fields.dependsOn, []);
    assert.deepEqual((await work.editCapability(a.id, { dependsOn: [b.id] }))?.fields.dependsOn, [b.id]);

    // A loop already stored, as a second process racing this one could store it (a work model
    // queues only its own writes), does not trap the check: an edit leading into the loop but not
    // back out of it goes through, one closing a new loop through it is refused, and the stored
    // loop can be broken.
    const l1 = await add("L1");
    const l2 = await add("L2", [l1.id]);
    await records.edit(l1.id, { dependsOn: [l2.id] }); // L1 → L2 → L1, written around the work model
    const into = await add("Into");
    assert.deepEqual((await work.editCapability(into.id, { dependsOn: [l1.id] }))?.fields.dependsOn, [l1.id]);
    await assert.rejects(work.editCapability(l1.id, { dependsOn: [into.id] }), dependencyLoop([l1.id, into.id, l1.id]));
    assert.deepEqual((await work.editCapability(l2.id, { dependsOn: [] }))?.fields.dependsOn, []);

    // Two edits racing each other, each fine alone, that together would close a loop: exactly
    // one of them is written, and the other is refused as a loop. The connection pool is warmed
    // first, as capability 2's race checks do, so that neither racer has to wait for a new
    // connection and the edits genuinely overlap.
    const p = await add("P");
    const q = await add("Q");
    await Promise.all(Array.from({ length: 8 }, () => transactions.get("warm-up")));
    const raceStart = await transactions.history();
    const [first, second] = await Promise.allSettled([
      work.editCapability(p.id, { dependsOn: [q.id] }),
      work.editCapability(q.id, { dependsOn: [p.id] }),
    ]);
    const dependsOn = async (id: string) => await work.dependsOn(id);
    const stored = [await dependsOn(p.id), await dependsOn(q.id)];
    assert.ok(!isDeepStrictEqual(stored, [[q.id], [p.id]]), "no loop was stored: P → Q and Q → P were both written");
    if (first.status === "fulfilled") {
      assert.equal(second.status, "rejected", "both edits were written");
      dependencyLoop([q.id, p.id, q.id])(second.status === "rejected" ? second.reason : undefined);
      assert.deepEqual(stored, [[q.id], []]);
    } else {
      assert.equal(second.status, "fulfilled", `both edits were refused: ${String(first.reason)}`);
      dependencyLoop([p.id, q.id, p.id])(first.reason);
      assert.deepEqual(stored, [[], [p.id]]);
    }
    assert.equal((await transactions.history()).length, raceStart.length + 1, "one edit was written, and only one");
  });

  contract("4.6", "a capability is born proposed; the agent switches the flag off, and back on, with its writer in history; one written before the flag reads proposed", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    assert.equal(capability.fields.proposed, true, "born proposed");

    assert.equal((await work.setProposed(capability.id, false, { actor: "agent-a" }))?.fields.proposed, false);
    assert.equal(((await records.get(capability.id))?.fields as { proposed?: boolean } | undefined)?.proposed, false, "stored");
    assert.equal((await transactions.history({ id: capability.id })).at(-1)?.actor, "agent-a", "with its writer");
    assert.equal((await work.setProposed(capability.id, true))?.fields.proposed, true, "and back on");

    const before = await transactions.history();
    assert.equal(await work.setProposed(contract.id, false), null, "only a capability has the flag");
    assert.equal(await work.setProposed("capability_000000000000", false), null);
    assert.deepEqual(await transactions.history(), before, "nothing written");

    await transactions.save({ id: "capability-old", type: "capability", version: 1, fields: { title: "Old one", story: story.id } });
    assert.equal(((await records.get("capability-old"))?.fields as { proposed?: boolean } | undefined)?.proposed, true, "a capability written before the flag reads proposed");
  });

  contract("4.7", "a contract planned without a number gets its capability's next free one, and a number another live contract of the capability carries is refused", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "3 · Email form", story: story.id });
    const other = await work.addCapability({ title: "4 · Confirmation link", story: story.id });
    const titleOf = (record: SchemaRecord<"contract">) => record.fields.title;

    assert.equal(titleOf(await work.addContract({ title: "Rejects a bad email", capability: form.id })), "3.1 · Rejects a bad email");
    assert.equal(titleOf(await work.addContract({ title: "Accepts a plus address", capability: form.id })), "3.2 · Accepts a plus address");
    assert.equal(titleOf(await work.addContract({ title: "3.5 · Trims spaces", capability: form.id })), "3.5 · Trims spaces", "a free number is kept");
    const next = await work.addContract({ title: "Lowercases the domain", capability: form.id });
    assert.equal(titleOf(next), "3.6 · Lowercases the domain", "the next free number follows the highest");
    assert.equal(titleOf(await work.addContract({ title: "The link expires", capability: other.id })), "4.1 · The link expires", "each capability numbers its own");
    const unnumbered = await work.addCapability({ title: "Password form", story: story.id });
    await work.editCapability(unnumbered.id, { title: "Password form" });
    assert.equal(titleOf(await work.addContract({ title: "Refuses a short password", capability: unnumbered.id })), "Refuses a short password", "a capability with no number gives none");

    const before = await transactions.history();
    await assert.rejects(work.addContract({ title: "3.2 · Accepts a plus address again", capability: form.id }), schemaError("contract", ["title"]));
    await assert.rejects(work.editContract(next.id, { title: "3.5 · Moved onto a taken number" }), schemaError("contract", ["title"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    assert.equal((await work.editContract(next.id, { title: "3.6 · Lowercases the whole address" }))?.fields.title, "3.6 · Lowercases the whole address", "a contract keeps its own number");
    await records.retire(next.id, "out of scope");
    assert.equal(titleOf(await work.addContract({ title: "3.6 · Lowercases the domain, again", capability: form.id })), "3.6 · Lowercases the domain, again", "only a live contract holds its number");
  });

  contract("4.8", "a capability planned without a number gets its story's next free one, so a contract planned on it moments later is numbered; a number given is kept", async ({ work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const first = await work.addCapability({ title: "Email form", story: story.id });
    assert.equal(first.fields.title, "1 · Email form", "the first of a story is 1");
    assert.equal((await work.addCapability({ title: "5 · Confirmation link", story: story.id })).fields.title, "5 · Confirmation link", "a number given is kept");
    const fresh = await work.addCapability({ title: "Lag instruments", story: story.id });
    assert.equal(fresh.fields.title, "6 · Lag instruments", "the next free number follows the highest");
    assert.equal((await work.addContract({ title: "The read is delayed", capability: fresh.id })).fields.title, "6.1 · The read is delayed");
    const elsewhere = await work.addStory({ title: "Visitor can sign in" });
    assert.equal((await work.addCapability({ title: "Password form", story: elsewhere.id })).fields.title, "1 · Password form", "each story numbers its own");
    const movedOut = [{ record: fresh.id, type: "capability" as const, base: 0, before: { story: story.id }, after: { story: elsewhere.id } }];
    assert.equal((await work.addCapability({ title: "Rate limits", story: story.id }, { pending: movedOut })).fields.title, "6 · Rate limits", "read as a pending move would leave the story, the number it frees is next");
  });

  contract("4.10", "a contract planned without a number skips the numbers the capability's tests already carry; a number given is kept", async ({ work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "3 · Email form", story: story.id });
    await work.addContract({ title: "Rejects a bad email", capability: form.id });
    const tested = { testedNumbers: ["3.1", "3.2", "3.4", "7.9"] };
    assert.equal((await work.addContract({ title: "Trims spaces", capability: form.id }, tested)).fields.title, "3.5 · Trims spaces", "past the highest a test carries");
    assert.equal((await work.addContract({ title: "3.4 · Accepts a plus address", capability: form.id }, tested)).fields.title, "3.4 · Accepts a plus address", "a landed test's own number is kept");
    assert.equal((await work.addContract({ title: "Lowercases the domain", capability: form.id })).fields.title, "3.6 · Lowercases the domain", "with no tests named, the plan alone numbers");
  });

  contract("4.11", "a contract planned without a number never takes the number of a numbered test no live contract carries: it gets the next free number past it, and only a number given binds it to that test", async ({ work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "3 · Email form", story: story.id });
    await work.addContract({ title: "Rejects a bad email", capability: form.id });
    await work.addContract({ title: "Accepts a plus address", capability: form.id });
    const orphan = { testedNumbers: ["3.1", "3.2", "3.3", "7.9"] };
    assert.equal((await work.addContract({ title: "Trims spaces", capability: form.id }, orphan)).fields.title, "3.4 · Trims spaces", "past the orphan test, not onto it");
    assert.equal((await work.addContract({ title: "3.3 · Lowercases the domain", capability: form.id }, orphan)).fields.title, "3.3 · Lowercases the domain", "the planner gives the orphan's number to take it");
  });
  contract("4.24", "a capability planned or retitled with a number another live capability of its story carries is refused, naming that one and the story's next free number; nothing is written", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Factory host" });
    const running = await work.addCapability({ title: "3 · Keeping the host running", story: story.id });
    const other = await work.addCapability({ title: "4 · Reading the logs", story: story.id });
    const naming = (error: unknown) => {
      assert.ok(error instanceof SchemaError && error.type === "capability", `expected a capability SchemaError, got: ${String(error)}`);
      assert.match(error.message, new RegExp(`capability number 3 is taken: ${running.id}`), "it names the holder");
      assert.match(error.message, /next free number is 5/, "it names the next free number");
      return true;
    };

    const elsewhere = await work.addStory({ title: "Factory updates" });
    const moved = await work.addCapability({ title: "3 · Keeping the factory current", story: elsewhere.id });

    const before = await transactions.history();
    await assert.rejects(work.addCapability({ title: "3 · Keeping the factory current", story: story.id }), naming);
    await assert.rejects(work.editCapability(other.id, { title: "3 · Reading the logs" }), naming);
    await assert.rejects(work.editCapability(moved.id, { story: story.id }), naming);
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    assert.equal((await work.editCapability(running.id, { title: "3 · Keeping the host up" }))?.fields.title, "3 · Keeping the host up", "a capability keeps its own number");
    await records.retire(running.id, "split");
    assert.equal((await work.addCapability({ title: "3 · Keeping the factory current", story: story.id })).fields.title, "3 · Keeping the factory current", "only a live capability holds its number");

    const pending = [
      { record: other.id, type: "capability" as const, base: 0, before: { story: story.id, title: "4 · Reading the logs" }, after: { story: elsewhere.id, title: "9 · Reading the logs" } },
      { record: moved.id, type: "capability" as const, base: 0, before: { story: elsewhere.id, title: "3 · Keeping the factory current" }, after: { story: story.id, title: "5 · Keeping the factory current" } },
    ];
    assert.equal((await work.addCapability({ title: "4 · Watching the host", story: story.id }, { pending })).fields.title, "4 · Watching the host", "a number a pending move frees is not taken");
    const unwritten = await transactions.history();
    await assert.rejects(work.addCapability({ title: "5 · Rotating the logs", story: story.id }, { pending }), (error: unknown) => {
      assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
      assert.match(error.message, new RegExp(`capability number 5 is taken: ${moved.id}`), "the one a pending move brings in holds it");
      assert.match(error.message, /next free number is 6/);
      return true;
    });
    assert.deepEqual(await transactions.history(), unwritten, "nothing was written");
  });

  contract("4.12", "only mapStories makes a story mapped: a mapped field given to addStory or editStory is refused and nothing is written", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const before = await transactions.history();
    const mapped = { from: "/code/shop", package: ".", folders: ["."] };
    await assert.rejects(work.addStory({ title: "Shop", mapped } as never), schemaError("story", ["mapped"]));
    await assert.rejects(work.editStory(story.id, { mapped } as never), schemaError("story", ["mapped"]));
    await assert.rejects(work.addStory({ title: "Voice", plugin: "voice" } as never), schemaError("story", ["plugin"]), "nor is a story made a plugin's but by importing its plan");
    await assert.rejects(work.editStory(story.id, { plugin: "voice" } as never), schemaError("story", ["plugin"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    assert.deepEqual((await records.get(story.id))?.fields, { title: "Visitor can sign up" });
  });

  contract("4.13", "mapStories adds a mapped story per new package, retires those of the same import whose package is gone, and leaves every other story as it stands", async ({ work, records }) => {
    const own = await work.addStory({ title: "Visitor can sign up" });
    const first = await work.mapStories("/code/shop", [
      { package: "packages/cart", title: "@shop/cart", description: "The cart", folders: ["packages/cart"] },
      { package: "packages/pay", title: "@shop/pay", folders: ["packages/pay"] },
    ]);
    assert.deepEqual(first.retired, []);
    assert.deepEqual(first.added.map((story) => story.fields), [
      { title: "@shop/cart", description: "The cart", mapped: { from: "/code/shop", package: "packages/cart", folders: ["packages/cart"] } },
      { title: "@shop/pay", mapped: { from: "/code/shop", package: "packages/pay", folders: ["packages/pay"] } },
    ]);
    const [cart, pay] = first.added;
    const elsewhere = await work.mapStories("git@github.com:shop/admin.git", [{ package: ".", title: "admin", folders: ["."] }]);

    const again = await work.mapStories("/code/shop", [
      { package: "packages/cart", title: "@shop/cart renamed", folders: ["packages/cart/src"] },
      { package: "packages/ship", title: "@shop/ship", folders: ["packages/ship"] },
    ]);
    assert.deepEqual(again.added.map((story) => story.fields.title), ["@shop/ship"], "only the new package is added");
    assert.deepEqual(again.retired, [pay!.id], "the story whose package is gone is retired");
    assert.deepEqual(again.kept, [cart!.id]);
    assert.deepEqual((await records.get(cart!.id))?.fields, cart!.fields, "a kept story stands as it was, its folders included");
    assert.equal(await records.get(pay!.id), null);
    assert.deepEqual(((await records.get(elsewhere.added[0]!.id)) as SchemaRecord<"story"> | null)?.fields.mapped, { from: "git@github.com:shop/admin.git", package: ".", folders: ["."] }, "another import's story is untouched");
    assert.deepEqual((await records.get(own.id))?.fields, { title: "Visitor can sign up" }, "a story storytree built is untouched");
  });

  contract("4.14", "the plan's tree carries a mapped story's import, package and folders as mapStories recorded them; a story storytree built carries none", async ({ work }) => {
    const own = await work.addStory({ title: "Visitor can sign up" });
    const { added: [cart] } = await work.mapStories("/code/shop", [{ package: "packages/cart", title: "@shop/cart", folders: ["packages/cart"] }]);
    const { stories } = await work.projectTree();
    assert.deepEqual(stories.find((story) => story.id === cart!.id)?.mapped, { from: "/code/shop", package: "packages/cart", folders: ["packages/cart"] });
    assert.equal(Object.hasOwn(stories.find((story) => story.id === own.id)!, "mapped"), false);
  });

  contract("4.15", "a number given in a contract's title without its separator is written as number then \" · \", on planning and on correcting; a title already in that form is kept", async ({ work }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "3 · Email form", story: story.id });
    const bare = await work.addContract({ title: "3.4 Accepts a plus address", capability: form.id });
    assert.equal(bare.fields.title, "3.4 · Accepts a plus address", "the separator is written in");
    assert.equal((await work.addContract({ title: "3.5 · Trims spaces", capability: form.id })).fields.title, "3.5 · Trims spaces", "a numbered title is kept");
    assert.equal((await work.editContract(bare.id, { title: "3.4 Accepts a plus address, any case" }))?.fields.title, "3.4 · Accepts a plus address, any case", "a correction is written in the same form");
  });

  contract("4.16", "a capability on a mapped story is planned with the folders and files of its import it covers, several roots allowed and written plainly; one with none, or a path outside its story's folders, is refused, as are covers on a built story", async ({ work, transactions }) => {
    const own = await work.addStory({ title: "Visitor can sign up" });
    const { added: [app] } = await work.mapStories("/code/app", [{ package: ".", title: "app", folders: ["."] }]);
    const { added: [cart] } = await work.mapStories("/code/shop", [{ package: "packages/cart", title: "@shop/cart", folders: ["packages/cart"] }]);
    const stats = await work.addCapability({ title: "Stats page", story: app!.id, covers: ["./app/(app)/stats/", "components\\stats", "lib/stats.ts"] });
    assert.deepEqual(stats.fields.covers, ["app/(app)/stats", "components/stats", "lib/stats.ts"], "each path from the imported folder, in one form");
    const before = await transactions.history();
    await assert.rejects(work.addCapability({ title: "Checkout", story: app!.id }), schemaError("capability", ["covers"]), "a mapped story's capability says what it covers");
    await assert.rejects(work.addCapability({ title: "Checkout", story: cart!.id, covers: ["packages/pay"] }), schemaError("capability", ["covers"]), "outside its story's folders");
    await assert.rejects(work.addCapability({ title: "Checkout", story: cart!.id, covers: ["../elsewhere"] }), schemaError("capability", ["covers"]), "outside its import");
    await assert.rejects(work.addCapability({ title: "Email form", story: own.id, covers: ["src"] }), schemaError("capability", ["covers"]), "a built story's capabilities are found by their tests");
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    assert.deepEqual((await work.addCapability({ title: "Cart lines", story: cart!.id, covers: ["packages/cart/src/lines"] })).fields.covers, ["packages/cart/src/lines"]);
  });

  contract("4.17", "no two capabilities of a mapped story cover one file: a path equal to, inside or around another's is refused, naming the capability that covers it, on planning and on correcting", async ({ work, records, transactions }) => {
    const { added: [app] } = await work.mapStories("/code/app", [{ package: ".", title: "app", folders: ["."] }]);
    const { added: [other] } = await work.mapStories("/code/admin", [{ package: ".", title: "admin", folders: ["."] }]);
    const stats = await work.addCapability({ title: "Stats page", story: app!.id, covers: ["app/stats", "lib/stats.ts"] });
    const before = await transactions.history();
    for (const covers of [["lib/stats.ts"], ["app/stats/chart"], ["app"], ["."]]) {
      await assert.rejects(work.addCapability({ title: "Charts", story: app!.id, covers }), (error: unknown) => {
        assert.ok(error instanceof SchemaError && error.fields.includes("covers"), String(error));
        assert.match(error.message, new RegExp(stats.id), "the refusal names the capability to edit instead");
        return true;
      }, covers.join());
    }
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    assert.ok(await work.addCapability({ title: "Stats", story: other!.id, covers: ["app/stats"] }), "another story's capability may cover the same path");
    const charts = await work.addCapability({ title: "Charts", story: app!.id, covers: ["app/charts"] });
    await assert.rejects(work.editCapability(charts.id, { covers: ["app/charts", "app/stats/chart.ts"] }), schemaError("capability", ["covers"]));
    await assert.rejects(work.editCapability(charts.id, { covers: undefined }), schemaError("capability", ["covers"]), "nor is a mapped story's capability left covering nothing");
    assert.deepEqual((await work.editCapability(stats.id, { covers: ["app/stats"] }))?.fields.covers, ["app/stats"], "a capability's own paths never overlap itself");
    assert.deepEqual((await work.editCapability(charts.id, { covers: ["app/charts", "lib/stats.ts"] }))?.fields.covers, ["app/charts", "lib/stats.ts"], "a path its owner let go is free");
    assert.deepEqual(((await records.get(charts.id)) as SchemaRecord<"capability">).fields.covers, ["app/charts", "lib/stats.ts"]);
    const { stories } = await work.projectTree();
    const covers = new Map(stories.find((story) => story.id === app!.id)?.capabilities.map((capability) => [capability.id, capability.covers]));
    assert.deepEqual(covers, new Map([[stats.id, ["app/stats"]], [charts.id, ["app/charts", "lib/stats.ts"]]]), "the plan's tree carries each one's covers");
  });

  contract("4.19", "the project's anchor is written a half at a time, what it is and who it is for, at one id, and read back by anchor() and the plan's tree; an empty half is refused with nothing written", async ({ work, records, transactions }) => {
    assert.equal(await work.anchor(), undefined, "a new project has no anchor");
    assert.ok(!("anchor" in (await work.projectTree())), "nor does its tree");
    await assert.rejects(work.setAnchor({ what: "" }), schemaError("anchor", ["what"]));
    assert.deepEqual(await transactions.history(), [], "nothing was written");
    const first = await work.setAnchor({ what: "a software factory" });
    assert.equal(first.id, ANCHOR_ID);
    assert.deepEqual(await work.anchor(), { what: "a software factory" });
    const second = await work.setAnchor({ audience: "people building software with coding agents" });
    assert.equal(second.id, ANCHOR_ID, "the second half is written to the same anchor");
    const both = { what: "a software factory", audience: "people building software with coding agents" };
    assert.deepEqual(await work.anchor(), both);
    assert.deepEqual((await work.projectTree()).anchor, both);
    assert.equal((await records.list("anchor")).length, 1, "a project has one anchor");
    await work.setAnchor({ what: undefined });
    assert.deepEqual(await work.anchor(), { audience: "people building software with coding agents" }, "a half given as undefined is removed");
  });

  contract("4.20", "anchorGaps reads what the plan has not said, the anchor's missing halves only, and nothing when both are said; no story is ever named (ADR-1096)", async ({ work }) => {
    await work.addStory({ title: "Visitor can sign up" });
    assert.deepEqual(anchorGaps(await work.projectTree()), { anchor: ["what", "audience"] });
    await work.setAnchor({ audience: "small shops" });
    assert.deepEqual(anchorGaps(await work.projectTree()), { anchor: ["what"] });
    await work.setAnchor({ what: "a shop builder" });
    assert.deepEqual(anchorGaps(await work.projectTree()), { anchor: [] });
  });

  contract("4.21", "a story carries no audience (ADR-1096): one given an audience is refused with nothing written, and one stored with an audience before reads without failing, its tree node carries none, and its next edit stores it without one", async ({ work, records, transactions }) => {
    const before = await transactions.history();
    await assert.rejects(work.addStory(untyped({ title: "Admin", audience: "admins" })), schemaError("story", ["audience"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    await transactions.save({ id: "story-old", type: "story", version: 1, fields: { title: "Visitor can sign up", audience: "first-time visitors" } });
    assert.equal(((await records.get("story-old")) as SchemaRecord<"story"> | null)?.fields.title, "Visitor can sign up", "an old story still reads");
    const node = (await work.projectTree()).stories.find((story) => story.id === "story-old")!;
    assert.ok(!("audience" in node), "the plan's tree carries no audience");
    await assert.rejects(work.editStory("story-old", untyped({ audience: "visitors" })), schemaError("story", ["audience"]), "nor is one written on an edit");
    assert.deepEqual((await work.editStory("story-old", { description: "By email" }))?.fields, { title: "Visitor can sign up", description: "By email" });
    assert.deepEqual((await transactions.get("story-old"))?.fields, { title: "Visitor can sign up", description: "By email" }, "stored without it");
  });

  contract("4.22", "the plan's tree carries a story's risk reading and guardrails, and a capability's guardrails, as stored; one without them carries none", async ({ work }) => {
    const risk = {
      depth: { value: 3 as const, read: "2026-10-24", reason: "flags: screen" },
      radius: { value: 2 as const, downstream: 1, audience: "invited" as const, read: "2026-10-24", reason: "serves invited users itself" },
    };
    const guardrails = [{ check: "a real-app run", trigger: "change" as const }];
    const rated = await work.addStory({ title: "Desktop app", risk, guardrails });
    const plain = await work.addStory({ title: "Visitor can sign up" });
    const install = await work.addCapability({ title: "Install and update", story: rated.id, guardrails: [{ check: "a fresh-install sweep", trigger: "release" }] });
    const other = await work.addCapability({ title: "Sign-up form", story: plain.id });
    const { stories } = await work.projectTree();
    const [desktop, visitor] = [rated.id, plain.id].map((id) => stories.find((story) => story.id === id)!);
    assert.deepEqual([desktop!.risk, desktop!.guardrails], [risk, guardrails]);
    assert.deepEqual(desktop!.capabilities.find(({ id }) => id === install.id)?.guardrails, [{ check: "a fresh-install sweep", trigger: "release" }]);
    assert.ok(!("risk" in visitor!) && !("guardrails" in visitor!), "a story without them carries none");
    assert.ok(!("guardrails" in visitor!.capabilities.find(({ id }) => id === other.id)!), "nor does a capability");
  });

  contract("4.37", "a contract may name the existing tests that prove it (provedBy, each a pytest node id or a test's title): addContract and editContract store them, projectTree gives them, and an empty list or name is refused", async ({ work, transactions }) => {
    const story = await work.addStory({ title: "Checkout" });
    const capability = await work.addCapability({ title: "Totals", story: story.id });
    const proved = await work.addContract({ title: "Sums the cart", capability: capability.id, provedBy: ["tests/test_total.py::test_sums"] });
    await laterThan(proved);
    const plain = await work.addContract({ title: "Rounds to the cent", capability: capability.id });
    const contracts = async () => (await work.projectTree()).stories[0]!.capabilities[0]!.contracts;
    assert.deepEqual(await contracts(), [
      { id: proved.id, title: "1.1 · Sums the cart", provedBy: ["tests/test_total.py::test_sums"] },
      { id: plain.id, title: "1.2 · Rounds to the cent" },
    ]);
    await work.editContract(plain.id, { provedBy: ["tests/test_total.py::TestRounding", "rounds a half cent up"] });
    assert.deepEqual((await contracts())[1], { id: plain.id, title: "1.2 · Rounds to the cent", provedBy: ["tests/test_total.py::TestRounding", "rounds a half cent up"] }, "an edit replaces them");
    const before = await transactions.history();
    await assert.rejects(work.addContract({ title: "Empty", capability: capability.id, provedBy: [] }), schemaError("contract", ["provedBy"]));
    await assert.rejects(work.editContract(proved.id, { provedBy: [""] }), schemaError("contract", ["provedBy"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("4.25", "importPluginPlan writes a plugin's story, capabilities and contracts from its plan, adopting a live story the first time; a later import matches capabilities by number and contracts by theirs, edits what changed, adds what is new and retires what the plan no longer holds, keeping ids", async ({ work, records }) => {
    const voice = await work.addStory({ title: "Voice", description: "old" });
    const address = await work.addCapability({ title: "1 · The address", story: voice.id, proposed: false });
    const notFound = await work.addContract({ title: "1.1 · A wrong path is answered 404", capability: address.id });
    const speech = await work.addCapability({ title: "2 · Speech", story: voice.id });
    const spoken = await work.addContract({ title: "2.1 · Speaks", capability: speech.id });
    const other = await work.addStory({ title: "Desktop app" });

    const first = await work.importPluginPlan("voice", {
      story: { title: "Voice", description: "Talk to storytree by voice" },
      capabilities: [
        { title: "1 · The address", proposed: false, contracts: [{ title: "1.1 · A wrong path is answered 404" }, { title: "1.2 · A wrong method is answered 405" }] },
        { title: "2 · Speech", proposed: true, contracts: [{ title: "2.1 · Speaks" }] },
      ],
    }, { adopt: voice.id });
    assert.equal(first.story, voice.id, "the live story is adopted, keeping its id");
    assert.equal(first.added.length, 1);
    assert.deepEqual(first.edited, [voice.id], "only the story's description changed");
    assert.deepEqual(first.retired, []);
    assert.deepEqual(new Set(first.kept), new Set([address.id, notFound.id, speech.id, spoken.id]));
    assert.deepEqual((await records.get(voice.id))?.fields, { title: "Voice", description: "Talk to storytree by voice", plugin: "voice" });
    const added = (await records.get(first.added[0]!)) as SchemaRecord<"contract">;
    assert.deepEqual(added.fields, { title: "1.2 · A wrong method is answered 405", capability: address.id });

    const again = await work.importPluginPlan("voice", {
      story: { title: "Voice", description: "Talk to storytree by voice" },
      capabilities: [{ title: "1 · The address and its guards", proposed: false, contracts: [{ title: "1.1 · A wrong path is answered 404, with no body" }] }],
    });
    assert.equal(again.story, voice.id, "the plugin's story is found by its plugin");
    assert.deepEqual(again.added, []);
    assert.deepEqual(new Set(again.edited), new Set([address.id, notFound.id]));
    assert.deepEqual(new Set(again.retired), new Set([first.added[0], speech.id, spoken.id]), "what the plan no longer holds is retired, a capability's contracts with it");
    assert.equal(((await records.get(notFound.id)) as SchemaRecord<"contract">).fields.title, "1.1 · A wrong path is answered 404, with no body", "a contract keeps its id across an edit");
    assert.deepEqual(new Map((await work.projectTree()).stories.map(({ id, plugin }) => [id, plugin])), new Map([[voice.id, "voice"], [other.id, undefined]]), "the plan's tree says whose plan a story is");

    const fresh = await work.importPluginPlan("notes", { story: { title: "Notes" }, capabilities: [{ title: "1 · Taking a note", contracts: [{ title: "1.1 · A note is kept" }] }] });
    const made = (await records.get(fresh.story)) as SchemaRecord<"story">;
    assert.deepEqual(made.fields, { title: "Notes", plugin: "notes" }, "with no story to adopt, the plugin's story is made");
    assert.equal(fresh.added.length, 3);
  });

  contract("4.26", "a plugin's story, its capabilities and its contracts are refused every plan edit (story, capability, proposed flag, contract), each naming the plugin's plan; nothing is written", async ({ work, transactions }) => {
    const { story } = await work.importPluginPlan("voice", { story: { title: "Voice" }, capabilities: [{ title: "1 · The address", contracts: [{ title: "1.1 · A wrong path is answered 404" }] }] });
    const { stories } = await work.projectTree();
    const capability = stories.find(({ id }) => id === story)!.capabilities[0]!;
    const promise = capability.contracts[0]!;
    const before = await transactions.history();
    const naming = (error: unknown) => {
      assert.ok(error instanceof SchemaError, String(error));
      assert.match(error.message, /voice's plan/);
      return true;
    };
    await assert.rejects(work.editStory(story, { title: "Talk" }), naming);
    await assert.rejects(work.addCapability({ title: "2 · Speech", story }), naming);
    await assert.rejects(work.editCapability(capability.id, { title: "1 · An address" }), naming);
    await assert.rejects(work.setProposed(capability.id, false), naming);
    await assert.rejects(work.addContract({ title: "1.2 · A wrong method", capability: capability.id }), naming);
    await assert.rejects(work.editContract(promise.id, { title: "1.1 · Not found" }), naming);
    const elsewhere = await work.addStory({ title: "Desktop" });
    const outside = await work.addCapability({ title: "1 · Window", story: elsewhere.id });
    await assert.rejects(work.editCapability(outside.id, { story }), naming, "nor is a capability moved into it");
    assert.deepEqual((await transactions.history()).slice(0, before.length), before);
    assert.equal((await transactions.history()).length, before.length + 2, "only the two writes outside the plugin's story were made");
  });

  contract("4.27", "a plugin plan with a capability or contract carrying no number, a number twice, or a contract numbered under another capability is refused, as is adopting a mapped story or another plugin's, with nothing written", async ({ work, transactions }) => {
    const mine = await work.addStory({ title: "Voice" });
    const { added: [mapped] } = await work.mapStories("/code/shop", [{ package: ".", title: "shop", folders: ["."] }]);
    const { story: theirs } = await work.importPluginPlan("notes", { story: { title: "Notes" }, capabilities: [] });
    const before = await transactions.history();
    const bad = [
      [{ title: "The address", contracts: [] }],
      [{ title: "1 · The address", contracts: [{ title: "A wrong path" }] }],
      [{ title: "1 · The address", contracts: [] }, { title: "1 · Again", contracts: [] }],
      [{ title: "1 · The address", contracts: [{ title: "1.1 · One" }, { title: "1.1 · Two" }] }],
      [{ title: "1 · The address", contracts: [{ title: "2.1 · Elsewhere" }] }],
    ];
    for (const capabilities of bad) {
      await assert.rejects(work.importPluginPlan("voice", { story: { title: "Voice" }, capabilities }, { adopt: mine.id }), SchemaError, JSON.stringify(capabilities));
    }
    await assert.rejects(work.importPluginPlan("voice", { story: { title: "Voice" }, capabilities: [] }, { adopt: mapped!.id }), SchemaError, "a mapped story is its import's");
    await assert.rejects(work.importPluginPlan("voice", { story: { title: "Voice" }, capabilities: [] }, { adopt: theirs }), SchemaError, "another plugin's story is its own");
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("4.38", "an edge joins two live capabilities of one story and the dependent's dependsOn reads it: a same-story id in dependsOn becomes an edge and only another story's ids are stored; an edge across stories, to itself, twice, to no live capability or closing a loop is refused, with nothing written", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const elsewhere = await work.addStory({ title: "Mail" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const mailer = await work.addCapability({ title: "Mailer", story: elsewhere.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id, dependsOn: [form.id, mailer.id] });
    assert.deepEqual(link.fields.dependsOn, [form.id, mailer.id], "the capability reads both of its links");
    assert.deepEqual((await transactions.get(link.id))?.fields.dependsOn, [mailer.id], "only the other story's id is stored on it");
    const edges = await records.list("edge");
    assert.deepEqual(edges.map(({ fields }) => fields), [{ from: link.id, to: form.id }], "its own story's link is an edge, holding no contracts");
    assert.deepEqual(await work.dependsOn(link.id), [form.id, mailer.id]);
    const tree = await work.projectTree();
    const signUp = tree.stories.find(({ id }) => id === story.id)!;
    assert.deepEqual(signUp.capabilities.find(({ id }) => id === link.id)?.dependsOn, [form.id, mailer.id], "the tree's dependsOn reads the edge, then the stored id");
    assert.deepEqual(signUp.edges, [{ id: edges[0]!.id, from: link.id, to: form.id, contracts: [] }]);
    assert.equal(tree.stories.find(({ id }) => id === elsewhere.id)?.edges, undefined, "a story with no edges lists none");

    // An edge written directly reads the same way, and is described.
    const welcome = await work.addCapability({ title: "Welcome email", story: story.id });
    const direct = await work.addEdge({ from: welcome.id, to: link.id, description: "Sent once the link is used" });
    assert.deepEqual(await work.dependsOn(welcome.id), [link.id]);
    assert.equal((await work.editEdge(direct.id, { description: "Sent after the link" }))?.fields.description, "Sent after the link");

    const dropped = await records.create("capability", { title: "9 · Dropped", story: story.id, proposed: true });
    await records.retire(dropped.id, "gone");
    const beforeRefusals = await transactions.history();
    await assert.rejects(work.addEdge({ from: link.id, to: mailer.id }), schemaError("edge", ["to"]), "an edge across stories is refused");
    await assert.rejects(work.addEdge({ from: form.id, to: form.id }), schemaError("edge", ["to"]), "an edge to itself is refused");
    await assert.rejects(work.addEdge({ from: link.id, to: form.id }), schemaError("edge", ["to"]), "an edge the story has is refused");
    await assert.rejects(work.addEdge({ from: form.id, to: dropped.id }), missingReference("to", dropped.id));
    await assert.rejects(work.addEdge({ from: NO_CAPABILITY, to: form.id }), missingReference("from", NO_CAPABILITY));
    await assert.rejects(work.addEdge({ from: form.id, to: welcome.id }), dependencyLoop([form.id, welcome.id, link.id, form.id]), "form → welcome → link → form");
    await assert.rejects(work.editCapability(form.id, { dependsOn: [welcome.id] }), dependencyLoop([form.id, welcome.id, link.id, form.id]), "the loop check reads edges");
    await assert.rejects(work.editEdge(direct.id, untyped({ to: form.id })), schemaError("edge", ["to"]), "an edge keeps its two capabilities");
    assert.deepEqual(await transactions.history(), beforeRefusals, "none of them wrote anything");

    // An edit naming the same-story ids again writes the edges it lacks and retires those it no longer names.
    const captcha = await work.addCapability({ title: "Captcha", story: story.id });
    const edited = await work.editCapability(link.id, { dependsOn: [mailer.id, captcha.id] });
    assert.deepEqual(edited?.fields.dependsOn, [captcha.id, mailer.id], "edges read first, then the stored ids");
    assert.deepEqual((await records.list("edge")).filter(({ fields }) => fields.from === link.id).map(({ fields }) => fields.to), [captcha.id], "the edge to the form is retired");
  });

  contract("4.39", "an edge holds its own contracts: one added to an edge keeps a number given, a number another live contract of its story carries is refused, and one given none gets its dependent capability's next free number, past every number the story's contracts carry, which that capability never gives again; the tree lists it under the story's edge, never among either capability's contracts", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const own = await work.addContract({ title: "Rejects a bad email", capability: form.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id, dependsOn: [form.id] });
    const edge = (await records.list("edge"))[0]!;

    const loose = await work.addContract({ title: "The link reads the form's address", edge: edge.id });
    await laterThan(loose);
    assert.equal(loose.fields.title, "2.1 · The link reads the form's address", "its dependent capability's next free number");
    const numbered = await work.addContract({ title: "1.7 The address arrives checked", edge: edge.id });
    assert.equal(numbered.fields.title, "1.7 · The address arrives checked", "a number given is kept, written with its separator");

    const before = await transactions.history();
    await assert.rejects(work.addContract({ title: "1.1 · Taken by the form", edge: edge.id }), schemaError("contract", ["title"]), "a number a capability's contract in the story carries");
    await assert.rejects(work.addContract({ title: "1.7 · Taken by the edge", edge: edge.id }), schemaError("contract", ["title"]), "a number another edge contract carries");
    await assert.rejects(work.addContract({ title: "Nowhere", edge: "edge_000000000000" }), missingReference("edge", "edge_000000000000"));
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    const tree = await work.projectTree();
    const node = tree.stories[0]!;
    assert.deepEqual(new Map(node.capabilities.map(({ id, contracts }) => [id, contracts.map((contract) => contract.id)])), new Map([[form.id, [own.id]], [link.id, []]]), "each capability's own contracts are unchanged");
    assert.deepEqual(node.edges?.[0]?.contracts.map(({ id }) => id), [loose.id, numbered.id]);

    // A capability's contract moves onto the edge keeping its number, and back.
    const moved = await work.editContract(own.id, { edge: edge.id });
    assert.deepEqual(moved?.fields, { title: "1.1 · Rejects a bad email", edge: edge.id }, "it leaves its capability");
    const back = await work.editContract(own.id, { capability: form.id });
    assert.deepEqual(back?.fields, { title: "1.1 · Rejects a bad email", capability: form.id }, "it leaves the edge");

    // Under numbered capabilities, a contract given no number gets its dependent capability's next free one.
    const shop = await work.addStory({ title: "Shopper checks out" });
    const cart = await work.addCapability({ title: "1 · Cart", story: shop.id });
    const pay = await work.addCapability({ title: "2 · Payment", story: shop.id, dependsOn: [cart.id] });
    const charged = await work.addContract({ title: "Charges the card", capability: pay.id });
    const kept = await work.addContract({ title: "Keeps the basket", capability: cart.id });
    const reads = (await records.list("edge")).find(({ fields }) => fields.from === pay.id)!;
    const across = await work.addContract({ title: "Payment reads the cart's total", edge: reads.id }, { testedNumbers: ["2.2"] });
    assert.equal(across.fields.title, "2.3 · Payment reads the cart's total", "past the dependent's contracts and its tests");
    await work.editContract(kept.id, { edge: reads.id });
    assert.equal((await work.addContract({ title: "Empties itself", capability: cart.id })).fields.title, "1.2 · Empties itself", "a number moved onto an edge is not given again");
    assert.equal((await work.addContract({ title: "Refunds the card", capability: pay.id })).fields.title, "2.4 · Refunds the card", "nor is one an edge contract was given");
    assert.equal(charged.fields.title, "2.1 · Charges the card");
  });

  contract("4.40", "moving a capability to another story turns its edges and its dependents' edges to it into stored dependsOn ids, and stored ids of its new story into edges; a dependsOn edit or move that would drop an edge holding contracts is refused, with nothing written", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const mail = await work.addStory({ title: "Mail" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const sender = await work.addCapability({ title: "Sender", story: mail.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id, dependsOn: [form.id, sender.id] });
    const welcome = await work.addCapability({ title: "Welcome email", story: story.id, dependsOn: [link.id] });

    await work.editCapability(link.id, { story: mail.id });
    assert.deepEqual(new Set(await work.dependsOn(link.id)), new Set([form.id, sender.id]), "its links read the same");
    assert.deepEqual(await work.dependsOn(welcome.id), [link.id], "and so does its dependent's");
    const edges = () => records.list("edge").then((all) => all.map(({ fields }) => [fields.from, fields.to]));
    assert.deepEqual(await edges(), [[link.id, sender.id]], "only the link to its new story's capability is an edge");
    assert.deepEqual((await transactions.get(link.id))?.fields.dependsOn, [form.id], "the form, now another story's, is stored");
    assert.deepEqual((await transactions.get(welcome.id))?.fields.dependsOn, [link.id], "the dependent stores its link, now across stories");

    const edge = (await records.list("edge"))[0]!;
    await work.addContract({ title: "The sender takes the link", edge: edge.id });
    const before = await transactions.history();
    await assert.rejects(work.editCapability(link.id, { dependsOn: [form.id] }), schemaError("capability", ["dependsOn"]), "dropping the edge would lose its contract");
    await assert.rejects(work.editCapability(link.id, { story: story.id }), schemaError("capability", ["dependsOn"]), "so would moving it out of the edge's story");
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("4.41", "moveDependsOnToEdges moves every stored same-story dependsOn id onto an edge with no contracts, leaving another story's ids stored, and every capability's dependsOn reads back the same ids; a second run writes nothing", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const mail = await work.addStory({ title: "Mail" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const sender = await work.addCapability({ title: "Sender", story: mail.id });
    // Stored as the plan stored them before edges, written around the work model.
    const link = await records.create("capability", { title: "2 · Confirmation link", story: story.id, proposed: true, dependsOn: [sender.id, form.id] });
    const lone = await records.create("capability", { title: "2 · Bounce handling", story: mail.id, proposed: true, dependsOn: [form.id] });
    const faces = async () => Object.fromEntries(await Promise.all([form, sender, link, lone].map(async ({ id }) => [id, new Set(await work.dependsOn(id))])));
    const read = await faces();
    assert.deepEqual(read[link.id], new Set([sender.id, form.id]), "a stored same-story id counts before it is moved");

    const moved = await work.moveDependsOnToEdges();
    assert.deepEqual(moved.capabilities, [link.id]);
    assert.equal(moved.edges.length, 1);
    assert.deepEqual((await records.get(moved.edges[0]!))?.fields, { from: link.id, to: form.id });
    assert.deepEqual((await transactions.get(link.id))?.fields.dependsOn, [sender.id], "another story's id stays stored");
    assert.deepEqual((await transactions.get(lone.id))?.fields.dependsOn, [form.id], "a capability with only another story's ids is untouched");
    assert.deepEqual(await faces(), read, "every capability's dependsOn reads back the same ids");

    const before = await transactions.history();
    assert.deepEqual(await work.moveDependsOnToEdges(), { edges: [], capabilities: [] });
    assert.deepEqual(await transactions.history(), before, "a second run writes nothing");
  });

  contract("4.42", "importPluginPlan writes a plan capability's same-story dependsOn as edges and another story's as stored ids; a re-import naming the same ids writes nothing", async ({ work, records, transactions }) => {
    const other = await work.addStory({ title: "Desktop app" });
    const window = await work.addCapability({ title: "Window", story: other.id });
    const first = await work.importPluginPlan("voice", { story: { title: "Voice" }, capabilities: [{ title: "1 · The address", contracts: [] }] });
    const address = first.added.find((id) => id.startsWith("capability_"))!;
    const plan = {
      story: { title: "Voice" },
      capabilities: [
        { title: "1 · The address", contracts: [] },
        { title: "2 · Speech", dependsOn: [address, window.id], contracts: [] },
      ],
    };
    const second = await work.importPluginPlan("voice", plan);
    const speech = second.added.find((id) => id.startsWith("capability_"))!;
    assert.deepEqual(await work.dependsOn(speech), [address, window.id]);
    assert.deepEqual((await transactions.get(speech))?.fields.dependsOn, [window.id], "another story's id is stored");
    assert.deepEqual((await records.list("edge")).map(({ fields }) => fields), [{ from: speech, to: address }], "the plugin's own capability is an edge");

    const before = await transactions.history();
    const third = await work.importPluginPlan("voice", plan);
    assert.deepEqual(third.edited, []);
    assert.deepEqual(await transactions.history(), before, "a re-import naming the same ids writes nothing");

    const fourth = await work.importPluginPlan("voice", { ...plan, capabilities: [plan.capabilities[0]!, { ...plan.capabilities[1]!, dependsOn: [window.id] }] });
    assert.deepEqual(fourth.edited, [speech]);
    assert.deepEqual(await work.dependsOn(speech), [window.id], "the edge the plan no longer names is gone");
    await assert.rejects(work.addEdge({ from: speech, to: address }), schemaError("edge", ["from"]), "an edge on a plugin's story is its plan's to write");
  });

  contract("4.43", "importPluginPlan given the numbers its plan's source ever held retires only a live capability or contract among them; any other (one another lane landed after the source was cut) stays live with its id and is reported left, not retired", async ({ work, records }) => {
    const plan = (capabilities: PluginPlan["capabilities"]): PluginPlan => ({ story: { title: "Voice" }, capabilities });
    const address = { title: "1 · The address", contracts: [{ title: "1.1 · A wrong path is answered 404" }, { title: "1.2 · A wrong method is answered 405" }] };
    const first = await work.importPluginPlan("voice", plan([address, { title: "2 · Speech", contracts: [{ title: "2.1 · Speaks" }] }]));
    const ids = async () => new Map((await work.projectTree()).stories.find(({ id }) => id === first.story)!.capabilities.flatMap((capability) => [[capability.title, capability.id], ...capability.contracts.map((contract) => [contract.title, contract.id] as const)]));
    const landed = await ids();

    // A folder cut before 1.2 and capability 2 landed, whose own history dropped 1.1's old sibling 1.3, holds only 1.1.
    const stale = await work.importPluginPlan("voice", plan([{ title: "1 · The address", contracts: [{ title: "1.1 · A wrong path is answered 404" }] }]), { held: { capabilities: [1], contracts: ["1.1", "1.3"] } });
    assert.deepEqual(stale.retired, [], "nothing the source never held is retired");
    assert.deepEqual(new Set(stale.left), new Set([landed.get("1.2 · A wrong method is answered 405"), landed.get("2 · Speech"), landed.get("2.1 · Speaks")]), "another lane's capability and contracts are left, and said");
    assert.deepEqual(await ids(), landed, "they stay live under their ids");

    const removed = await work.importPluginPlan("voice", plan([{ title: "1 · The address", contracts: [{ title: "1.1 · A wrong path is answered 404" }] }]), { held: { capabilities: [1, 2], contracts: ["1.1", "1.2", "2.1"] } });
    assert.deepEqual(new Set(removed.retired), new Set([landed.get("1.2 · A wrong method is answered 405"), landed.get("2 · Speech"), landed.get("2.1 · Speaks")]), "what the source's own history held and dropped is retired");
    assert.deepEqual(removed.left, []);
    assert.equal(await records.get(landed.get("2 · Speech")!), null);
  });

  contract("4.44", "importPluginPlan given the versions of its plan its source ever held edits a kept record's field only from a value one of them held; a field another lane changed since the source was cut stays as it stands and the record is reported stood", async ({ work, records }) => {
    const plan = (capability: string, contract: string): PluginPlan => ({ story: { title: "Voice" }, capabilities: [{ title: "1 · The address", description: capability, contracts: [{ title: "1.1 · A wrong path is answered 404", description: contract }] }] });
    const cut = plan("Where it listens.", "Any path it does not serve.");
    const first = await work.importPluginPlan("voice", cut);
    const [capability, contract] = [first.added.find((id) => id.startsWith("capability_"))!, first.added.find((id) => id.startsWith("contract_"))!];
    const held = (...versions: PluginPlan[]) => ({ held: { capabilities: [1], contracts: ["1.1"], versions } });
    // Another lane lands a new description for both, from its own folder.
    const landed = plan("The port and path it listens on.", "Any path outside its routes.");
    await work.importPluginPlan("voice", landed, held(cut, landed));

    // A folder cut before that landing, whose own history changed only the contract's description, holds the old capability text.
    const stale = await work.importPluginPlan("voice", plan("Where it listens.", "A path it never serves."), held(cut, plan("Where it listens.", "A path it never serves.")));
    assert.deepEqual(stale.edited, [], "nothing another lane changed is written back");
    assert.deepEqual(new Set(stale.stood), new Set([capability, contract]), "each is said");
    assert.equal(((await records.get(capability))?.fields as { description?: string } | undefined)?.description, "The port and path it listens on.");
    assert.equal(((await records.get(contract))?.fields as { description?: string } | undefined)?.description, "Any path outside its routes.");

    // After merging the landing, the folder's history holds the live text, so its own change is written.
    const merged = await work.importPluginPlan("voice", plan("The port and path it listens on.", "A path it never serves."), held(cut, landed, plan("The port and path it listens on.", "A path it never serves.")));
    assert.deepEqual(merged.edited, [contract]);
    assert.deepEqual(merged.stood, []);
    assert.equal(((await records.get(contract))?.fields as { description?: string } | undefined)?.description, "A path it never serves.");
  });

  contract("4.45", "a contract moved to a numbered capability whose number its old one's prefix is not takes the new capability's next free number, past its contracts and tests; one given a title, or moved within its prefix, keeps its own", async ({ work }) => {
    const story = await work.addStory({ title: "Context service" });
    const retrieval = await work.addCapability({ title: "3 · Retrieval", story: story.id });
    const api = await work.addCapability({ title: "5 · Context API", story: story.id });
    await work.addContract({ title: "Finds a matter's documents", capability: retrieval.id });
    const ranked = await work.addContract({ title: "Ranks by recency", capability: api.id });
    const cited = await work.addContract({ title: "Cites its sources", capability: api.id });
    const named = await work.addContract({ title: "Names its matter", capability: api.id });
    const titleOf = (record: SchemaRecord<"contract"> | null) => record?.fields.title;

    assert.equal(titleOf(await work.editContract(ranked.id, { capability: retrieval.id }, { testedNumbers: ["3.2"] })), "3.3 · Ranks by recency", "past the new capability's contracts and its tests");
    assert.equal(titleOf(await work.editContract(cited.id, { capability: retrieval.id })), "3.4 · Cites its sources", "the next after one moved in");
    assert.equal(titleOf(await work.editContract(named.id, { capability: retrieval.id, title: "5.3 · Names its matter" })), "5.3 · Names its matter", "a title given is kept");
    const stray = await work.addContract({ title: "3.9 · Reads a matter's notes", capability: api.id });
    assert.equal(titleOf(await work.editContract(stray.id, { capability: retrieval.id })), "3.9 · Reads a matter's notes", "one already numbered for its new capability keeps its number");
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
    { id: record.id, type, version: SCHEMA_VERSIONS[type], fields, createdAt: record.createdAt, updatedAt: record.createdAt },
    `a new ${type}, holding exactly the fields given`,
  );
  assert.deepEqual(await transactions.get(record.id), record, `the ${type} is stored as returned`);
}

/** Wait until the clock has passed `record`'s creation, so the next record is created strictly later. */
async function laterThan(record: { readonly createdAt: string }): Promise<void> {
  await waitUntil(() => Date.now() > Date.parse(record.createdAt), 5_000, `the clock to pass ${record.createdAt}`);
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

/** A value the compiler would refuse, sent the way a JavaScript caller or an agent could send it. */
function untyped(value: unknown): never {
  return value as never;
}

/** What each reference field must name, restated from the spec. */
const MUST_NAME: Readonly<Record<string, string>> = {
  story: "story",
  capability: "capability",
  stories: "story",
  dependsOn: "capability",
  from: "capability",
  to: "capability",
  edge: "edge",
};

/**
 * An assert.rejects check: a MissingReferenceError for `field` holding `id`, whose message names
 * both. `found` is the type of the record `id` names when that record is of the wrong type, and
 * undefined when there is no such record (it is missing or retired).
 */
function missingReference(field: string, id: string, found?: RecordType): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingReferenceError, `expected a MissingReferenceError, got: ${String(error)}`);
    assert.deepEqual(
      { field: error.field, id: error.id, expected: error.expected, found: error.found },
      { field, id, expected: MUST_NAME[field], found },
      error.message,
    );
    for (const part of [JSON.stringify(field), JSON.stringify(id), ...(found === undefined ? [] : [found])]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    return true;
  };
}

/** An assert.rejects check: a DependencyLoopError around exactly `path`, whose message names the loop. */
function dependencyLoop(path: readonly string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof DependencyLoopError, `expected a DependencyLoopError, got: ${String(error)}`);
    assert.deepEqual(error.path, path);
    assert.ok(error.message.includes(path.join(" → ")), `the message names the loop: ${error.message}`);
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
