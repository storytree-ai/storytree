/**
 * Capability 11 · Waits (ADR-0640): one test per contract 11.1-11.4 in the library story, each run
 * on BOTH backends: a WorkModel and a WorkInFlight over a fresh MemoryTransactions, and the `work`
 * and `flight` of a fresh Postgres project, dropped afterwards, pass or fail.
 *
 * Whether anything was written is judged one layer down: an unchanged history means nothing was.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { WaitLoopError, WorkInFlight, WorkModel } from "./index.js";

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

const ARC = { intent: "An intent", endState: "An end state" };
const WORK = { objective: "Do it", body: "The steps." };

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

  contract("11.1", "an increment wait holds until the blocker closes as landed; a failed, withdrawn or missing blocker holds for good", async ({ work, flight, records }) => {
    const arc = await work.createArc({ title: "Sign-up", ...ARC });
    const other = await work.createArc({ title: "Mail", ...ARC });
    const waiter = await flight.addIncrement({ arc: arc.id, title: "Welcome email", ...WORK });
    const blockers = await Promise.all(
      ["Mailer", "Templates", "Bounces", "Domain"].map((title) => flight.addIncrement({ arc: other.id, title, ...WORK })),
    );
    const [mailer, templates, bounces, domain] = blockers.map(({ id }) => id) as [string, string, string, string];
    for (const [blocker, reason] of [[mailer, "sends through it"], [templates, "uses them"], [bounces, "handles them"], [domain, "sends from it"]]) {
      await flight.addWait(waiter.id, blocker!, reason!);
    }
    assert.deepEqual(await flight.waitHolds(waiter.id), [
      { on: mailer, reason: "sends through it", forGood: false },
      { on: templates, reason: "uses them", forGood: false },
      { on: bounces, reason: "handles them", forGood: false },
      { on: domain, reason: "sends from it", forGood: false },
    ]);

    await flight.advanceIncrement(mailer, "active");
    await flight.closeIncrement(mailer, { pr: "#1", disposition: "landed" });
    await flight.closeIncrement(templates, { pr: "#2", disposition: "failed" });
    await flight.closeIncrement(bounces, { note: "Not needed", disposition: "withdrawn" });
    await records.retire(domain, "Moved to another project");
    assert.deepEqual(await flight.waitHolds(waiter.id), [
      { on: templates, reason: "uses them", forGood: true },
      { on: bounces, reason: "handles them", forGood: true },
      { on: domain, reason: "sends from it", forGood: true },
    ], "the landed blocker released it; the rest never will");

    // A blocker must be live when the wait is written, and an increment waits on an increment.
    await assert.rejects(flight.addWait(waiter.id, "increment_000000000000", "?"), MissingReferenceError);
    await assert.rejects(flight.addWait(waiter.id, other.id, "?"), MissingReferenceError);
    await flight.removeWait(waiter.id, templates);
    assert.deepEqual((await flight.waitHolds(waiter.id)).map(({ on }) => on), [bounces, domain]);
  });

  contract("11.2", "an arc wait holds until that arc closes", async ({ work, flight }) => {
    const launch = await work.createArc({ title: "Launch", ...ARC });
    const mail = await work.createArc({ title: "Mail", ...ARC });
    await flight.addWait(launch.id, mail.id, "launch needs mail");
    assert.deepEqual(await flight.waitHolds(launch.id), [{ on: mail.id, reason: "launch needs mail", forGood: false }], "an arc with no increments is active");

    const mailer = await flight.addIncrement({ arc: mail.id, title: "Mailer", ...WORK });
    // The arc's wait holds each of its increments too: its work cannot start.
    const first = await flight.addIncrement({ arc: launch.id, title: "Landing page", ...WORK });
    assert.deepEqual(await flight.waitHolds(first.id), [{ on: mail.id, reason: "launch needs mail", forGood: false }]);

    await flight.closeIncrement(mailer.id, { note: "Tried and dropped", disposition: "failed" });
    assert.deepEqual(await flight.waitHolds(launch.id), [], "the arc closed, however its last increment closed");
    assert.deepEqual(await flight.waitHolds(first.id), []);

    await flight.addIncrement({ arc: mail.id, title: "Mailer, again", ...WORK });
    assert.equal((await flight.waitHolds(launch.id)).length, 1, "work parked on it reopened it, so the wait holds again");
    await assert.rejects(flight.addWait(launch.id, first.id, "?"), MissingReferenceError, "an arc waits on an arc");
  });

  contract("11.3", "a wait that would close a loop across arcs and increments is refused, naming the loop, and nothing is written", async ({ work, flight, transactions }) => {
    const a = await work.createArc({ title: "A", ...ARC });
    const b = await work.createArc({ title: "B", ...ARC });
    const a1 = await flight.addIncrement({ arc: a.id, title: "a1", ...WORK });
    const b1 = await flight.addIncrement({ arc: b.id, title: "b1", ...WORK });

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
    const c = await work.createArc({ title: "C", ...ARC });
    await flight.addWait(c.id, a.id, "after A");
    await refused(a.id, c.id, [a.id, c.id, a.id]);
  });

  contract("11.4", "waitHolds(id) returns the blockers still holding, each with its reason", async ({ work, flight }) => {
    const arc = await work.createArc({ title: "Sign-up", ...ARC });
    const waiter = await flight.addIncrement({ arc: arc.id, title: "Form", ...WORK });
    assert.deepEqual(await flight.waitHolds(waiter.id), [], "no waits, nothing holds");
    const blocker = await flight.addIncrement({ arc: arc.id, title: "Design", ...WORK });
    await flight.addWait(waiter.id, blocker.id, "needs the design");
    await flight.addWait(waiter.id, blocker.id, "needs the final design");
    assert.deepEqual(await flight.waitHolds(waiter.id), [{ on: blocker.id, reason: "needs the final design", forGood: false }], "one wait per blocker, its reason the latest");
    await flight.closeIncrement(blocker.id, { pr: "#9", disposition: "landed" });
    assert.deepEqual(await flight.waitHolds(waiter.id), []);
    assert.deepEqual(await flight.waitHolds("increment_000000000000"), [], "nothing holds what does not exist");
  });

  contract("11.5", "holds() answers every arc's and open increment's holds in one reading, as waitHolds and heldOnQuestion do", async ({ work, flight }) => {
    const mail = await work.createArc({ title: "Mail", ...ARC });
    const launch = await work.createArc({ title: "Launch", ...ARC });
    await flight.addWait(launch.id, mail.id, "launch needs mail");
    const question = await flight.raiseQuestion({ arc: launch.id, title: "Copy?", stakes: "Blocks the form", statement: "Which words?", context: "None yet", options: "Short or long" });
    const mailer = await flight.addIncrement({ arc: mail.id, title: "Mailer", ...WORK });
    const form = await flight.addIncrement({ arc: launch.id, title: "Form", ...WORK, heldOn: [question.id] });
    await flight.addWait(form.id, mailer.id, "sends through it");
    const done = await flight.addIncrement({ arc: mail.id, title: "Templates", ...WORK });
    await flight.closeIncrement(done.id, { pr: "#1", disposition: "landed" });

    const ids = [mail.id, launch.id, mailer.id, form.id];
    const one = await flight.holds();
    assert.deepEqual(one.waits, Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await flight.waitHolds(id)]))));
    assert.deepEqual(one.heldOn, Object.fromEntries(await Promise.all([mailer.id, form.id].map(async (id) => [id, await flight.heldOnQuestion(id)]))));
    assert.deepEqual(one.waits[form.id]?.map(({ on }) => on), [mailer.id, mail.id], "its own wait, then its arc's");
    assert.deepEqual(one.heldOn[form.id], [question.id]);
    assert.equal(one.waits[done.id], undefined, "closed increments are omitted");
    assert.deepEqual(await flight.waitHolds(done.id), []);
  });
}
