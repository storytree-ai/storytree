/**
 * Capability 4 · Work model: one test per contract 4.1-4.5 in the library story, each run on
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
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { connect } from "../project/index.js";
import { DependencyLoopError, MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type RecordType, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import { WorkModel } from "./index.js";

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
    await assertCreated(transactions, capability, "capability", { title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    await assertCreated(transactions, contract, "contract", { title: "Rejects a bad email", capability: capability.id });

    const signUp = {
      id: story.id,
      title: "Visitor can sign up",
      description: "By email, with a confirmation link",
      capabilities: [
        { id: capability.id, title: "Email form", dependsOn: [], contracts: [{ id: contract.id, title: "Rejects a bad email" }] },
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

    const leaf = (record: SchemaRecord<"capability">) => ({ id: record.id, title: record.fields.title, dependsOn: [], contracts: [] });
    const firstNode = {
      id: first.id,
      title: "Capability 0",
      dependsOn: [],
      contracts: contracts.map((record, n) => ({ id: record.id, title: `Contract ${n}` })),
    };
    const linkNode = {
      id: link.id,
      title: "Confirmation link",
      description: "Sent once the form is valid",
      dependsOn: [at(capabilities, 2).id, first.id],
      contracts: [{ id: expiry.id, title: "The link expires", description: "After 24 hours" }],
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

  contract("4.2", "an arc listing a story is returned by arcsFor(storyId), and an arc listing no stories is accepted", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const other = await work.addStory({ title: "Visitor can sign in" });
    const unlisted = await work.addStory({ title: "Visitor can leave" });

    // Arcs listing no stories, as a research arc may: with no stories field, and with an empty list.
    const research = await work.createArc({ title: "Research: pricing", intent: "An intent", endState: "An end state" });
    await assertCreated(transactions, research, "arc", { title: "Research: pricing" , intent: "An intent", endState: "An end state"});
    await laterThan(research);
    const spike = await work.createArc({ title: "Spike", intent: "An intent", endState: "An end state", description: "Nothing to grow yet", stories: [] });
    await assertCreated(transactions, spike, "arc", { title: "Spike", intent: "An intent", endState: "An end state", description: "Nothing to grow yet", stories: [] });
    await laterThan(spike);

    // Arcs listing the story (one of them lists another story first), created in an order that is
    // not their ids' order; then an arc listing only the other story.
    const launches = await createInOrder(3, (n) =>
      work.createArc({ title: `Launch ${n}`, intent: "An intent", endState: "An end state", stories: n === 1 ? [other.id, story.id] : [story.id] }),
    );
    const both = at(launches, 1);
    await assertCreated(transactions, both, "arc", { title: "Launch 1", intent: "An intent", endState: "An end state", stories: [other.id, story.id] });
    const invite = await work.createArc({ title: "Invite friends", intent: "An intent", endState: "An end state", stories: [other.id] });

    assert.deepEqual(await work.arcsFor(story.id), launches, "every arc listing the story, as stored, in creation order");
    assert.deepEqual(await work.arcsFor(other.id), [both, invite]);
    assert.deepEqual(await work.arcsFor(unlisted.id), [], "a story no arc lists");
    assert.deepEqual(await work.arcsFor(NO_STORY), [], "an id naming no story");

    // The tree lists every arc, in creation order, with the stories each one lists.
    assert.deepEqual((await work.projectTree()).arcs, [
      { id: research.id, title: "Research: pricing", stories: [] },
      { id: spike.id, title: "Spike", description: "Nothing to grow yet", stories: [] },
      ...launches.map((arc, n) => ({ id: arc.id, title: `Launch ${n}`, stories: n === 1 ? [other.id, story.id] : [story.id] })),
      { id: invite.id, title: "Invite friends", stories: [other.id] },
    ]);

    // A retired arc no longer lists anything.
    await records.retire(at(launches, 0).id, "folded into Launch 1");
    assert.deepEqual(await work.arcsFor(story.id), launches.slice(1));

    // An arc's id is the library's own, as every record's is: an id in the input is refused.
    const before = await transactions.history();
    await assert.rejects(work.createArc(untyped({ id: both.id, title: "Replaced?", intent: "An intent", endState: "An end state" })), schemaError("arc", ["id"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("4.3", "a capability naming a missing or retired story is refused, as is a contract naming a missing capability and an arc listing a missing story", async ({ work, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const elsewhere = await work.addStory({ title: "Visitor can sign in" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const contract = await work.addContract({ title: "Rejects a bad email", capability: capability.id });
    const arc = await work.createArc({ title: "Launch v1", intent: "An intent", endState: "An end state", stories: [story.id] });
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
      // An arc listing a story that is missing, retired, or not a story, even among good ones:
      // the first bad one is named.
      [() => work.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [NO_STORY] }), "stories", NO_STORY],
      [() => work.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, retiredStory.id] }), "stories", retiredStory.id],
      [
        () => work.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, elsewhere.id, capability.id, NO_STORY] }),
        "stories",
        capability.id,
        "capability",
      ],
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
      await assert.rejects(work.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, bad] }), schemaError("arc", ["stories"]));
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
    assert.deepEqual(moved, { ...capability, fields: { title: "Email form", story: elsewhere.id }, updatedAt: moved?.updatedAt });
    const second = await work.addCapability({ title: "Password rules", story: elsewhere.id });
    await assertCreated(transactions, second, "capability", { title: "Password rules", story: elsewhere.id });
    const covered = await work.addContract({ title: "Refuses a short password", capability: second.id });
    await assertCreated(transactions, covered, "contract", { title: "Refuses a short password", capability: second.id });
    const launch = await work.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, elsewhere.id] });
    await assertCreated(transactions, launch, "arc", { title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, elsewhere.id] });
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

    // Control: dependencies on live capabilities are kept as given, on a new capability and on an edit.
    const linked = await work.addCapability({ ...link, dependsOn: [form.id, mailer.id] });
    await assertCreated(transactions, linked, "capability", { ...link, dependsOn: [form.id, mailer.id] });
    const none = await work.addCapability({ title: "Welcome email", story: story.id, dependsOn: [] });
    await assertCreated(transactions, none, "capability", { title: "Welcome email", story: story.id, dependsOn: [] });
    const edited = await work.editCapability(form.id, { dependsOn: [mailer.id] });
    assert.deepEqual(edited?.fields, { title: "Email form", story: story.id, dependsOn: [mailer.id] });
    // The tree shows each capability's dependencies as stored (these were created too close
    // together for their order to be the point, so they are compared by id).
    const tree = await work.projectTree();
    assert.deepEqual(
      Object.fromEntries(tree.stories.flatMap((node) => node.capabilities.map(({ id, dependsOn }) => [id, dependsOn]))),
      { [form.id]: [mailer.id], [mailer.id]: [], [linked.id]: [form.id, mailer.id], [none.id]: [] },
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
      assert.deepEqual(await transactions.get(record.id), record, `${record.fields.title} is unchanged`);
    }

    // Control: edits that leave no loop go through. A diamond is not a loop: two paths from W
    // reach X, but nothing leads back to W.
    const x = await add("X");
    const y = await add("Y", [x.id]);
    const z = await add("Z", [x.id]);
    const w = await add("W");
    assert.deepEqual((await work.editCapability(w.id, { dependsOn: [y.id, z.id] }))?.fields.dependsOn, [y.id, z.id]);
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
    const dependsOn = async (id: string) => (await transactions.get(id))?.fields.dependsOn;
    const stored = [await dependsOn(p.id), await dependsOn(q.id)];
    assert.ok(!isDeepStrictEqual(stored, [[q.id], [p.id]]), "no loop was stored: P → Q and Q → P were both written");
    if (first.status === "fulfilled") {
      assert.equal(second.status, "rejected", "both edits were written");
      dependencyLoop([q.id, p.id, q.id])(second.status === "rejected" ? second.reason : undefined);
      assert.deepEqual(stored, [[q.id], undefined]);
    } else {
      assert.equal(second.status, "fulfilled", `both edits were refused: ${String(first.reason)}`);
      dependencyLoop([p.id, q.id, p.id])(first.reason);
      assert.deepEqual(stored, [undefined, [p.id]]);
    }
    assert.equal((await transactions.history()).length, raceStart.length + 1, "one edit was written, and only one");
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
  while (Date.now() <= Date.parse(record.createdAt)) await sleep(1);
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
