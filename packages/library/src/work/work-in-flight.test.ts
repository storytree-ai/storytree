/**
 * Capability 10 · Work in flight (ADR-0640): one test per contract 10.1-10.6 in the library story,
 * each run on BOTH backends:
 *
 * - memory: a WorkModel and a WorkInFlight over SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `work` and `flight` of a fresh project on the server `pnpm test` provides,
 *   dropped afterwards, pass or fail.
 *
 * Whether anything was written is judged one layer down, through the project's Transactions: every
 * change appends a history entry (capability 2), so an unchanged history means nothing was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName, withCountedProject } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { LifecycleError, WorkInFlight, WorkModel, type ArcView, type NewIncrement } from "./index.js";

interface Library {
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
    return { work: new WorkModel(records), flight: new WorkInFlight(records), records, transactions, cleanup: async () => {} };
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
      return { work: project.work, flight: project.flight, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const ARC = { title: "Launch v1", intent: "Ship sign-up", endState: "Visitors can sign up" };
const WORK = { title: "Email form", objective: "Build the form", body: "Form, then its checks." };
const TODAY = /^\d{4}-\d{2}-\d{2}$/;

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

  contract("10.1", "an increment belongs to one live arc, created as a proposal with its parked date, or born closed", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const before = Date.now();
    const proposal = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal(proposal.type, "increment");
    assert.equal(proposal.fields.status, "proposal");
    assert.equal(proposal.fields.arc, arc.id);
    assert.ok(Date.parse(proposal.fields.parked ?? "") >= before - 1000, "stamped with when it was parked");
    assert.equal(proposal.fields.outcome, undefined);
    assert.deepEqual(await records.get(proposal.id), proposal);

    const landed = await flight.addIncrement({ arc: arc.id, ...WORK, outcome: { pr: "#12", disposition: "landed" } });
    assert.equal(landed.fields.status, "closed");
    assert.equal(landed.fields.parked, undefined, "born closed, never parked");
    assert.match(landed.fields.outcome?.date ?? "", TODAY);
    assert.deepEqual({ ...landed.fields.outcome, date: undefined }, { date: undefined, pr: "#12", disposition: "landed" });

    // An increment's arc must be a live arc.
    const story = await work.addStory({ title: "Visitor can sign up" });
    const retired = await work.createArc(ARC);
    await records.retire(retired.id, "withdrawn");
    const history = await transactions.history();
    for (const [fields, field] of [
      [{ arc: "arc_000000000000", ...WORK }, "arc"],
      [{ arc: story.id, ...WORK }, "arc"],
      [{ arc: retired.id, ...WORK }, "arc"],
      [{ arc: arc.id, ...WORK, remedies: [story.id] }, "remedies"],
    ] as Array<[NewIncrement, string]>) {
      await assert.rejects(flight.addIncrement(fields), (error: unknown) => error instanceof MissingReferenceError && error.field === field);
    }
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    // The work the arc holds.
    assert.deepEqual((await flight.arcView(arc.id))?.increments.map(({ id }) => id), [proposal.id, landed.id]);
  });

  contract("10.2", "an increment moves only forward, and closing records date, pull request, note and outcome; a close with no pull request needs a note", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await assert.rejects(flight.advanceIncrement(increment.id, "ready" as never), LifecycleError, "there is no ready step (ADR-0909 D4)");
    assert.equal((await flight.advanceIncrement(increment.id, "active"))?.fields.status, "active");

    const history = await transactions.history();
    await assert.rejects(flight.advanceIncrement(increment.id, "proposal" as never), LifecycleError, "never backward");
    await assert.rejects(flight.advanceIncrement(increment.id, "active"), LifecycleError, "never in place");
    await assert.rejects(
      flight.closeIncrement(increment.id, { disposition: "withdrawn" }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("outcome") && error.message.includes('"note"'),
      "a close with no pull request and no note is refused, naming the note it needs",
    );
    await assert.rejects(
      flight.closeIncrement(increment.id, { pr: "#3" } as never),
      (error: unknown) => error instanceof SchemaError && error.message.includes("disposition"),
      "a close says whether it landed, failed or was withdrawn",
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const closed = await flight.closeIncrement(increment.id, { note: "Superseded by the magic link", disposition: "withdrawn" });
    assert.equal(closed?.fields.status, "closed");
    assert.match(closed?.fields.outcome?.date ?? "", TODAY);
    assert.equal(closed?.fields.outcome?.note, "Superseded by the magic link");
    assert.equal(closed?.fields.outcome?.disposition, "withdrawn");
    await assert.rejects(flight.closeIncrement(increment.id, { pr: "#4", disposition: "landed" }), LifecycleError, "closed is final");
    await assert.rejects(flight.advanceIncrement(increment.id, "active"), LifecycleError);

    // Straight from a proposal to closed with a pull request needs no note.
    const other = await flight.addIncrement({ arc: arc.id, ...WORK });
    const merged = await flight.closeIncrement(other.id, { pr: "#5", disposition: "landed" });
    assert.deepEqual({ ...merged?.fields.outcome, date: undefined }, { date: undefined, pr: "#5", disposition: "landed" });
    assert.equal(await flight.closeIncrement("increment_000000000000", { pr: "#6", disposition: "landed" }), null);
  });

  contract("10.2", "a closed outcome can be corrected with a reason kept in history, without reopening it or losing its closure date", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    const landed = { disposition: "landed" as const, pr: "#857" };
    const reason = "Its own pull request merged; withdrawn was recorded by mistake";
    for (const status of ["proposal", "active"] as const) {
      if (status === "active") await flight.advanceIncrement(increment.id, status);
      const before = await transactions.history();
      await assert.rejects(flight.correctIncrementClosure(increment.id, landed, reason), /must be closed/);
      assert.deepEqual(await transactions.history(), before, "correcting open work writes nothing");
    }
    const original = { date: "2026-10-01", disposition: "withdrawn" as const, note: "Mistaken for superseded work" };
    const closed = await flight.closeIncrement(increment.id, original);
    const before = await transactions.history();
    for (const why of [undefined, "", "  \n  "]) {
      await assert.rejects(flight.correctIncrementClosure(increment.id, landed, why as string), /reason/);
    }
    await assert.rejects(flight.correctIncrementClosure(increment.id, { disposition: "failed" }, reason), SchemaError);
    await assert.rejects(flight.correctIncrementClosure(increment.id, { ...landed, disposition: "other" as never }, reason), SchemaError);
    assert.equal(await flight.correctIncrementClosure("increment_000000000000", landed, reason), null);
    assert.equal(await flight.correctIncrementClosure(arc.id, landed, reason), null);
    assert.deepEqual(await transactions.history(), before, "every refused correction leaves history unchanged");

    const corrected = await flight.correctIncrementClosure(increment.id, landed, reason, { actor: "session:correction" });
    assert.deepEqual(corrected?.fields, { ...closed?.fields, outcome: { ...landed, date: original.date } });
    assert.deepEqual(await records.get(increment.id), corrected);
    assert.equal((await flight.arcView(arc.id))?.state, "closed");
    const history = await transactions.history();
    assert.deepEqual(history.slice(0, -1), before, "the original history remains intact");
    assert.equal(history.length, before.length + 1, "one correction is one write");
    assert.equal(history.at(-1)?.reason, reason);
    assert.equal(history.at(-1)?.actor, "session:correction");
    assert.deepEqual(history.at(-1)?.record.fields["outcome"], corrected?.fields.outcome);

    const replacement = { disposition: "failed" as const, date: "2026-10-02", note: "The linked pull request belonged to other work" };
    const revised = await flight.correctIncrementClosure(increment.id, replacement, "Correct the date and remove the unrelated pull request");
    assert.deepEqual(revised?.fields.outcome, replacement, "an explicit date replaces the old one and an omitted PR is removed");
    assert.equal(revised?.fields.status, "closed");
    await assert.rejects(flight.closeIncrement(increment.id, landed), LifecycleError, "correction does not permit a second close");
    await assert.rejects(flight.advanceIncrement(increment.id, "active"), LifecycleError, "correction does not reopen work");
  });

  contract("10.7", "an increment stored as ready, a step ADR-0909 D4 retired, reads as a proposal keeping its parked date, and an edit stores it so", async ({ flight, records, transactions, work }) => {
    const arc = await work.createArc(ARC);
    const parked = "2026-10-01T06:26:04.938Z";
    await transactions.save({ id: "increment-ready", type: "increment", version: 1, fields: { arc: arc.id, ...WORK, status: "ready", parked } });
    const upgraded = await records.get("increment-ready");
    assert.equal(upgraded?.version, SCHEMA_VERSIONS.increment);
    assert.deepEqual(upgraded?.fields, { arc: arc.id, ...WORK, status: "proposal", parked });
    assert.deepEqual((await flight.arcView(arc.id))?.increments.map(({ fields }) => fields.status), ["proposal"]);
    await flight.editIncrement("increment-ready", { title: "Renamed" });
    const stored = await transactions.get("increment-ready");
    assert.equal(stored?.version, SCHEMA_VERSIONS.increment, "an edit stores it upgraded, in place");
    assert.equal(stored?.fields["status"], "proposal");
    assert.equal((await flight.advanceIncrement("increment-ready", "active"))?.fields.status, "active", "claiming it starts it");
  });

  contract("10.11", "an increment carries a capabilities list naming live capabilities only, empty by default and editable after parking, and cites anything else through links; one stored with touches reads them split, and an edit stores it so", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const parked = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal(parked.fields.capabilities, undefined, "parked with the list empty");

    const history = await transactions.history();
    for (const [fields, field] of [
      [{ capabilities: [story.id] }, "capabilities"],
      [{ capabilities: ["capability_000000000000"] }, "capabilities"],
      [{ links: ["decision_000000000000"] }, "links"],
    ] as Array<[{ capabilities?: string[]; links?: string[] }, string]>) {
      await assert.rejects(flight.addIncrement({ arc: arc.id, ...WORK, ...fields }), (error: unknown) => error instanceof MissingReferenceError && error.field === field);
      await assert.rejects(flight.editIncrement(parked.id, fields), (error: unknown) => error instanceof MissingReferenceError && error.field === field);
    }
    await assert.rejects(flight.addIncrement({ arc: arc.id, ...WORK, touches: [capability.id] } as NewIncrement), SchemaError, "touches is retired");
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    await flight.advanceIncrement(parked.id, "active");
    const filled = await flight.editIncrement(parked.id, { capabilities: [capability.id], links: [story.id] });
    assert.deepEqual([filled?.fields.capabilities, filled?.fields.links], [[capability.id], [story.id]], "the claiming session fills it");

    await transactions.save({ id: "increment-touches", type: "increment", version: 2, fields: { arc: arc.id, ...WORK, status: "proposal", parked: "2026-10-01T06:26:04.938Z", touches: [story.id, capability.id] } });
    const upgraded = (await records.get("increment-touches")) as SchemaRecord<"increment"> | null;
    assert.equal(upgraded?.version, 3);
    assert.deepEqual([upgraded?.fields.capabilities, upgraded?.fields.links, (upgraded?.fields as Record<string, unknown>)["touches"]], [[capability.id], [story.id], undefined]);
    await flight.editIncrement("increment-touches", { title: "Renamed" });
    const stored = await transactions.get("increment-touches");
    assert.equal(stored?.version, 3, "an edit stores it upgraded, in place");
    assert.deepEqual([stored?.fields["capabilities"], stored?.fields["links"], stored?.fields["touches"]], [[capability.id], [story.id], undefined]);
  });

  contract("10.12", "an active increment takes a pending change to a story, capability or contract it did not plan, leaving the live record alone; a second change merges; one another open increment holds is refused naming it", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const promise = await work.addContract({ title: "Accepts a valid address", capability: form.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    const other = await flight.addIncrement({ arc: arc.id, ...WORK });
    const latest = async (id: string) => (await transactions.history({ id, newest: 1 }))[0]!.seq;

    const unchanged = await transactions.history();
    await assert.rejects(flight.pendChange(increment.id, { record: form.id, fields: { title: "Sign-up form" } }), RangeError, "a proposal takes none");
    await flight.advanceIncrement(increment.id, "active");
    const planned = await work.addCapability({ title: "Confirmation link", story: story.id });
    const claimed = await transactions.history();
    assert.deepEqual(await flight.pendChange(increment.id, { record: planned.id, fields: { title: "Link" } }), { plannedHere: true }, "one it planned is edited live");
    await assert.rejects(flight.pendChange(increment.id, { record: arc.id, retire: "gone" }), (error: unknown) => error instanceof MissingReferenceError && error.field === "record");
    await assert.rejects(flight.pendChange(increment.id, { record: story.id, fields: { titel: "x" } as never }), SchemaError);
    await assert.rejects(flight.pendChange(increment.id, { record: form.id, fields: { story: "story_000000000000" } }), MissingReferenceError);
    assert.deepEqual(await transactions.history(), claimed, "nothing was written");
    assert.ok(unchanged.length < claimed.length);

    const base = await latest(form.id);
    const first = await flight.pendChange(increment.id, { record: form.id, fields: { title: "Sign-up form", description: "Where they type it" } });
    assert.deepEqual(first, { pending: { record: form.id, type: "capability", base, before: { title: form.fields.title, description: null }, after: { title: "Sign-up form", description: "Where they type it" } } });
    assert.deepEqual(await records.get(form.id), form, "the live record is left alone");
    await work.editCapability(form.id, { description: "Typed by hand" });
    await flight.pendChange(increment.id, { record: form.id, fields: { title: "Address form" } });
    await flight.pendChange(increment.id, { record: promise.id, retire: "overtaken by the address form" });
    await assert.rejects(flight.pendChange(increment.id, { record: promise.id, fields: { title: "x" } }), RangeError, "an edit after a pending retirement");
    assert.deepEqual(((await records.get(increment.id)) as SchemaRecord<"increment"> | null)?.fields.pending, [
      { record: form.id, type: "capability", base, before: { title: form.fields.title, description: null }, after: { title: "Address form", description: "Where they type it" } },
      { record: promise.id, type: "contract", base: await latest(promise.id), retire: "overtaken by the address form" },
    ], "merged: the first base and before stay");

    await flight.advanceIncrement(other.id, "active");
    const held = await transactions.history();
    await assert.rejects(flight.pendChange(other.id, { record: form.id, retire: "unwanted" }), (error: unknown) => error instanceof RangeError && error.message.includes(increment.id));
    assert.deepEqual(await transactions.history(), held, "nothing was written");
    assert.equal(await flight.pendChange("increment_000000000000", { record: form.id, retire: "x" }), null);
  });

  contract("10.14", "an increment's branch reads the plan with its pending changes laid over, every other reader the live plan; a pending change whose record has changed since it was read is named stale with the entry that moved it", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const other = await work.addStory({ title: "Visitor can sign in" });
    const form = await work.addCapability({ title: "Email form", story: story.id, description: "Where they type it" });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id });
    const promise = await work.addContract({ title: "Accepts a valid address", capability: form.id });
    const kept = await work.addContract({ title: "Rejects a bad address", capability: form.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    const live = await work.projectTree();
    assert.deepEqual(await flight.withPending(increment.id, live), live, "none pending: the live plan");
    assert.deepEqual(await flight.stalePending(increment.id), []);

    await flight.pendChange(increment.id, { record: form.id, fields: { title: "Address form", description: undefined, dependsOn: [link.id], story: other.id } });
    await flight.pendChange(increment.id, { record: promise.id, retire: "overtaken" });
    await flight.pendChange(increment.id, { record: kept.id, fields: { capability: link.id } });
    const branch = await flight.withPending(increment.id, live);
    const signUp = branch!.stories.find(({ id }) => id === story.id);
    const signIn = branch!.stories.find(({ id }) => id === other.id);
    assert.deepEqual(signUp!.capabilities.map(({ id, contracts }) => [id, contracts.map(({ id }) => id)]), [[link.id, [kept.id]]], "the form moved out; the kept contract moved to the link");
    assert.deepEqual(signIn!.capabilities.map(({ id, title, description, dependsOn, contracts }) => ({ id, title, description, dependsOn, contracts })), [
      { id: form.id, title: "Address form", description: undefined, dependsOn: [link.id], contracts: [] },
    ], "edited, its description dropped, and its retired contract gone");
    assert.deepEqual(await work.projectTree(), live, "every other reader reads the live plan");
    assert.equal(await flight.withPending("increment_000000000000", live), null);

    assert.deepEqual(await flight.stalePending(increment.id), [], "nothing has moved since");
    const base = (await transactions.history({ id: promise.id, newest: 1 }))[0]!.seq;
    await work.editContract(promise.id, { description: "Typed by another session" }, { actor: "session:other" });
    const moved = (await transactions.history({ id: promise.id, newest: 1 }))[0]!;
    assert.deepEqual(await flight.stalePending(increment.id), [
      { record: promise.id, type: "contract", base, moved: { seq: moved.seq, action: "updated", at: moved.at, actor: "session:other" } },
    ]);
    assert.equal(await flight.stalePending("increment_000000000000"), null);
  });

  contract("10.15", "pending changes apply through the editors when the increment lands, marked with the pull request; stale or refused ones are parked as residue on its arc; applying again applies nothing twice", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "1 · Email form", story: story.id });
    const link = await work.addCapability({ title: "2 · Confirmation link", story: story.id });
    const promise = await work.addContract({ title: "1.1 · Accepts a valid address", capability: form.id });
    const renumbered = await work.addContract({ title: "1.2 · Rejects a bad address", capability: form.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.pendChange(increment.id, { record: form.id, fields: { title: "1 · Address form", description: "Where they type it" } });
    await flight.pendChange(increment.id, { record: promise.id, retire: "overtaken by the address form" });
    await flight.pendChange(increment.id, { record: link.id, fields: { title: "2 · Link" } });
    await flight.pendChange(increment.id, { record: renumbered.id, fields: { title: "1.3 · Rejects a bad address" } });
    await work.editCapability(link.id, { description: "Sent by another session" }, { actor: "session:other" });
    const movedLink = (await transactions.history({ id: link.id, newest: 1 }))[0]!;
    await work.addContract({ title: "1.3 · Planned by another session", capability: form.id });

    const result = await flight.applyPending(increment.id, "#41");
    const edited = (await records.get(form.id)) as SchemaRecord<"capability">;
    assert.deepEqual([edited.fields.title, edited.fields.description], ["1 · Address form", "Where they type it"]);
    assert.equal((await transactions.history({ id: form.id, newest: 1 }))[0]!.reason, `applied at the merge of PR #41 (${increment.id})`);
    assert.equal(await records.get(promise.id), null, "the retirement applied");
    assert.equal(((await records.get(link.id)) as SchemaRecord<"capability">).fields.title, "2 · Confirmation link", "a stale change is not applied");
    assert.equal(((await records.get(renumbered.id)) as SchemaRecord<"contract">).fields.title, "1.2 · Rejects a bad address", "a change the editor refuses is not applied");
    assert.deepEqual(result?.applied, [form.id, promise.id]);
    assert.deepEqual(result?.residue?.changes.map(({ record }) => record), [link.id, renumbered.id]);
    const residue = (await records.get(result!.residue!.increment)) as SchemaRecord<"increment">;
    assert.deepEqual([residue.fields.arc, residue.fields.status], [arc.id, "proposal"]);
    assert.ok(residue.fields.body.includes(link.id) && residue.fields.body.includes(`#${movedLink.seq}`), "names the record and the history entry that moved it");
    assert.ok(residue.fields.body.includes(renumbered.id) && residue.fields.body.includes("1.3"), "names the refused record and why");
    assert.equal(((await records.get(increment.id)) as SchemaRecord<"increment">).fields.pending, undefined, "nothing is left pending");

    const settled = await transactions.history();
    assert.deepEqual(await flight.applyPending(increment.id, "#41"), { applied: [] });
    assert.deepEqual(await transactions.history(), settled, "nothing is applied twice");
    assert.equal(await flight.applyPending("increment_000000000000", "#41"), null);
  });

  contract("10.15", "a landed close applies the pending changes first; a change already applied under the same mark, as after a crash part-way, counts as applied, not stale", async ({ work, flight, records }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.pendChange(increment.id, { record: form.id, fields: { title: "Address form" } });
    await flight.pendChange(increment.id, { record: link.id, fields: { title: "Link" } });
    await records.edit(form.id, { title: "Address form" }, { reason: `applied at the merge of PR #9 (${increment.id})` });

    const closed = await flight.closeIncrement(increment.id, { pr: "#9", disposition: "landed" });
    assert.equal(closed?.fields.status, "closed");
    assert.equal(closed?.fields.pending, undefined);
    assert.equal(((await records.get(link.id)) as SchemaRecord<"capability">).fields.title, "Link");
    assert.equal((await flight.arcView(arc.id))?.increments.length, 1, "no residue: the half-applied change was already applied");
  });

  contract("10.16", "an increment closed failed or withdrawn drops its pending changes, its history saying so, and the live plan is left as it was", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    for (const disposition of ["failed", "withdrawn"] as const) {
      const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
      await flight.advanceIncrement(increment.id, "active");
      await flight.pendChange(increment.id, { record: form.id, retire: "unwanted" });
      const closed = await flight.closeIncrement(increment.id, { note: "did not land", disposition });
      assert.equal(closed?.fields.pending, undefined);
      assert.match((await transactions.history({ id: increment.id, newest: 1 }))[0]!.reason ?? "", /dropped 1 pending plan change/);
      assert.deepEqual(await records.get(form.id), form, "the live plan is left as it was");
    }
  });

  contract("10.17", "settling closed increments' leftover pending changes applies those of each that landed and drops those of each that did not, and finds nothing the second time", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id });
    const landed = await flight.addIncrement({ arc: arc.id, ...WORK });
    const failed = await flight.addIncrement({ arc: arc.id, ...WORK });
    for (const [increment, record] of [[landed, form], [failed, link]] as const) {
      await flight.advanceIncrement(increment.id, "active");
      await flight.pendChange(increment.id, { record: record.id, fields: { title: "Renamed" } });
    }
    // Closed before closing applied or dropped anything: written as the earlier code wrote a close.
    await records.edit(landed.id, { status: "closed", outcome: { date: "2026-10-11", pr: "1130", disposition: "landed" } });
    await records.edit(failed.id, { status: "closed", outcome: { date: "2026-10-11", note: "abandoned", disposition: "failed" } });

    const settled = await flight.settleClosedPending();
    assert.deepEqual(settled.map(({ increment, applied, dropped }) => ({ increment, applied, dropped })).sort((one, two) => one.dropped - two.dropped), [
      { increment: landed.id, applied: [form.id], dropped: 0 },
      { increment: failed.id, applied: [], dropped: 1 },
    ]);
    assert.equal(((await records.get(form.id)) as SchemaRecord<"capability">).fields.title, "Renamed");
    assert.equal((await transactions.history({ id: form.id, newest: 1 }))[0]!.reason, `applied at the merge of PR #1130 (${landed.id})`);
    assert.equal(((await records.get(link.id)) as SchemaRecord<"capability">).fields.title, link.fields.title, "dropped, not applied");
    assert.deepEqual(await flight.settleClosedPending(), []);
  });

  contract("10.9", "an active increment returns to proposal keeping its parked date; a proposal or closed one is refused with nothing written", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    const history = await transactions.history();
    await assert.rejects(flight.returnIncrement(increment.id), LifecycleError, "a proposal is already one");
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    await flight.advanceIncrement(increment.id, "active");
    const returned = await flight.returnIncrement(increment.id);
    assert.equal(returned?.fields.status, "proposal");
    assert.equal(returned?.fields.parked, increment.fields.parked, "keeps the day it was parked");
    assert.equal((await flight.advanceIncrement(increment.id, "active"))?.fields.status, "active", "claiming it starts it again");

    await flight.closeIncrement(increment.id, { pr: "#7", disposition: "landed" });
    const closed = await transactions.history();
    await assert.rejects(flight.returnIncrement(increment.id), LifecycleError, "closed is final");
    assert.deepEqual(await transactions.history(), closed, "nothing was written");
    assert.equal(await flight.returnIncrement("increment_000000000000"), null);
  });

  contract("10.3", "an arc reads closed exactly when none of its increments is open, active otherwise or with none, and parked until unparked", async ({ work, flight, records }) => {
    // (Its other half, "and none of its questions waits on the owner", is proved with capability 12.)
    const arc = await work.createArc(ARC);
    const state = async (): Promise<string | undefined> => (await flight.arcView(arc.id))?.state;
    assert.equal(await state(), "active", "no increments yet");

    const first = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal(await state(), "active");
    await flight.closeIncrement(first.id, { pr: "#1", disposition: "landed" });
    assert.equal(await state(), "closed", "its last increment closed");

    const second = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal(await state(), "active", "work parked on it reopens it");
    await flight.closeIncrement(second.id, { note: "Tried and dropped", disposition: "failed" });
    assert.equal(await state(), "closed", "a failed close is a close");
    assert.equal(Object.hasOwn((await records.get(arc.id))!.fields, "state"), false, "closed and active are worked out, never stored");

    await flight.parkArc(arc.id);
    assert.equal(await state(), "parked");
    await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal(await state(), "parked", "parked until unparked, whatever its work");
    await flight.unparkArc(arc.id);
    assert.equal(await state(), "active");
    assert.equal(await flight.arcView("arc_000000000000"), null);
  });

  contract("10.6", "an arc parked until a day reads parked before that day (UTC midnight) and as if unparked from it on, worked out on read with no write in between", async ({ work, flight }) => {
    const arc = await work.createArc(ARC);
    await flight.parkArc(arc.id, { until: "2026-10-07" });
    const at = async (instant: string) => (await flight.arcView(arc.id, new Date(instant)))?.state;
    assert.equal(await at("2026-10-06T23:59:59Z"), "parked", "before the day");
    assert.equal(await at("2026-10-07T00:00:00Z"), "active", "from the day on, with no write in between");
    assert.equal((await flight.arcView(arc.id))?.arc.fields.parkedUntil, "2026-10-07");

    await flight.parkArc(arc.id);
    assert.equal(await at("2030-01-01T00:00:00Z"), "parked", "a plain park holds until unparked");
    await flight.parkArc(arc.id, { until: "2026-10-07" });
    await flight.unparkArc(arc.id);
    assert.equal(await at("2026-10-01T00:00:00Z"), "active", "unpark clears the day");
    await assert.rejects(flight.parkArc(arc.id, { until: "next week" }));
  });

  contract("10.10", "an arc whose every open increment waits only on a dated event, or on its own work so held, reads parked until the earliest check-back day, worked out on read; free work, an owner wait or an open question keeps it active", async ({ work, flight }) => {
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const arc = await work.createArc(ARC);
    const view = async (instant?: string) => flight.arcView(arc.id, instant === undefined ? undefined : new Date(instant));
    const later = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.addWaitFor(later.id, { releaser: "event", note: "the rollback week ends", checkBack: day(9) });
    const sooner = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.addWaitFor(sooner.id, { releaser: "event", note: "deletion finishes", checkBack: day(4) });
    const after = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.addWait(after.id, sooner.id, "needs the deletion confirmed");
    assert.equal((await view())?.state, "parked", "every open increment waits on a date, directly or through its own arc's work");
    assert.equal((await view())?.wakes, day(4), "it wakes on the earliest check-back day");
    assert.equal((await view())?.arc.fields.parked, undefined, "nothing is stored");
    assert.equal((await view(`${day(4)}T00:00:00Z`))?.state, "active", "from that day it is active again, with no write in between");

    const free = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal((await view())?.state, "active", "free work keeps it on the active board");
    await flight.closeIncrement(free.id, { note: "Not needed", disposition: "withdrawn" });
    assert.equal((await view())?.state, "parked");

    await flight.addWaitFor(later.id, { releaser: "owner", note: "sign in on the staging build" });
    assert.equal((await view())?.state, "active", "an owner wait keeps it active");
    await flight.removeWaitFor(later.id, "owner");
    await flight.advanceIncrement(sooner.id, "active");
    assert.equal((await view())?.state, "active", "claimed work keeps it active");
    await flight.returnIncrement(sooner.id);
    assert.equal((await view())?.state, "parked");

    await flight.raiseQuestion({ arc: arc.id, title: "Archive?", stakes: "Deletes data", statement: "Which?", context: "None", options: "A or B" });
    assert.equal((await view())?.state, "active", "an open question keeps it active");
  });

  contract("7.8", "arcViews() answers every live arc's view as arcView does, in a bounded number of reads whatever the number of arcs", async ({ work, flight, records }) => {
    const arcs = [];
    for (let i = 0; i < 4; i++) {
      const arc = await work.createArc(ARC);
      arcs.push(arc);
      await flight.addIncrement({ arc: arc.id, ...WORK });
    }
    await flight.parkArc(arcs[1]!.id);
    await flight.raiseQuestion({ arc: arcs[2]!.id, title: "Copy?", stakes: "Blocks the form", statement: "Which words?", context: "None yet", options: "Short or long" });
    await records.retire(arcs[3]!.id, "withdrawn");
    const at = new Date();
    const one = await Promise.all(arcs.map(({ id }) => flight.arcView(id, at)));

    let reads = 0;
    for (const method of ["get", "list"] as const) {
      const real = records[method].bind(records) as (...args: unknown[]) => Promise<unknown>;
      (records as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => { reads += 1; return real(...args); };
    }
    const views = await flight.arcViews(at);
    const byId = (list: readonly ArcView[]): ArcView[] => [...list].sort((a, b) => a.arc.id.localeCompare(b.arc.id));
    assert.deepEqual(byId(views), byId(one.filter((view) => view !== null)), "the same views, retired arcs left out");
    assert.ok(reads <= 3, `${reads} reads for ${arcs.length} arcs`);
  });

  contract("10.5", "an increment moves to another live arc keeping its id, lifecycle and waits, the history recording the move and its reason; only open work moving to a closed arc is refused", async ({ work, flight, transactions }) => {
    const from = await work.createArc(ARC);
    const to = await work.createArc(ARC);
    const blocker = await flight.addIncrement({ arc: from.id, ...WORK });
    const increment = await flight.addIncrement({ arc: from.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.addWait(increment.id, blocker.id, "needs the form first");

    const moved = await flight.moveIncrement(increment.id, to.id, "belongs with the launch work", { actor: "agent-m" });
    assert.equal(moved?.id, increment.id, "the same increment, not a copy");
    assert.equal(moved?.fields.arc, to.id);
    assert.equal(moved?.fields.status, "active");
    assert.deepEqual(moved?.fields.waits, [{ on: blocker.id, reason: "needs the form first" }], "its waits survive");
    assert.deepEqual((await flight.arcView(to.id))?.increments.map(({ id }) => id), [increment.id]);
    assert.deepEqual((await flight.arcView(from.id))?.increments.map(({ id }) => id), [blocker.id]);
    const last = (await transactions.history({ id: increment.id })).at(-1);
    assert.equal(last?.reason, "belongs with the launch work", "the history keeps why it moved");
    assert.equal(last?.actor, "agent-m");

    // Completed history can be decomposed without reopening either arc or losing its outcome.
    await flight.closeIncrement(blocker.id, { pr: "#1", disposition: "landed" });
    await flight.closeIncrement(increment.id, { pr: "#2", disposition: "landed" });
    const movedHistory = await flight.moveIncrement(blocker.id, to.id, "split the completed arc", { actor: "owner" });
    assert.equal(movedHistory?.fields.status, "closed");
    assert.deepEqual(movedHistory?.fields.outcome, { date: movedHistory?.fields.outcome?.date, disposition: "landed", pr: "#1" });
    assert.equal((await flight.arcView(from.id))?.state, "active", "an emptied arc is ready for its newly scoped work");
    assert.equal((await flight.arcView(to.id))?.state, "closed", "closed history does not reopen its destination");
    const historyMove = (await transactions.history({ id: blocker.id })).at(-1);
    assert.equal(historyMove?.reason, "split the completed arc");
    assert.equal(historyMove?.actor, "owner");

    const openArc = await work.createArc(ARC);
    const open = await flight.addIncrement({ arc: openArc.id, ...WORK });
    const history = await transactions.history();
    await assert.rejects(flight.moveIncrement(open.id, to.id, "new work"), (error: unknown) => error instanceof RangeError && error.message.includes("closed"));
    await assert.rejects(flight.moveIncrement(increment.id, "arc_000000000000", "nowhere"), MissingReferenceError);
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    assert.equal(await flight.moveIncrement("increment_000000000000", to.id, "ghost"), null);
  });

  contract("10.4", "an arc's intent and end state are required, and an arc written before they were is upgraded to carry them", async ({ work, flight, records, transactions }) => {
    const history = await transactions.history();
    for (const field of ["intent", "endState"] as const) {
      const { [field]: _left, ...without } = ARC;
      await assert.rejects(
        work.createArc(without as never),
        (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
      );
    }
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    // An arc as storytree wrote it before (version 1): a title, a description, and stories.
    await transactions.save({ id: "arc-old", type: "arc", version: 1, fields: { title: "Old arc", description: "Grow sign-up" } });
    const upgraded = await records.get("arc-old");
    assert.equal(upgraded?.version, 2);
    assert.equal((upgraded?.fields as { intent?: string }).intent, "Grow sign-up", "its description was its intent");
    assert.ok(((upgraded?.fields as { endState?: string }).endState ?? "") !== "", "and it carries an end state");
    assert.equal((await flight.arcView("arc-old"))?.state, "active");
    await work.editArc("arc-old", { endState: "Sign-up doubled" });
    assert.equal((await transactions.get("arc-old"))?.version, 2, "an edit stores it upgraded, in place");
  });
}


test("10.8 work reads stay small as unrelated closed history grows, preserving blockers and the arc log", async (t) => {
  await withCountedProject(async ({ work, flight, records, pool }, received) => {
    const arc = await work.createArc(ARC);
    const history = await work.createArc({ ...ARC, title: "History" });
    const empty = await work.createArc({ ...ARC, title: "No increments yet" });
    const waiter = await flight.addIncrement({ ...WORK, arc: arc.id });
    const landed = await flight.addIncrement({ ...WORK, arc: history.id, outcome: { disposition: "landed", pr: "#1", note: "kept" } });
    const failed = await flight.addIncrement({ ...WORK, arc: history.id, outcome: { disposition: "failed", note: "failed" } });
    await flight.addWait(waiter.id, landed.id, "landed blocker");
    await flight.addWait(waiter.id, failed.id, "failed blocker");
    await flight.addWait(arc.id, history.id, "closed arc releases");
    await flight.addWait(arc.id, empty.id, "empty arc still holds");
    const logged = await flight.addIncrement({ ...WORK, arc: arc.id, outcome: { disposition: "landed", date: "2026-10-01", pr: "#7", note: "whole log" } });
    const expected = [{ on: failed.id, reason: "failed blocker", forGood: true }, { on: empty.id, reason: "empty arc still holds", forGood: false }];
    const readings = {
      holds: async () => { assert.deepEqual((await flight.holds()).waits[waiter.id], expected); },
      waitHolds: async () => { assert.deepEqual(await flight.waitHolds(waiter.id), expected); },
      arcView: async () => {
        const view = await flight.arcView(arc.id);
        assert.deepEqual(view?.increments.find(({ id }) => id === logged.id), logged, "the closed log keeps every field");
        assert.deepEqual(view?.increments.map(({ id }) => id).sort(), [waiter.id, logged.id].sort());
      },
    };
    const measure = async (read: () => Promise<void>) => { const before = received(); await read(); return received() - before; };
    const small = new Map<string, number>();
    for (const [name, read] of Object.entries(readings)) small.set(name, await measure(read));
    // Hundreds of old increments and settled questions, with long bodies and outcome notes.
    // No shared project is touched; seed traffic is outside the measured reads.
    await pool.query(`INSERT INTO record (id, type, version, fields, created_at, updated_at)
      SELECT 'old-' || g, 'increment', 2,
        jsonb_build_object('arc', $1::text, 'status', 'closed', 'title', 'Old work', 'objective', repeat('o', 1000),
          'body', repeat('b', 8000), 'outcome', jsonb_build_object('disposition', 'landed', 'date', '2026-10-01', 'note', repeat('n', 4000))), now(), now()
      FROM generate_series(1, 700) g`, [history.id]);
    await pool.query(`INSERT INTO record (id, type, version, fields, created_at, updated_at)
      SELECT 'old-question-' || g, 'question', 1,
        jsonb_build_object('arc', $1::text, 'lifecycle', 'settled', 'title', 'Answered', 'stakes', 'Old work', 'statement', 'Which?',
          'options', 'A or B', 'answer', 'A', 'settledAt', '2026-10-01T00:00:00Z', 'context', repeat('q', 8000)), now(), now()
      FROM generate_series(1, 100) g`, [history.id]);
    const large = new Map<string, number>();
    for (const [name, read] of Object.entries(readings)) {
      const bytes = await measure(read);
      large.set(name, bytes);
      t.diagnostic(`${name}: few=${small.get(name)} bytes; many=${bytes} bytes`);
    }
    for (const [name, bytes] of large) assert.ok(bytes <= small.get(name)! + 128 * 1024, `${name} grew from ${small.get(name)} to ${bytes} bytes`);
    const question = await flight.raiseQuestion({ arc: history.id, title: "Still needed?", stakes: "Keeps arc open", statement: "Which?", context: "Context", options: "A or B" });
    assert.ok((await flight.waitHolds(waiter.id)).some(({ on }) => on === history.id), "a closed-work arc with an open question holds");
    await flight.settleQuestion(question.id, { answer: "A" });
    // Settling its last question closed the arc and cleared the wait on it (11.8): written again, a parked arc holds.
    await flight.addWait(arc.id, history.id, "closed arc releases");
    await flight.parkArc(history.id);
    assert.ok((await flight.waitHolds(waiter.id)).some(({ on }) => on === history.id), "a parked arc holds");
    await flight.unparkArc(history.id);
    await records.retire(failed.id, "removed");
    assert.deepEqual(await flight.waitHolds(waiter.id), expected, "a missing blocker still holds for good");
  });
});
