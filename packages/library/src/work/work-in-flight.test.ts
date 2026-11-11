/**
 * Capability 10 · Work in flight (ADR-0640): one test per contract of 10 in the library story,
 * its pending plan changes now capability 4's (pending-changes.test.ts), and 6.18 and 6.19, Knowledge
 * artifacts' move of the friction a close remedies, pinned here through the close that runs it,
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

import { waitUntil } from "@storytree/test-waits";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SCHEMA_VERSIONS, SchemaError, SchemaRecords, type SchemaRecord } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName, withCountedProject } from "../testing/pg.js";
import { HealthRecord } from "../health/index.js";
import { Knowledge } from "../knowledge/index.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { LifecycleError, WaitLoopError, WorkInFlight, WorkModel, type ArcView, type NewIncrement } from "./index.js";

interface Library {
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly health: HealthRecord;
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
    return { work, flight, health: new HealthRecord(records, work, flight), records, transactions, cleanup: async () => {} };
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
      return { work: project.work, flight: project.flight, health: project.health, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const ARC = { title: "Launch v1", intent: "Ship sign-up", endState: "Visitors can sign up" };
const WORK = { title: "Email form", objective: "Build the form", body: "Form, then its checks." };
const TODAY = /^\d{4}-\d{2}-\d{2}$/;
/** An arc's and an increment's required fields but their titles, for tests that name each one. */
const BARE_ARC = { intent: "An intent", endState: "An end state" };
const BARE_WORK = { objective: "Do it", body: "The steps." };
const ASK = {
  title: "Which mailer?",
  stakes: "Sign-up cannot send its confirmation until this is chosen",
  statement: "Which mail service sends the confirmation?",
  context: "Two are in reach; neither is set up",
  options: "Mailgun (simplest API) or SES (cheapest)",
};

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
    const arc = await flight.createArc(ARC);
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
    const retired = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    assert.deepEqual(corrected?.fields, { ...closed?.fields, outcome: { ...landed, date: original.date }, escape: "none" });
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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


  contract("10.9", "an active increment returns to proposal keeping its parked date; a proposal or closed one is refused with nothing written", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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

    await flight.addWaitFor(later.id, { releaser: "owner", note: "sign in on the staging build", why: "it unblocks the work" });
    assert.equal((await view())?.state, "active", "an owner wait keeps it active");
    await flight.removeWaitFor(later.id, "owner");
    await flight.advanceIncrement(sooner.id, "active");
    assert.equal((await view())?.state, "active", "claimed work keeps it active");
    await flight.returnIncrement(sooner.id);
    assert.equal((await view())?.state, "parked");

    await flight.raiseQuestion({ arc: arc.id, title: "Archive?", stakes: "Deletes data", statement: "Which?", context: "None", options: "A or B" });
    assert.equal((await view())?.state, "active", "an open question keeps it active");
  });

  contract("10.18", "a capability is parked when open increments name it and every one sits on a parked arc and asks nothing of the owner, with those arcs; an open increment on an active arc, an owner wait or an open held-on question leaves it out", async ({ work, flight }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const [form, mail, lone] = await Promise.all(["Email form", "Mail", "Lone"].map((title) => work.addCapability({ title, story: story.id })));
    const shelved = await flight.createArc({ ...ARC, title: "Shelved" });
    const later = await flight.createArc({ ...ARC, title: "Later" });
    const live = await flight.createArc({ ...ARC, title: "Live" });
    await flight.parkArc(shelved.id);
    await flight.addIncrement({ arc: shelved.id, ...WORK, capabilities: [form!.id, mail!.id] });
    // A second open increment on one capability is listed by an edit, since parking it would be refused (10.35).
    const dated = await flight.addIncrement({ arc: later.id, ...WORK });
    await flight.editIncrement(dated.id, { capabilities: [form!.id] });
    await flight.addWaitFor(dated.id, { releaser: "event", note: "deletion finishes", checkBack: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10) });
    const parked = async () => Object.fromEntries([...(await flight.parkedCapabilities()).entries()].map(([id, arcs]) => [id, arcs.map(({ title }) => title).sort()]));
    assert.deepEqual(await parked(), { [form!.id]: ["Later", "Shelved"], [mail!.id]: ["Shelved"] }, "parked by the owner, or asleep on a dated event; one no open increment names is not parked");

    const now = await flight.addIncrement({ arc: live.id, ...WORK });
    await flight.editIncrement(now.id, { capabilities: [mail!.id] });
    assert.deepEqual(Object.keys(await parked()), [form!.id], "an open increment on an active arc keeps it out");
    await flight.closeIncrement(now.id, { note: "Not needed", disposition: "withdrawn" });
    assert.deepEqual(Object.keys(await parked()).sort(), [form!.id, mail!.id].sort(), "a closed one names nothing");

    await flight.addWaitFor(dated.id, { releaser: "owner", note: "sign in on the staging build", why: "it unblocks the work" });
    assert.deepEqual(Object.keys(await parked()), [mail!.id], "an owner wait keeps it out");
    await flight.removeWaitFor(dated.id, "owner");
    const shelf = (await flight.arcView(shelved.id))!.increments[0]!;
    const question = await flight.raiseQuestion({ arc: live.id, title: "Archive?", stakes: "Deletes data", statement: "Which?", context: "None", options: "A or B" });
    await flight.editIncrement(shelf.id, { heldOn: [question.id] });
    assert.deepEqual(Object.keys(await parked()), [], "an open held-on question keeps both out");
    await flight.settleQuestion(question.id, { answer: "A" });
    assert.deepEqual(Object.keys(await parked()).sort(), [form!.id, mail!.id].sort(), "once settled it asks nothing");
    assert.equal(lone!.id in (await parked()), false);
  });

  /** File one friction report through the library's own door, judged as given. */
  const report = async (records: SchemaRecords, judgement: Record<string, string> = {}): Promise<string> => {
    const knowledge = new Knowledge(records);
    const filed = await knowledge.writeKnowledge("friction", { title: "The seed refused", description: "One line", statement: "It refused", evidence: "`pnpm seed` exit code 1", impact: "The seed waits" });
    if (Object.keys(judgement).length > 0) await knowledge.editNote(filed.id, judgement);
    return filed.id;
  };
  const frictionOf = async (records: SchemaRecords, id: string): Promise<Record<string, unknown>> => ((await records.get(id))?.fields ?? {}) as Record<string, unknown>;

  contract("6.18", "closing an increment as landed resolves each friction in its remedies, stamped with its pull request or else the increment, and a closure corrected to landed does the same", async ({ work, flight, records }) => {
    const arc = await flight.createArc(ARC);
    const routed = await report(records, { route: "tool", routeReason: "Build the verb" });
    const unjudged = await report(records);
    const dismissed = await report(records, { route: "nothing", routeReason: "A one-off" });
    const untouched = await report(records, { route: "tool", routeReason: "Another fix" });
    const fix = await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [routed, unjudged, dismissed] });
    await flight.closeIncrement(fix.id, { pr: "1290", disposition: "landed" });
    for (const id of [routed, unjudged, dismissed]) {
      const fields = await frictionOf(records, id);
      assert.deepEqual([fields["state"], fields["dischargedBy"]], ["resolved", "#1290"], `${id} is resolved, stamped with the pull request`);
    }
    assert.equal((await frictionOf(records, untouched))["state"], "routed", "a report it does not remedy is left");

    const noted = await report(records, { route: "process", routeReason: "Write it down" });
    const quiet = await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [noted] });
    await flight.closeIncrement(quiet.id, { note: "Landed with the docs", disposition: "landed" });
    assert.deepEqual([(await frictionOf(records, noted))["state"], (await frictionOf(records, noted))["dischargedBy"]], ["resolved", quiet.id], "with no pull request the increment is the stamp");

    const late = await report(records, { route: "adr", routeReason: "Decide it" });
    const misread = await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [late] });
    await flight.closeIncrement(misread.id, { note: "Thought it failed", disposition: "failed" });
    await flight.correctIncrementClosure(misread.id, { pr: "#77", disposition: "landed" }, "It landed after all");
    assert.deepEqual([(await frictionOf(records, late))["state"], (await frictionOf(records, late))["dischargedBy"]], ["resolved", "#77"], "a closure corrected to landed resolves it");
  });

  contract("6.19", "closing an increment failed or withdrawn reopens each friction it left routed unless another open increment remedies it, and a closure corrected from landed reopens those it resolved", async ({ work, flight, records }) => {
    const arc = await flight.createArc(ARC);
    for (const disposition of ["failed", "withdrawn"] as const) {
      const owed = await report(records, { route: "tool", routeReason: "Build the verb" });
      const shared = await report(records, { route: "tool", routeReason: "Build the other verb" });
      const settled = await report(records, { route: "process", routeReason: "Fixed already", dischargedBy: "#3" });
      await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [shared] });
      const attempt = await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [owed, shared, settled] });
      await flight.closeIncrement(attempt.id, { note: "It did not work", disposition });
      const reopened = await frictionOf(records, owed);
      assert.deepEqual([reopened["state"], reopened["route"], reopened["routeReason"]], ["open", undefined, undefined], `closed ${disposition}, its remedy owed is back in the drain`);
      assert.deepEqual([(await frictionOf(records, shared))["state"], (await frictionOf(records, shared))["route"]], ["routed", "tool"], "another open increment still remedies it");
      assert.deepEqual([(await frictionOf(records, settled))["state"], (await frictionOf(records, settled))["dischargedBy"]], ["resolved", "#3"], "a report already resolved stays so");
    }

    const resolved = await report(records, { route: "tool", routeReason: "Build it" });
    const elsewhere = await report(records, { route: "tool", routeReason: "Built elsewhere", dischargedBy: "#5" });
    const wrong = await flight.addIncrement({ arc: arc.id, ...WORK, remedies: [resolved, elsewhere] });
    await flight.closeIncrement(wrong.id, { pr: "#40", disposition: "landed" });
    await flight.correctIncrementClosure(wrong.id, { note: "Reverted", disposition: "failed" }, "It was reverted");
    const back = await frictionOf(records, resolved);
    assert.deepEqual([back["state"], back["dischargedBy"], back["route"]], ["open", undefined, undefined], "a closure corrected from landed reopens what it resolved");
    assert.deepEqual([(await frictionOf(records, elsewhere))["state"], (await frictionOf(records, elsewhere))["dischargedBy"]], ["resolved", "#5"], "one another landing stamped stays resolved");
  });

  contract("10.19", "an increment may name the one machine that can take it: parked with it, edited to another, and cleared by an edit that removes the field; an empty name is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK, machine: "laptop" });
    assert.equal(increment.fields.machine, "laptop");
    assert.equal((await flight.addIncrement({ arc: arc.id, ...WORK })).fields.machine, undefined, "none named, any machine");
    assert.equal((await flight.editIncrement(increment.id, { machine: "mint" }))?.fields.machine, "mint");
    const history = await transactions.history();
    await assert.rejects(flight.editIncrement(increment.id, { machine: "" }), SchemaError);
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    const cleared = await flight.editIncrement(increment.id, { machine: undefined });
    assert.equal("machine" in (cleared?.fields ?? {}), false, "cleared, it names no machine");
    assert.deepEqual((await records.get(increment.id))?.fields, cleared?.fields);
  });

  contract("10.23", "an increment names the escape it fixes: the pull request or increment that caused it and the story it hit, a pull request also by its merge commit, so a number either repository history could hold names one change; set by parking or editing and cleared by an edit; a cause, commit or story that is not one, or a pull request without its commit, is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const culprit = await flight.addIncrement({ arc: arc.id, ...WORK });
    const fix = await flight.addIncrement({ arc: arc.id, ...WORK, escape: { causedBy: "#1234", commit: "9807a1e", story: story.id } });
    assert.deepEqual(fix.fields.escape, { causedBy: "#1234", commit: "9807a1e", story: story.id });
    assert.deepEqual((await flight.editIncrement(fix.id, { escape: { causedBy: culprit.id, story: story.id } }))?.fields.escape, { causedBy: culprit.id, story: story.id });
    const history = await transactions.history();
    for (const escape of [{ causedBy: "last week", story: story.id }, { causedBy: "#", story: story.id }, { causedBy: story.id, story: story.id }, { causedBy: "#9", story: story.id }, { causedBy: "9", story: story.id }, { causedBy: "#9", commit: "not-hex", story: story.id }, { causedBy: "#9", commit: "abc12", story: story.id }]) {
      await assert.rejects(flight.editIncrement(fix.id, { escape }), SchemaError);
    }
    for (const [escape, field] of [[{ causedBy: "increment_000000000000", story: story.id }, "escape.causedBy"], [{ causedBy: "#9", commit: "415afe5", story: culprit.id }, "escape.story"]] as const) {
      await assert.rejects(flight.editIncrement(fix.id, { escape }), (error: unknown) => error instanceof MissingReferenceError && error.field === field);
    }
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    await records.edit(fix.id, { escape: { causedBy: "#2", story: story.id } });
    assert.deepEqual((await flight.editIncrement(fix.id, { title: "Mend sign-up" }))?.fields.escape, { causedBy: "#2", story: story.id }, "one recorded before commits were asked for stays readable and editable");
    const cleared = await flight.editIncrement(fix.id, { escape: undefined });
    assert.equal("escape" in (cleared?.fields ?? {}), false, "cleared, it names no escape");
    assert.deepEqual((await records.get(fix.id))?.fields, cleared?.fields);
  });

  contract("10.41", "an escape keeps the story it hit after that story is retired: an edit naming the story the escape already records is accepted, so its commit can still be added, while naming any other story that is not live is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const moved = await work.addStory({ title: "Code review" });
    const other = await work.addStory({ title: "Website" });
    const fix = await flight.addIncrement({ arc: arc.id, ...WORK });
    await records.edit(fix.id, { escape: { causedBy: "#1803", story: moved.id } });
    await records.retire(moved.id, "moved into a plugin");
    await records.retire(other.id, "moved to another project");
    const history = await transactions.history();
    await assert.rejects(flight.editIncrement(fix.id, { escape: { causedBy: "#1803", commit: "125330d", story: other.id } }), (error: unknown) => error instanceof MissingReferenceError && error.field === "escape.story");
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    const corrected = await flight.editIncrement(fix.id, { escape: { causedBy: "#1803", commit: "125330d", story: moved.id } });
    assert.deepEqual(corrected?.fields.escape, { causedBy: "#1803", commit: "125330d", story: moved.id });
    assert.deepEqual(((await records.get(fix.id))?.fields as { escape?: unknown }).escape, corrected?.fields.escape);
  });

  contract("10.42", "an increment from the owner's answer, landed with a note and no pull request, records an FYI of what it found, so it is offered to him until heard; one with a pull request, not landed, or not from his answer records none", async ({ flight, transactions }) => {
    const fyis = async () => (await transactions.list("fyi")).map(({ fields }) => fields);
    const arc = await flight.createArc(ARC);
    const findings = "Findings: all junk, no real change.";
    const check = await flight.addIncrement({ arc: arc.id, ...BARE_WORK, title: "Check main", body: "From a voice note (note voice.note_c8ff1fd5c25c)." });
    await flight.closeIncrement(check.id, { note: findings, disposition: "landed" }, { actor: "session:lane" });
    const [fyi, ...more] = await fyis();
    assert.deepEqual(more, []);
    assert.deepEqual({ ...fyi, at: undefined }, { title: "What your answer found: Check main", what: findings, about: check.id, by: "session:lane", at: undefined }, "it carries the findings, about the increment, unheard");

    const settled = await flight.addIncrement({ arc: arc.id, ...BARE_WORK, title: "Settled check", body: "Settled on question_0dd10e796878 (option A)." });
    await flight.closeIncrement(settled.id, { note: "Nothing found", disposition: "landed" });
    const born = await flight.addIncrement({ arc: arc.id, ...BARE_WORK, title: "Born closed", body: "From voice.note_aee6429a7a68.", outcome: { note: "Done by hand", disposition: "landed" } });
    assert.deepEqual((await fyis()).map(({ about }) => about).sort(), [check.id, settled.id, born.id].sort(), "a question he settled, or work recorded already closed, counts too");

    const built = await flight.addIncrement({ arc: arc.id, ...BARE_WORK, title: "Built", body: "From voice.note_c8ff1fd5c25c." });
    await flight.closeIncrement(built.id, { pr: "#9", note: "Built it", disposition: "landed" });
    const dropped = await flight.addIncrement({ arc: arc.id, ...BARE_WORK, title: "Dropped", body: "From voice.note_c8ff1fd5c25c." });
    await flight.closeIncrement(dropped.id, { note: "Overtaken", disposition: "withdrawn" });
    const plain = await flight.addIncrement({ arc: arc.id, ...WORK });
    await flight.closeIncrement(plain.id, { note: "Checked", disposition: "landed" });
    assert.equal((await fyis()).length, 3, "a pull request shows it, a close that did not land found nothing, and other work is not his answer");
  });

  contract("10.30", "a landed increment says whether it fixed an escape: one naming none is recorded as fixing none when it lands, closed or parked closed, while one naming its escape keeps it and a close that does not land says nothing", async ({ work, flight, records }) => {
    const arc = await flight.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const plain = await flight.addIncrement({ arc: arc.id, ...WORK });
    assert.equal((await flight.closeIncrement(plain.id, { pr: "#5", disposition: "landed" }))?.fields.escape, "none");
    assert.equal(((await records.get(plain.id))?.fields as { escape?: unknown }).escape, "none");
    const fix = await flight.addIncrement({ arc: arc.id, ...WORK, escape: { causedBy: "#4", commit: "415afe5", story: story.id } });
    assert.deepEqual((await flight.closeIncrement(fix.id, { pr: "#6", disposition: "landed" }))?.fields.escape, { causedBy: "#4", commit: "415afe5", story: story.id });
    const born = await flight.addIncrement({ arc: arc.id, ...WORK, outcome: { pr: "#7", disposition: "landed" } });
    assert.equal(born.fields.escape, "none");
    const dropped = await flight.addIncrement({ arc: arc.id, ...WORK });
    const withdrawn = await flight.closeIncrement(dropped.id, { note: "Overtaken", disposition: "withdrawn" });
    assert.equal("escape" in (withdrawn?.fields ?? {}), false, "work that did not land answers nothing");
    const relanded = await flight.correctIncrementClosure(dropped.id, { pr: "#8", disposition: "landed" }, "It landed after all");
    assert.equal(relanded?.fields.escape, "none", "a closure corrected to landed answers as a landing does");
    assert.equal(((await records.get(dropped.id))?.fields as { escape?: unknown }).escape, "none");
    const unlanded = await flight.correctIncrementClosure(dropped.id, { note: "Reverted", disposition: "failed" }, "It was reverted");
    assert.equal("escape" in (unlanded?.fields ?? {}), false, "corrected away from landed, it answers nothing again");
    const refixed = await flight.correctIncrementClosure(fix.id, { note: "Reverted", disposition: "failed" }, "It was reverted");
    assert.deepEqual(refixed?.fields.escape, { causedBy: "#4", commit: "415afe5", story: story.id }, "a named escape is kept");
  });

  contract("10.24", "an increment carries a risk line: its tier, rating, depth, radius, depth flags, the stories it touches and the day read, set and cleared by an edit; a tier, number or day out of range, or a story that is not one, is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    const risk = { tier: "high" as const, rating: 8, depth: 3, radius: 2, flags: ["destructive schema"], stories: [story.id], read: "2026-10-23" };
    assert.deepEqual((await flight.editIncrement(increment.id, { risk }))?.fields.risk, risk);
    const history = await transactions.history();
    for (const bad of [{ ...risk, tier: "severe" }, { ...risk, rating: 11 }, { ...risk, depth: 0 }, { ...risk, radius: 5 }, { ...risk, read: "today" }, { ...risk, flags: [""] }]) {
      await assert.rejects(flight.editIncrement(increment.id, { risk: bad as never }), SchemaError, JSON.stringify(bad));
    }
    await assert.rejects(flight.editIncrement(increment.id, { risk: { ...risk, stories: [increment.id] } }), (error: unknown) => error instanceof MissingReferenceError && error.field === "risk.stories");
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    const cleared = await flight.editIncrement(increment.id, { risk: undefined });
    assert.equal("risk" in (cleared?.fields ?? {}), false, "cleared, it carries no risk line");
    assert.deepEqual((await records.get(increment.id))?.fields, cleared?.fields);
  });

  contract("10.25", "an increment is parked already waiting for the owner, its note written in the parking's one write, so it is never open work without the wait; a wait the owner wait rules refuse, two for one releaser, or one on an increment born closed is refused with nothing written", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc(ARC);
    const before = await transactions.history();
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const waitsFor of [
      [{ releaser: "owner" as const, note: "run it", why: "it unblocks the work", checkBack: day }],
      [{ releaser: "event" as const, note: "the next release" }],
      [{ releaser: "owner" as const, note: "one", why: "it unblocks the work" }, { releaser: "owner" as const, note: "two", why: "it unblocks the work" }],
    ]) {
      await assert.rejects(flight.addIncrement({ arc: arc.id, ...WORK, waitsFor }), RangeError, JSON.stringify(waitsFor));
    }
    await assert.rejects(flight.addIncrement({ arc: arc.id, ...WORK, waitsFor: [{ releaser: "owner", note: "run it", why: "it unblocks the work" }], outcome: { pr: "#1", disposition: "landed" } }), RangeError, "a closed increment waits for nothing");
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    const install = await flight.addIncrement({ arc: arc.id, ...WORK, waitsFor: [{ releaser: "owner", note: "run the install on the old laptop", why: "it unblocks the work" }] });
    assert.equal((await transactions.history()).length, before.length + 1, "parked and waiting in one write");
    const owner = { releaser: "owner", note: "run the install on the old laptop", why: "it unblocks the work", reviewed: new Date().toISOString().slice(0, 10), holds: true };
    assert.deepEqual(await flight.waitsFor(install.id), [owner]);
    assert.deepEqual((await flight.holds()).waitsFor?.[install.id], [owner], "the pool and the claim read it from the start");
    await flight.removeWaitFor(install.id, "owner");
    assert.deepEqual(await flight.waitsFor(install.id), [], "cleared as any owner wait is");
  });

  contract("7.8", "arcViews() answers every live arc's view as arcView does, in a bounded number of reads whatever the number of arcs", async ({ work, flight, records }) => {
    const arcs = [];
    for (let i = 0; i < 4; i++) {
      const arc = await flight.createArc(ARC);
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

  contract("10.22", "the board's arcs: live arcs whole plus closed arcs whose closing day falls in a window, and closed arcs alone by a window, each with its closing day and only the increment fields the board draws", async ({ work, flight, records }) => {
    const closedOn = async (...days: string[]) => {
      const arc = await flight.createArc(ARC);
      for (const date of days) {
        const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
        await flight.closeIncrement(increment.id, { pr: "#1", disposition: "landed", date });
      }
      return arc.id;
    };
    const active = await flight.createArc(ARC);
    const cited = await work.addStory({ title: "Visitor can sign up" });
    await flight.addIncrement({ arc: active.id, ...WORK, machine: "laptop", links: [cited.id] });
    const parked = await flight.createArc(ARC);
    await flight.parkArc(parked.id, { until: "2999-01-01" });
    const old = await closedOn("2026-10-01");
    const yesterday = await closedOn("2026-10-02", "2026-10-18");
    const today = await closedOn("2026-10-19");
    const at = new Date("2026-10-19T12:00:00Z");

    let reads = 0;
    for (const method of ["get", "list", "select"] as const) {
      const real = records[method].bind(records) as (...args: unknown[]) => Promise<unknown>;
      (records as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => { reads += 1; return real(...args); };
    }
    const board = await flight.boardArcs({ from: "2026-10-18", to: "2026-10-20" }, at);
    assert.ok(reads <= 6, `${reads} reads`);
    // Arcs made in one millisecond have no creation order, so each is found by its id.
    const byId = new Map(board.map((view) => [view.arc.id, view]));
    assert.deepEqual([...byId.keys()].sort(), [active.id, parked.id, yesterday, today].sort(), "live arcs, and those closed in the window by their last close");
    assert.deepEqual([active.id, parked.id, yesterday, today].map((id) => byId.get(id)!.state), ["active", "parked", "closed", "closed"]);
    assert.deepEqual([active.id, parked.id, yesterday, today].map((id) => byId.get(id)!.closed), [undefined, undefined, "2026-10-18", "2026-10-19"], "a closed arc's closing day is its latest outcome day");
    assert.equal(byId.get(parked.id)!.wakes, "2999-01-01", "a dated park keeps its wake day");
    const increment = byId.get(active.id)!.increments[0]!;
    assert.equal(increment.fields.title, WORK.title);
    assert.equal(increment.fields.objective, WORK.objective);
    assert.equal(increment.fields.machine, "laptop", "the machine it is tagged to, which its ready chip names");
    assert.deepEqual(increment.fields.links, [cited.id], "what it cites, whose edge contracts ring their gates on the map");
    assert.equal("body" in increment.fields, false, "no increment's planning body is read");

    const week = await flight.closedArcs({ from: "2026-10-01", to: "2026-10-19" }, at);
    assert.deepEqual(week.map(({ arc }) => arc.id).sort(), [old, yesterday].sort(), "only closed arcs, the window's end left out");
    assert.deepEqual(week.find(({ arc }) => arc.id === yesterday)!.increments.map(({ fields }) => fields.outcome?.date).sort(), ["2026-10-02", "2026-10-18"], "a closed arc carries every increment it closed with");
  });

  contract("10.43", "a work survey reads every live arc's state as arcViews does, its open questions counted and, unless closed, its title and priority; only open increments (and closed ones asked for by id) with the fields a dispatcher decides on, never a body; and the holds as holds() reads them", async ({ work, flight }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ title: "Email form", story: story.id });
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const empty = await flight.createArc({ ...ARC, title: "Empty" });
    const drained = await flight.createArc({ ...ARC, title: "Drained" });
    const done = await flight.addIncrement({ arc: drained.id, ...WORK });
    await flight.closeIncrement(done.id, { pr: "#1", disposition: "landed" });
    const parked = await flight.createArc({ ...ARC, title: "Parked" });
    await flight.parkArc(parked.id, { until: "2999-01-01" });
    const live = await flight.createArc({ ...ARC, title: "Live", priority: 2 });
    const open = await flight.addIncrement({ arc: live.id, ...WORK, body: "x".repeat(5000), capabilities: [form.id], machine: "box" });
    const landed = await flight.addIncrement({ arc: live.id, ...WORK });
    await flight.closeIncrement(landed.id, { pr: "#2", disposition: "landed" });
    const asleep = await flight.createArc({ ...ARC, title: "Asleep" });
    const first = await flight.addIncrement({ arc: asleep.id, ...WORK });
    await flight.closeIncrement(first.id, { pr: "#3", disposition: "landed" });
    const dated = await flight.addIncrement({ arc: asleep.id, ...WORK });
    await flight.addWaitFor(dated.id, { releaser: "event", note: "deletion finishes", checkBack: day(4) });
    // Its other open work waits on its own landed work and is held on a settled question: still asleep, as arcViews reads it.
    const after = await flight.addIncrement({ arc: asleep.id, ...WORK });
    await flight.addWaitFor(after.id, { releaser: "event", note: "the week ends", checkBack: day(9) });
    await flight.addWait(after.id, dated.id, "needs the deletion");
    const settled = await flight.raiseQuestion({ arc: asleep.id, ...ASK });
    await flight.editIncrement(after.id, { heldOn: [settled.id] });
    await flight.settleQuestion(settled.id, { answer: "Mailgun" });
    const asking = await flight.createArc({ ...ARC, title: "Asking" });
    const asked = await flight.addIncrement({ arc: asking.id, ...WORK });
    await flight.closeIncrement(asked.id, { note: "Not needed", disposition: "withdrawn" });
    await flight.raiseQuestion({ arc: asking.id, ...ASK });
    const at = new Date();

    const survey = await flight.workSurvey(at, { also: [landed.id] });
    const views = new Map((await flight.arcViews(at)).map((view) => [view.arc.id, view]));
    assert.deepEqual(survey.arcs.map(({ id }) => id).sort(), [...views.keys()].sort(), "every live arc");
    for (const arc of survey.arcs) {
      const view = views.get(arc.id)!;
      assert.equal(arc.state, view.state, `${view.arc.fields.title}'s state`);
      assert.equal(arc.wakes, view.wakes, `${view.arc.fields.title}'s wake day`);
      assert.equal(arc.openQuestions, view.questions.filter(({ fields }) => fields.lifecycle === "open").length);
      assert.equal(arc.createdAt, view.arc.createdAt);
      assert.equal(arc.title, view.state === "closed" ? undefined : view.arc.fields.title, "a closed arc's title is not read");
    }
    const state = new Map(survey.arcs.map((arc) => [arc.id, arc.state]));
    assert.deepEqual([empty, drained, parked, live, asleep, asking].map(({ id }) => state.get(id)), ["active", "closed", "parked", "active", "parked", "active"]);
    assert.equal(survey.arcs.find(({ id }) => id === live.id)?.priority, 2);
    assert.deepEqual(survey.increments.map(({ id }) => id).sort(), [open.id, landed.id, dated.id, after.id].sort(), "open work, and the closed increment asked for");
    for (const increment of survey.increments) assert.equal("body" in increment.fields, false, "no body is read");
    const mine = survey.increments.find(({ id }) => id === open.id)!;
    assert.deepEqual([mine.fields.title, mine.fields.capabilities, mine.fields.machine, mine.fields.parked], [WORK.title, [form.id], "box", open.fields.parked]);
    assert.equal(survey.increments.find(({ id }) => id === landed.id)?.fields.outcome?.disposition, "landed", "a followed one with how it closed");
    assert.deepEqual(survey.holds(), await flight.holds(at), "the holds, as holds() reads them");
    assert.deepEqual(survey.holds({ claimed: new Set([form.id]) }), await flight.holds(at, { claimed: new Set([form.id]) }));
    assert.equal((await flight.workSurvey(at, { closedTitles: true })).arcs.find(({ id }) => id === drained.id)?.title, "Drained", "closed arcs titled when asked");
  });

  contract("10.5", "an increment moves to another live arc keeping its id, lifecycle and waits, the history recording the move and its reason; only open work moving to a closed arc is refused", async ({ work, flight, transactions }) => {
    const from = await flight.createArc(ARC);
    const to = await flight.createArc(ARC);
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

    const openArc = await flight.createArc(ARC);
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
        flight.createArc(without as never),
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
    await flight.editArc("arc-old", { endState: "Sign-up doubled" });
    assert.equal((await transactions.get("arc-old"))?.version, 2, "an edit stores it upgraded, in place");
  });
  contract("10.31", "an arc listing a story is returned by arcsFor(storyId), and an arc listing no stories is accepted; an arc listing a missing, retired or wrong-type story is refused, naming the first, with nothing written", async ({ work, flight, records, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const other = await work.addStory({ title: "Visitor can sign in" });
    const unlisted = await work.addStory({ title: "Visitor can leave" });

    // Arcs listing no stories, as a research arc may: with no stories field, and with an empty list.
    const research = await flight.createArc({ title: "Research: pricing", intent: "An intent", endState: "An end state" });
    assert.deepEqual((await transactions.get(research.id))?.fields, { title: "Research: pricing", intent: "An intent", endState: "An end state" });
    await laterThan(research);
    const spike = await flight.createArc({ title: "Spike", intent: "An intent", endState: "An end state", description: "Nothing to grow yet", stories: [] });
    assert.deepEqual((await transactions.get(spike.id))?.fields, { title: "Spike", intent: "An intent", endState: "An end state", description: "Nothing to grow yet", stories: [] });
    await laterThan(spike);

    // Arcs listing the story (one of them lists another story first), created in an order that is
    // not their ids' order; then an arc listing only the other story.
    const launches = await createInOrder(3, (n) =>
      flight.createArc({ title: `Launch ${n}`, intent: "An intent", endState: "An end state", stories: n === 1 ? [other.id, story.id] : [story.id] }),
    );
    const both = launches[1]!;
    const invite = await flight.createArc({ title: "Invite friends", intent: "An intent", endState: "An end state", stories: [other.id] });

    assert.deepEqual(await flight.arcsFor(story.id), launches, "every arc listing the story, as stored, in creation order");
    assert.deepEqual(await flight.arcsFor(other.id), [both, invite]);
    assert.deepEqual(await flight.arcsFor(unlisted.id), [], "a story no arc lists");
    assert.deepEqual(await flight.arcsFor("story_000000000000"), [], "an id naming no story");

    // The plan's tree lists every arc, in creation order, with the stories each one lists.
    assert.deepEqual((await work.projectTree()).arcs, [
      { id: research.id, title: "Research: pricing", stories: [] },
      { id: spike.id, title: "Spike", description: "Nothing to grow yet", stories: [] },
      ...launches.map((arc, n) => ({ id: arc.id, title: `Launch ${n}`, stories: n === 1 ? [other.id, story.id] : [story.id] })),
      { id: invite.id, title: "Invite friends", stories: [other.id] },
    ]);

    // A retired arc no longer lists anything.
    await records.retire(launches[0]!.id, "folded into Launch 1");
    assert.deepEqual(await flight.arcsFor(story.id), launches.slice(1));

    // An arc listing a story that is missing, retired, or not a story, even among good ones, is
    // refused naming the first bad one; an id given, or one the library cannot store, is the schema's to refuse.
    const retiredStory = await work.addStory({ title: "Visitor can pay" });
    await records.retire(retiredStory.id, "out of scope");
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const before = await transactions.history();
    const refused: [stories: string[], id: string, found?: string][] = [
      [["story_000000000000"], "story_000000000000"],
      [[story.id, retiredStory.id], retiredStory.id],
      [[story.id, other.id, capability.id, "story_000000000000"], capability.id, "capability"],
    ];
    for (const [stories, id, found] of refused) {
      const fields = { title: "Launch v2", intent: "An intent", endState: "An end state", stories };
      for (const attempt of [() => flight.createArc(fields), () => flight.editArc(invite.id, { stories })]) {
        await assert.rejects(attempt(), (error: unknown) => error instanceof MissingReferenceError && error.field === "stories" && error.id === id && error.found === found && error.message.includes(JSON.stringify(id)));
      }
    }
    for (const bad of ["story_\u0000", "story_\uD83C"]) {
      await assert.rejects(flight.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, bad] }), (error: unknown) => error instanceof SchemaError && error.type === "arc" && error.fields.includes("stories"));
    }
    await assert.rejects(flight.createArc({ id: both.id, title: "Replaced?", intent: "An intent", endState: "An end state" } as never), (error: unknown) => error instanceof SchemaError && error.type === "arc" && error.fields.includes("id"));
    assert.equal(await flight.editArc(capability.id, { title: "A capability, not an arc" }), null, "only a live arc is edited");
    assert.deepEqual(await transactions.history(), before, "none of them wrote anything");

    // Control: the same writes, naming live stories, go through.
    const launch = await flight.createArc({ title: "Launch v2", intent: "An intent", endState: "An end state", stories: [story.id, other.id] });
    assert.deepEqual((await transactions.get(launch.id))?.fields.stories, [story.id, other.id]);
    assert.deepEqual((await flight.editArc(invite.id, { stories: [unlisted.id] }))?.fields.stories, [unlisted.id]);
  });

  contract("10.32", "a wait that would close a loop across arcs and increments is refused, naming the loop, and nothing is written", async ({ work, flight, transactions }) => {
    const a = await flight.createArc({ title: "A", ...BARE_ARC });
    const b = await flight.createArc({ title: "B", ...BARE_ARC });
    const a1 = await flight.addIncrement({ arc: a.id, title: "a1", ...BARE_WORK });
    const b1 = await flight.addIncrement({ arc: b.id, title: "b1", ...BARE_WORK });

    const refused = async (waiter: string, blocker: string, loop: readonly string[]): Promise<void> => {
      const history = await transactions.history();
      await assert.rejects(
        flight.addWait(waiter, blocker, "?"),
        (error: unknown) => error instanceof WaitLoopError && JSON.stringify(error.path) === JSON.stringify(loop) && error.message.includes(loop.join(" → ")),
        `${waiter} waiting on ${blocker} closes ${loop.join(" → ")}`,
      );
      assert.deepEqual(await transactions.history(), history, "nothing was written");
    };

    await refused(a1.id, a1.id, [a1.id, a1.id]);
    await refused(a.id, a.id, [a.id, a.id]);
    // Increments alone: a1 waits on b1, so b1 cannot wait on a1.
    await flight.addWait(a1.id, b1.id, "needs b1");
    await refused(b1.id, a1.id, [b1.id, a1.id, b1.id]);
    // Across the kinds: arc B cannot wait on arc A, since B's b1 would wait for A to close, which
    // waits for a1, which waits on b1.
    await refused(b.id, a.id, [b1.id, a.id, a1.id, b1.id]);
    // Arcs alone.
    const c = await flight.createArc({ title: "C", ...BARE_ARC });
    await flight.addWait(c.id, a.id, "after A");
    await refused(a.id, c.id, [a.id, c.id, a.id]);
  });

  contract("10.33", "a wait is cleared from the record that stores it as its blocker lands (an increment) or closes (an arc), with the reason in its history; a failed or withdrawn blocker's wait stays", async ({ work, flight, records }) => {
    const mail = await flight.createArc({ title: "Mail", ...BARE_ARC });
    const launch = await flight.createArc({ title: "Launch", ...BARE_ARC });
    await flight.addWait(launch.id, mail.id, "launch needs mail");
    const mailer = await flight.addIncrement({ arc: mail.id, title: "Mailer", ...BARE_WORK });
    const templates = await flight.addIncrement({ arc: mail.id, title: "Templates", ...BARE_WORK });
    const form = await flight.addIncrement({ arc: launch.id, title: "Form", ...BARE_WORK });
    await flight.addWait(form.id, mailer.id, "sends through it");
    await flight.addWait(form.id, templates.id, "uses them");
    const stored = async (id: string): Promise<string[] | undefined> => ((await records.get(id))?.fields as { waits?: { on: string }[] }).waits?.map(({ on }) => on);

    await flight.closeIncrement(mailer.id, { pr: "#1", disposition: "landed" });
    assert.deepEqual(await stored(form.id), [templates.id], "the landed blocker's wait is gone from the record");
    const [cleared] = await records.history({ id: form.id }).then((entries) => entries.slice(-1));
    assert.ok(cleared?.reason?.includes(mailer.id) && /landed/.test(cleared.reason), `its history says why: ${JSON.stringify(cleared)}`);

    await flight.closeIncrement(templates.id, { note: "Not needed", disposition: "withdrawn" });
    assert.deepEqual(await stored(form.id), [templates.id], "a withdrawn blocker's wait stays, holding for good");
    assert.deepEqual(await stored(launch.id), undefined, "its arc closed with its last increment, and the arc wait on it is gone");

    // An arc closed by settling its last open question clears the waits on it too.
    const copy = await flight.createArc({ title: "Copy", ...BARE_ARC });
    await flight.addWait(launch.id, copy.id, "needs the words");
    const question = await flight.raiseQuestion({ arc: copy.id, title: "Tone?", stakes: "The words", statement: "Which tone?", context: "None yet", options: "Warm or plain" });
    await flight.closeIncrement((await flight.addIncrement({ arc: copy.id, title: "Draft", ...BARE_WORK })).id, { pr: "#2", disposition: "landed" });
    assert.deepEqual(await stored(launch.id), [copy.id], "an open question keeps the arc open");
    await flight.settleQuestion(question.id, { answer: "Plain" });
    assert.deepEqual(await stored(launch.id), undefined);

    // A withdrawn blocker corrected to landed clears its wait; moving an arc's last open work away closes it and clears the waits on it.
    await flight.correctIncrementClosure(templates.id, { pr: "#3", disposition: "landed" }, "it did land, in #3");
    assert.deepEqual(await stored(form.id), undefined);
    const site = await flight.createArc({ title: "Site", ...BARE_ARC });
    const page = await flight.addIncrement({ arc: site.id, title: "Page", ...BARE_WORK });
    await flight.addIncrement({ arc: site.id, title: "Sketch", outcome: { pr: "#4", disposition: "landed" }, ...BARE_WORK });
    await flight.addWait(launch.id, site.id, "needs a page");
    await flight.moveIncrement(page.id, launch.id, "belongs to the launch");
    assert.deepEqual(await stored(launch.id), undefined);
  });

  contract("10.34", "an arc waits on an increment of another arc: the wait holds the arc and its open work until that increment lands, and is cleared when it does", async ({ work, flight, records }) => {
    const learner = await flight.createArc({ title: "Learner", ...BARE_ARC });
    const prune = await flight.createArc({ title: "Prune", ...BARE_ARC });
    const learn = await flight.addIncrement({ arc: learner.id, title: "The learner", ...BARE_WORK });
    await flight.addWait(prune.id, learn.id, "the learner says what to prune");
    assert.deepEqual(await flight.waitHolds(prune.id), [{ on: learn.id, reason: "the learner says what to prune", forGood: false }], "an arc with no increments waits on it");
    assert.deepEqual((await flight.holds()).waits[prune.id], [{ on: learn.id, reason: "the learner says what to prune", forGood: false }]);
    const cut = await flight.addIncrement({ arc: prune.id, title: "Cut a door", ...BARE_WORK });
    assert.deepEqual(await flight.waitHolds(cut.id), [{ on: learn.id, reason: "the learner says what to prune", forGood: false }], "its open work waits too");

    await flight.closeIncrement(learn.id, { pr: "#1", disposition: "landed" });
    assert.deepEqual(await flight.waitHolds(prune.id), []);
    assert.deepEqual(await flight.waitHolds(cut.id), []);
    assert.equal(((await records.get(prune.id))?.fields as { waits?: unknown }).waits, undefined, "the landing cleared the arc's stored wait (10.33)");

    const again = await flight.addIncrement({ arc: learner.id, title: "The learner, again", ...BARE_WORK });
    await flight.addWait(prune.id, again.id, "the second pass");
    await flight.closeIncrement(again.id, { note: "Dropped", disposition: "withdrawn" });
    assert.deepEqual(await flight.waitHolds(prune.id), [{ on: again.id, reason: "the second pass", forGood: true }], "a withdrawn blocker holds for good");
  });

  contract("10.35", "parking an increment whose capabilities list names one already on another open increment's list is refused, naming that increment, its title and its arc, and the wait on that capability's claim as a way out, unless it is born waiting on that increment or on the claim of every capability they share", async ({ work, flight, transactions }) => {
    const story = await work.addStory({ title: "Visitor can sign up" });
    const form = await work.addCapability({ story: story.id, title: "Form" });
    const checks = await work.addCapability({ story: story.id, title: "Checks" });
    const arc = await flight.createArc(ARC);
    const other = await flight.createArc({ title: "Drain", ...BARE_ARC });
    const first = await flight.addIncrement({ arc: arc.id, title: "Route the form", ...BARE_WORK, capabilities: [form.id] });

    const history = await transactions.history();
    await assert.rejects(
      flight.addIncrement({ arc: other.id, title: "Route the form again", ...BARE_WORK, capabilities: [checks.id, form.id] }),
      (error: unknown) => error instanceof RangeError && error.message.includes(first.id) && error.message.includes("Route the form") && error.message.includes(arc.id) && error.message.includes(form.id) && !error.message.includes(checks.id)
        && error.message.includes(`on ${form.id}'s claim`),
    );
    // Waiting on the claim of only some of the capabilities they share is still refused.
    await assert.rejects(
      flight.addIncrement({ arc: other.id, title: "Route both", ...BARE_WORK, capabilities: [form.id], waits: [{ on: checks.id, reason: "after the checks" }] }),
      RangeError,
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    // Split off a held capability's work, born waiting on that capability's claim, not on the increment that lists it, parks (ADR-1228 D1).
    const split = await flight.addIncrement({ arc: other.id, title: "The form's split-off", ...BARE_WORK, capabilities: [form.id], waits: [{ on: form.id, reason: "its claim is held" }] });
    assert.deepEqual(split.fields.waits, [{ on: form.id, reason: "its claim is held" }]);
    await flight.closeIncrement(split.id, { note: "Folded into the first", disposition: "withdrawn" });

    // A later step of a split, born waiting on the increment that holds the capability, parks.
    const next = await flight.addIncrement({ arc: arc.id, title: "Then the form's checks", ...BARE_WORK, capabilities: [form.id], waits: [{ on: first.id, reason: "after the form" }] });
    assert.equal(next.fields.status, "proposal");
    // Born closed is a record of work done, never refused; and a capability whose increments have all closed is free.
    await flight.addIncrement({ arc: other.id, title: "Done before", ...BARE_WORK, capabilities: [form.id], outcome: { pr: "#3", disposition: "landed" } });
    await flight.closeIncrement(first.id, { pr: "#4", disposition: "landed" });
    await flight.closeIncrement(next.id, { pr: "#5", disposition: "landed" });
    assert.equal((await flight.addIncrement({ arc: other.id, title: "Route the form", ...BARE_WORK, capabilities: [form.id] })).fields.status, "proposal");
  });

  contract("10.36", "an increment is made to wait for the owner or an outside event with a note, one per releaser, the latest replacing it: an event wait needs a check-back day not before today, an owner wait takes none, and a closed increment waits for nothing; a refused wait is not written", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc({ title: "Installer", ...BARE_ARC });
    const install = await flight.addIncrement({ arc: arc.id, title: "Real install", ...BARE_WORK });
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const before = await transactions.history();
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "event", note: "the next failed-checks removal" }), /check-back day/, "no event wait without a day");
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "owner", note: "run it", checkBack: day(1), why: "proved on hardware" }), /owner/, "an owner wait takes no day");
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "event", note: "it happens", checkBack: day(-1) }), /before today/);
    assert.deepEqual(await transactions.history(), before, "nothing written");

    await flight.addWaitFor(install.id, { releaser: "owner", note: "power on the old laptop", why: "the installer is proved on real hardware" });
    await flight.addWaitFor(install.id, { releaser: "owner", note: "run the NSIS install on the old laptop", why: "the installer is proved on real hardware" });
    await flight.addWaitFor(install.id, { releaser: "event", note: "the next release build", checkBack: day(1) });
    assert.deepEqual((await flight.waitsFor(install.id)).map(({ releaser, note }) => ({ releaser, note })), [
      { releaser: "owner", note: "run the NSIS install on the old laptop" },
      { releaser: "event", note: "the next release build" },
    ], "one note per releaser, the latest");
    await flight.removeWaitFor(install.id, "owner");
    assert.deepEqual((await flight.waitsFor(install.id)).map(({ releaser }) => releaser), ["event"], "cleared for one releaser, the other kept");

    await flight.closeIncrement(install.id, { pr: "#3", disposition: "landed" });
    const closed = await transactions.history();
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "owner", note: "run it", why: "proved on hardware" }), /closed/, "a closed increment waits for nothing");
    assert.deepEqual(await transactions.history(), closed, "nothing written");
  });

  contract("10.37", "an owner wait needs a why and may carry a rank, 1 first; each write stamps the day it was read again, and writing it again keeps the note, why and rank not given; an event wait takes neither", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc({ title: "Security", ...BARE_ARC });
    const rotate = await flight.addIncrement({ arc: arc.id, title: "Rotate the token", ...BARE_WORK });
    const today = new Date().toISOString().slice(0, 10);
    const before = await transactions.history();
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate the GitHub token" }), /needs a why/, "no owner wait without a why");
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "  " }), /needs a why/, "a blank why is none");
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "a leak", rank: 0 }), /whole number/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "a leak", rank: 1.5 }), /whole number/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "event", note: "it lands", checkBack: today, why: "a leak" }), /only an owner wait/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "event", note: "it lands", checkBack: today, rank: 2 }), /only an owner wait/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", why: "a leak" }), /needs a note/, "a first owner wait needs its note");
    await assert.rejects(flight.addIncrement({ arc: arc.id, title: "Born waiting", ...BARE_WORK, waitsFor: [{ releaser: "owner", note: "sign in" }] }), /needs a why/, "nor is one born without it");
    assert.deepEqual(await transactions.history(), before, "nothing written");

    await flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate the GitHub token", why: "a leaked token can push as you", rank: 2 });
    const stored = async () => ((await records.get(rotate.id))?.fields as { waitsFor?: unknown } | undefined)?.waitsFor;
    const stamped = { releaser: "owner" as const, note: "rotate the GitHub token", why: "a leaked token can push as you", rank: 2, reviewed: today };
    assert.deepEqual(await stored(), [stamped]);
    assert.deepEqual((await flight.holds()).waitsFor?.[rotate.id], [{ ...stamped, holds: true }]);

    await records.edit(rotate.id, { waitsFor: [{ ...stamped, reviewed: "2026-01-01" }] });
    await flight.addWaitFor(rotate.id, { releaser: "owner", rank: 1 });
    assert.deepEqual(await stored(), [{ ...stamped, rank: 1 }], "re-ranked: the note and why kept, read again today");
    await records.edit(rotate.id, { waitsFor: [{ ...stamped, rank: 1, reviewed: "2026-01-01" }] });
    await flight.addWaitFor(rotate.id, { releaser: "owner" });
    assert.deepEqual(await stored(), [{ ...stamped, rank: 1 }], "written again with nothing new, it is only read again");

    const born = await flight.addIncrement({ arc: arc.id, title: "Sign in", ...BARE_WORK, waitsFor: [{ releaser: "owner", note: "sign in", why: "the box reads mail", rank: 3 }] });
    assert.deepEqual(born.fields.waitsFor, [{ releaser: "owner", note: "sign in", why: "the box reads mail", rank: 3, reviewed: today }]);
  });

  contract("10.38", "clearing an increment's event wait as a pull request it was handed over with merges stamps that pull request on its owner wait in the same write; writing the owner wait again drops it, and only an owner wait carries one", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc({ title: "Hand-overs", ...BARE_ARC });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const ship = await flight.addIncrement({ arc: arc.id, title: "Ship in two pull requests", ...BARE_WORK });
    const owner = { releaser: "owner" as const, note: "turn the setting on", why: "the second pull request needs it", reviewed: today };
    await flight.addWaitFor(ship.id, { releaser: "owner", note: owner.note, why: owner.why });
    await flight.addWaitFor(ship.id, { releaser: "event", note: "PR #173 lands", checkBack: tomorrow });
    const before = (await transactions.history()).length;
    await flight.removeWaitFor(ship.id, "event", undefined, { merged: 173 });
    assert.equal((await transactions.history()).length, before + 1, "one write");
    const stored = async () => ((await records.get(ship.id))?.fields as { waitsFor?: unknown } | undefined)?.waitsFor;
    assert.deepEqual(await stored(), [{ ...owner, merged: 173 }], "the event wait cleared, the merge stamped on the owner wait");
    assert.deepEqual((await flight.holds()).waitsFor?.[ship.id], [{ ...owner, merged: 173, holds: true }]);

    await flight.addWaitFor(ship.id, { releaser: "owner" });
    assert.deepEqual(await stored(), [owner], "read again, the merge is dropped");

    const alone = await flight.addIncrement({ arc: arc.id, title: "Only an event", ...BARE_WORK });
    await flight.addWaitFor(alone.id, { releaser: "event", note: "PR #174 lands", checkBack: tomorrow });
    await flight.removeWaitFor(alone.id, "event", undefined, { merged: 174 });
    assert.equal(((await records.get(alone.id))?.fields as { waitsFor?: unknown } | undefined)?.waitsFor, undefined, "with no owner wait, nothing is stamped");
    await assert.rejects(records.edit(alone.id, { waitsFor: [{ releaser: "event", note: "it lands", checkBack: tomorrow, merged: 1 }] } as never), /only an owner wait/);
  });

  contract("10.39", "settling a question takes it off every increment's heldOn in the same step, keeping their other holds, and returns the open increments it released, by id and title, one held on it just before among them", async ({ work, flight, records }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const other = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const open = await flight.addIncrement({ arc: arc.id, ...WORK, title: "Welcome email", heldOn: [question.id] });
    const both = await flight.addIncrement({ arc: arc.id, ...WORK, title: "Receipt email", heldOn: [question.id, other.id] });
    const closed = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id] });
    await flight.closeIncrement(closed.id, { disposition: "withdrawn", note: "overtaken" });
    const reheld = await flight.addIncrement({ arc: arc.id, ...WORK, title: "Invoice email" });
    await flight.editIncrement(reheld.id, { heldOn: [question.id] });
    await flight.addIncrement({ arc: arc.id, ...WORK, title: "Free" });
    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun" });
    const byId = (one: { id: string }, other: { id: string }): number => one.id.localeCompare(other.id);
    assert.deepEqual(settled?.released.toSorted(byId), [
      { id: open.id, title: "Welcome email" },
      { id: both.id, title: "Receipt email" },
      { id: reheld.id, title: "Invoice email" },
    ].sort(byId));
    assert.deepEqual(await flight.heldOnQuestion(open.id), [], "settling released it");
    const heldOn = async (id: string): Promise<unknown> => ((await records.get(id))?.fields as { heldOn?: unknown } | undefined)?.heldOn;
    assert.equal(await heldOn(open.id), undefined, "its heldOn no longer names the settled question");
    assert.deepEqual(await heldOn(both.id), [other.id], "its other holds stay");
  });

  contract("10.40", "retiring a question releases every increment held on it, open or closed, and retires it in one step", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const other = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const open = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id, other.id] });
    const closed = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id] });
    await flight.closeIncrement(closed.id, { disposition: "withdrawn", note: "overtaken" });
    const free = await flight.addIncrement({ arc: arc.id, ...WORK });

    assert.deepEqual((await flight.retireQuestion(question.id, "no longer asked"))?.sort(), [open.id, closed.id].sort());
    assert.equal(await records.get(question.id), null);
    const heldOn = async (id: string): Promise<unknown> => ((await records.get(id))?.fields as { heldOn?: unknown } | undefined)?.heldOn;
    assert.deepEqual(await heldOn(open.id), [other.id], "its other holds stay");
    assert.equal(await heldOn(closed.id), undefined);
    assert.equal(await heldOn(free.id), undefined);

    const history = await transactions.history();
    assert.equal(await flight.retireQuestion(question.id, "again"), null, "a retired question is not live");
    assert.equal(await flight.retireQuestion(open.id, "not a question"), null);
    assert.deepEqual(await transactions.history(), history, "nothing was written");
  });

  contract("10.44", "a failing verified verdict on a contract releases each open increment whose event wait is about it (one that links the contract or lists its capability): its event wait is cleared and the verdict written at the top of its body, in one write; a passing or not-checked verdict, an owner wait and an increment about other work are left as they were", async ({ work, flight, health, records, transactions }) => {
    const story = await work.addStory({ title: "Map" });
    const [render, other] = await Promise.all(["Story node render", "Other"].map((title) => work.addCapability({ title, story: story.id })));
    const lag = await work.addContract({ title: "3.49 · A fresh start opens within its bound", capability: render!.id });
    const elsewhere = await work.addContract({ title: "3.1 · Something else", capability: other!.id });
    const arc = await flight.createArc(ARC);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const event = { releaser: "event" as const, note: "the first lag run on a main holding PR #580", checkBack: tomorrow };
    const owner = { releaser: "owner" as const, note: "sign in", why: "the run reads mail" };
    const linked = await flight.addIncrement({ arc: arc.id, title: "Re-measure 3.49", ...BARE_WORK, links: [lag.id], waitsFor: [event] });
    const listed = await flight.addIncrement({ arc: arc.id, title: "Fix the render", ...BARE_WORK, capabilities: [render!.id], waitsFor: [event, owner] });
    const unrelated = await flight.addIncrement({ arc: arc.id, title: "Other work", ...BARE_WORK, capabilities: [other!.id], links: [elsewhere.id], waitsFor: [event] });
    const ownerOnly = await flight.addIncrement({ arc: arc.id, title: "Waits for the owner", ...BARE_WORK, links: [lag.id], waitsFor: [owner] });
    const fields = async (id: string) => (await records.get(id))?.fields as { body: string; waitsFor?: unknown };

    let history = await transactions.history();
    await health.recordVerified(lag.id, "passing", { by: "lag run 250" });
    await health.recordVerified(lag.id, "not-checked", { by: "lag run 251", skip: "other" });
    assert.equal((await transactions.history()).length, history.length + 2, "a passing or not-checked verdict writes only itself");

    history = await transactions.history();
    await health.recordVerified(lag.id, "failing", { by: "lag run 253", note: "open-app-fresh slower since c64225e5" });
    const written = (await transactions.history()).slice(history.length);
    assert.equal(written.filter((change) => change.recordId === linked.id).length, 1, "the linked increment is released in one write");
    assert.equal(written.filter((change) => change.recordId === listed.id).length, 1, "the increment listing its capability is released in one write");

    assert.equal((await fields(linked.id)).waitsFor, undefined, "its event wait is cleared");
    assert.deepEqual((await fields(listed.id)).waitsFor, [{ ...owner, reviewed: new Date().toISOString().slice(0, 10) }], "its owner wait stays");
    for (const id of [linked.id, listed.id]) {
      const { body } = await fields(id);
      assert.ok(body.endsWith(BARE_WORK.body), "the body it had is kept");
      const verdict = body.slice(0, body.length - BARE_WORK.body.length);
      for (const said of ["failing", "3.49 · A fresh start opens within its bound", "lag run 253", "open-app-fresh slower since c64225e5", event.note]) assert.ok(verdict.includes(said), `the verdict written on it says ${said}`);
    }
    assert.deepEqual((await flight.holds()).waitsFor?.[linked.id] ?? [], [], "nothing holds it now");

    assert.deepEqual((await fields(unrelated.id)).waitsFor, [event], "an increment about other work keeps its wait");
    assert.equal((await fields(unrelated.id)).body, BARE_WORK.body);
    assert.equal((await fields(ownerOnly.id)).body, BARE_WORK.body, "an owner wait is not released by a verdict");

    history = await transactions.history();
    await health.recordVerified(lag.id, "failing", { by: "lag run 254" });
    assert.equal((await transactions.history()).length, history.length + 1, "a released increment is not written again");
  });

  contract("10.45", "a failing verdict told later, as of its place in history, releases only an increment whose event wait stood unchanged from that place to now: one made to wait, or made to wait again, after it keeps its wait", async ({ work, flight, records, transactions }) => {
    const story = await work.addStory({ title: "Map" });
    const render = await work.addCapability({ title: "Story node render", story: story.id });
    const lag = await work.addContract({ title: "3.49 · A fresh start opens within its bound", capability: render.id });
    const arc = await flight.createArc(ARC);
    const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toISOString().slice(0, 10);
    const event = { releaser: "event" as const, note: "the next lag run", checkBack: day(1) };
    const stood = await flight.addIncrement({ arc: arc.id, title: "Re-measure 3.49", ...BARE_WORK, links: [lag.id], waitsFor: [event] });
    const rewaited = await flight.addIncrement({ arc: arc.id, title: "Fix the render", ...BARE_WORK, capabilities: [render.id], waitsFor: [event] });
    const asOf = (await transactions.history()).at(-1)!.seq;
    await flight.addWaitFor(rewaited.id, { ...event, note: "the run after PR #600", checkBack: day(2) });
    const later = await flight.addIncrement({ arc: arc.id, title: "Re-check 3.49", ...BARE_WORK, links: [lag.id], waitsFor: [event] });

    const released = await flight.releaseOnVerdict(lag.id, render.id, "VERDICT: 3.49 verified failing.", {}, asOf);
    assert.deepEqual(released, [stood.id], "only the wait that stood since the verdict is released");
    assert.equal(((await records.get(stood.id))?.fields as { waitsFor?: unknown[] }).waitsFor, undefined);
    for (const kept of [rewaited, later]) assert.equal(((await records.get(kept.id))?.fields as { waitsFor?: unknown[] }).waitsFor?.length, 1, `${kept.fields.title} keeps its wait`);
  });
}


