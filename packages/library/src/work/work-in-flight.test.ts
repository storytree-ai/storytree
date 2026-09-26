/**
 * Capability 10 · Work in flight (ADR-0640): one test per contract 10.1-10.4 in stories/library.md,
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
import { LifecycleError, WorkInFlight, WorkModel, type NewIncrement } from "./index.js";

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
