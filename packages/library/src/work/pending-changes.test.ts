/**
 * Capability 4 · Work model, its pending plan changes (ADR-0966): one test per contract 4.28-4.35 in the library story
 * (4.36 is in plan-hold.test.ts), each run on BOTH backends, as work-in-flight.test.ts runs capability 10's:
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
import { SchemaError, SchemaRecords, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { WorkInFlight, WorkModel } from "./index.js";

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
  contract("4.28", "an active increment takes a pending change to a story, capability or contract it did not plan, leaving the live record alone; a second change merges; one another open increment holds is refused naming it", async ({ work, flight, records, transactions }) => {
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

  contract("4.29", "an increment's branch reads the plan with its pending changes laid over, every other reader the live plan; a pending change whose record has changed since it was read is named stale with the entry that moved it", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const other = await work.addStory({ title: "Visitor can sign in" });
    const form = await work.addCapability({ title: "Email form", story: story.id, description: "Where they type it" });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id });
    const promise = await work.addContract({ title: "Accepts a valid address", capability: form.id });
    const kept = await work.addContract({ title: "Rejects a bad address", capability: form.id });
    await work.setAnchor({ what: "a shop builder", audience: "small shops" });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    const live = await work.projectTree();
    assert.deepEqual(await flight.withPending(increment.id, live), live, "none pending: the live plan, its anchor kept");
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

  contract("4.30", "pending changes apply through the editors when the increment lands, marked with the pull request; stale or refused ones are parked as residue on its arc; applying again applies nothing twice", async ({ work, flight, records, transactions }) => {
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
    await work.editCapability(link.id, { title: "2 · Emailed link" }, { actor: "session:other" });
    const movedLink = (await transactions.history({ id: link.id, newest: 1 }))[0]!;
    await work.addContract({ title: "1.3 · Planned by another session", capability: form.id });

    const result = await flight.applyPending(increment.id, "#41");
    const edited = (await records.get(form.id)) as SchemaRecord<"capability">;
    assert.deepEqual([edited.fields.title, edited.fields.description], ["1 · Address form", "Where they type it"]);
    assert.equal((await transactions.history({ id: form.id, newest: 1 }))[0]!.reason, `applied at the merge of PR #41 (${increment.id})`);
    assert.equal(await records.get(promise.id), null, "the retirement applied");
    assert.equal(((await records.get(link.id)) as SchemaRecord<"capability">).fields.title, "2 · Emailed link", "a stale change is not applied");
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

  contract("4.30", "a landed close applies the pending changes first; a change already applied under the same mark, as after a crash part-way, counts as applied, not stale", async ({ work, flight, records }) => {
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

  contract("4.30", "a second change pended to a record on top of the increment's own earlier apply applies at the next merge, not counted applied while the record stays as it was", async ({ work, flight, records }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "1 · Email form", story: story.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.pendChange(increment.id, { record: form.id, fields: { title: "1 · Address form" } });
    assert.deepEqual(await flight.applyPending(increment.id, "#145"), { applied: [form.id] });

    await flight.pendChange(increment.id, { record: form.id, fields: { title: "1 · Address and name form" } });
    assert.deepEqual(await flight.stalePending(increment.id), [], "pended on the live record: not stale");
    assert.deepEqual(await flight.applyPending(increment.id, "#184"), { applied: [form.id] });
    assert.equal(((await records.get(form.id)) as SchemaRecord<"capability">).fields.title, "1 · Address and name form", "the second change applied");
  });

  contract("4.34", "an apply cut off part-way, as a hook's deadline cuts it, leaves pending only the changes it had not applied; the gate reads none it applied as stale, and the next apply finishes the rest", async ({ work, flight, records }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "1 · Email form", story: story.id });
    const link = await work.addCapability({ title: "2 · Confirmation link", story: story.id });
    const code = await work.addCapability({ title: "3 · Confirmation code", story: story.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    for (const [id, title] of [[form.id, "1 · Address form"], [link.id, "2 · Link"], [code.id, "3 · Code"]] as const) {
      await flight.pendChange(increment.id, { record: id, fields: { title } });
    }
    // The apply is cut at its second change: that edit never returns, as when a hook's process is killed mid-write.
    let reached!: () => void;
    const cut = new Promise<void>((resolve) => (reached = resolve));
    const cutWork = Object.create(work) as WorkModel;
    cutWork.editCapability = (async (id: string, ...rest: Parameters<WorkModel["editCapability"]> extends [string, ...infer R] ? R : never) => {
      if (id !== link.id) return work.editCapability(id, ...rest);
      reached();
      return new Promise(() => {});
    }) as WorkModel["editCapability"];
    void new WorkInFlight(records, cutWork).applyPending(increment.id, "#145");
    await cut;

    const left = ((await records.get(increment.id)) as SchemaRecord<"increment">).fields.pending?.map(({ record }) => record);
    assert.deepEqual(left, [link.id, code.id], "what it applied no longer reads pending");
    assert.deepEqual(await flight.stalePending(increment.id), [], "the gate finds nothing stale");

    // A change applied whose clearing the cut beat still counts as applied, not stale.
    await records.edit(link.id, { title: "2 · Link" }, { reason: `applied at the merge of PR #145 (${increment.id})` });
    assert.deepEqual(await flight.stalePending(increment.id), [], "applied by its own increment: not stale");

    const rest = await flight.applyPending(increment.id, "#151");
    assert.deepEqual(rest, { applied: [link.id, code.id] });
    assert.equal(((await records.get(code.id)) as SchemaRecord<"capability">).fields.title, "3 · Code");
    assert.equal(((await records.get(increment.id)) as SchemaRecord<"increment">).fields.pending, undefined, "nothing is left pending");
  });

  contract("4.30", "a live write since a pending edit was read stales it only when it moved a field the edit sets: marking the capability built leaves its pending description to apply at the landing", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id, description: "Where they type it" });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.pendChange(increment.id, { record: form.id, fields: { description: "Where they type their address" } });
    await work.setProposed(form.id, false, { actor: "session:same" });
    assert.deepEqual(await flight.stalePending(increment.id), [], "the gate finds nothing stale");

    const result = await flight.applyPending(increment.id, "#7");
    const edited = (await records.get(form.id)) as SchemaRecord<"capability">;
    assert.deepEqual([edited.fields.description, edited.fields.proposed], ["Where they type their address", false], "the edit applied over the built flag, which it left alone");
    assert.deepEqual(result, { applied: [form.id] }, "no residue parked");

    const again = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(again.id, "active");
    await flight.pendChange(again.id, { record: form.id, fields: { description: "Typed here" } });
    await work.editCapability(form.id, { description: "Typed elsewhere" }, { actor: "session:other" });
    const moved = (await transactions.history({ id: form.id, newest: 1 }))[0]!;
    assert.deepEqual((await flight.stalePending(again.id))?.map(({ moved }) => moved.seq), [moved.seq], "a field the edit sets has moved: stale");
    assert.deepEqual((await flight.applyPending(again.id, "#8"))?.residue?.changes.map(({ record }) => record), [form.id]);
    assert.equal(((await records.get(form.id)) as SchemaRecord<"capability">).fields.description, "Typed elsewhere", "never applied over the newer value");
  });

  contract("4.31", "an increment closed failed or withdrawn drops its pending changes, its history saying so, and the live plan is left as it was", async ({ work, flight, records, transactions }) => {
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

  contract("4.33", "an open increment drops one pending change by its record, with a reason, its history saying so and the live plan left as it was; a record it holds no change for, or a closed increment, is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const link = await work.addCapability({ title: "Confirmation link", story: story.id });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");
    await flight.pendChange(increment.id, { record: form.id, fields: { title: "Address form" } });
    await flight.pendChange(increment.id, { record: link.id, retire: "unwanted" });

    const dropped = await flight.dropPending(increment.id, form.id, "overtaken by the plugin's own plan");
    assert.deepEqual(dropped?.fields.pending?.map(({ record }) => record), [link.id], "only that one is dropped");
    assert.match((await transactions.history({ id: increment.id, newest: 1 }))[0]!.reason ?? "", new RegExp(`dropped the pending change to capability ${form.id}: overtaken by the plugin's own plan`));
    assert.deepEqual(await records.get(form.id), form, "the live plan is left as it was");

    const before = await transactions.history();
    await assert.rejects(flight.dropPending(increment.id, form.id, "again"), (error: unknown) => error instanceof RangeError && error.message.includes(form.id), "no change left for it");
    await flight.dropPending(increment.id, link.id, "unwanted after all");
    assert.equal(((await records.get(increment.id)) as SchemaRecord<"increment">).fields.pending, undefined, "the last one leaves none");
    await flight.pendChange(increment.id, { record: link.id, retire: "unwanted" });
    await flight.closeIncrement(increment.id, { note: "landed elsewhere", disposition: "withdrawn" });
    const closed = await transactions.history();
    await assert.rejects(flight.dropPending(increment.id, link.id, "late"), RangeError, "a closed increment");
    assert.deepEqual(await transactions.history(), closed, "nothing was written");
    assert.ok(before.length < closed.length);
    assert.equal(await flight.dropPending("increment_000000000000", form.id, "x"), null);
  });

  contract("4.35", "a pending edit to a plugin's story, capability or contract is refused before it is staged, naming the plugin's plan file, with nothing written, while another story's record still pends", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const plugin = await work.importPluginPlan("voice", {
      story: { title: "Voice" },
      capabilities: [{ title: "1 · The address", proposed: true, contracts: [{ title: "1.1 · A wrong path is answered 404" }] }],
    });
    const [address] = plugin.added.filter((id) => id.startsWith("capability_"));
    const [notFound] = plugin.added.filter((id) => id.startsWith("contract_"));
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(increment.id, "active");

    const before = await transactions.history();
    for (const [record, fields] of [[plugin.story, { description: "Talk by voice" }], [address!, { description: "Where it listens" }], [notFound!, { description: "A typo is answered 404" }]] as const) {
      await assert.rejects(flight.pendChange(increment.id, { record, fields }), (error: unknown) => error instanceof SchemaError && /voice's plan: edit plugins\/voice's plan file/.test(error.message), record);
    }
    assert.deepEqual(await transactions.history(), before, "nothing was written");
    assert.equal(((await records.get(increment.id)) as SchemaRecord<"increment">).fields.pending, undefined, "nothing is pending to drop at a close");

    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const later = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.advanceIncrement(later.id, "active");
    assert.ok(await flight.pendChange(later.id, { record: form.id, fields: { description: "Where they type it" } }), "another story's record still pends");
  });

  contract("4.32", "settling closed increments' leftover pending changes applies those of each that landed and drops those of each that did not, and finds nothing the second time", async ({ work, flight, records, transactions }) => {
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
}