test("10.8 work reads stay small as unrelated closed history grows, preserving blockers and the arc log", async (t) => {
  await withCountedProject(async ({ work, flight, records, pool }, received) => {
    const arc = await flight.createArc(ARC);
    const history = await flight.createArc({ ...ARC, title: "History" });
    const empty = await flight.createArc({ ...ARC, title: "No increments yet" });
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
    // Settling its last question closed the arc and cleared the wait on it (10.33): written again, a parked arc holds.
    await flight.addWait(arc.id, history.id, "closed arc releases");
    await flight.parkArc(history.id);
    assert.ok((await flight.waitHolds(waiter.id)).some(({ on }) => on === history.id), "a parked arc holds");
    await flight.unparkArc(history.id);
    await records.retire(failed.id, "removed");
    assert.deepEqual(await flight.waitHolds(waiter.id), expected, "a missing blocker still holds for good");
  });
});

/** Wait until the clock has passed `record`'s creation, so the next record is created strictly later. */
async function laterThan(record: { readonly createdAt: string }): Promise<void> {
  await waitUntil(() => Date.now() > Date.parse(record.createdAt), 5_000, `the clock to pass ${record.createdAt}`);
}

/**
 * Create records one after another with `create`, each strictly later than the one before, until
 * there are at least `count` and their ids' own order is NOT their creation order, so any order a
 * test then sees them in can only be creation order.
 */
async function createInOrder<R extends { readonly id: string; readonly createdAt: string }>(count: number, create: (n: number) => Promise<R>): Promise<R[]> {
  const created: R[] = [];
  while (created.length < count || created.every((record, n) => n === 0 || created[n - 1]!.id < record.id)) {
    const record = await create(created.length);
    created.push(record);
    await laterThan(record);
  }
  return created;
}
