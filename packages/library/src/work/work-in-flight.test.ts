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
import { SchemaError, SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
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

    // An increment's arc must be a live arc; the parts it touches must be live stories or capabilities.
    const story = await work.addStory({ title: "Visitor can sign up" });
    const retired = await work.createArc(ARC);
    await records.retire(retired.id, "withdrawn");
    const history = await transactions.history();
    for (const [fields, field] of [
      [{ arc: "arc_000000000000", ...WORK }, "arc"],
      [{ arc: story.id, ...WORK }, "arc"],
      [{ arc: retired.id, ...WORK }, "arc"],
      [{ arc: arc.id, ...WORK, touches: ["capability_000000000000"] }, "touches"],
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
    assert.equal((await flight.advanceIncrement(increment.id, "ready"))?.fields.status, "ready");
    assert.equal((await flight.advanceIncrement(increment.id, "active"))?.fields.status, "active");

    const history = await transactions.history();
    await assert.rejects(flight.advanceIncrement(increment.id, "ready"), LifecycleError, "never backward");
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
