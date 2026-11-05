/**
 * Capability 11 · Waits (ADR-0640): one test per contract 11.1, 11.2, 11.4-11.6 and 11.12 in the library story (its wait writes' 10.32-10.34 and 10.36-10.38 are in work-in-flight.test.ts), each run
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
    const arc = await flight.createArc({ title: "Sign-up", ...ARC });
    const other = await flight.createArc({ title: "Mail", ...ARC });
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
    const launch = await flight.createArc({ title: "Launch", ...ARC });
    const mail = await flight.createArc({ title: "Mail", ...ARC });
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
    assert.deepEqual(await flight.waitHolds(launch.id), [], "the closing cleared the wait (10.33), so reopening the arc does not bring it back");
    await assert.rejects(flight.addWait(launch.id, first.id, "?"), WaitLoopError, "an arc may not wait on its own work");
  });



  contract("11.4", "waitHolds(id) returns the blockers still holding, each with its reason", async ({ work, flight }) => {
    const arc = await flight.createArc({ title: "Sign-up", ...ARC });
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
    const mail = await flight.createArc({ title: "Mail", ...ARC });
    const launch = await flight.createArc({ title: "Launch", ...ARC });
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


  contract("11.6", "an increment's wait for the owner holds until cleared, an outside event's until its check-back day, then reads passed", async ({ work, flight }) => {
    const arc = await flight.createArc({ title: "Installer", ...ARC });
    const install = await flight.addIncrement({ arc: arc.id, title: "Real install", ...WORK });
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await flight.addWaitFor(install.id, { releaser: "owner", note: "run the NSIS install on the old laptop", why: "the installer is proved on real hardware" });
    await flight.addWaitFor(install.id, { releaser: "event", note: "the next release build", checkBack: day(1) });
    const owner = { releaser: "owner", note: "run the NSIS install on the old laptop", why: "the installer is proved on real hardware", reviewed: day(0), holds: true };
    const event = { releaser: "event", note: "the next release build", checkBack: day(1) };
    assert.deepEqual(await flight.waitsFor(install.id), [owner, { ...event, holds: true }]);
    assert.deepEqual((await flight.holds()).waitsFor?.[install.id], [owner, { ...event, holds: true }]);
    const later = new Date(`${day(2)}T00:00:00Z`);
    assert.deepEqual(await flight.waitsFor(install.id, later), [owner, { ...event, holds: false }], "from its check-back day an event wait no longer holds");
    assert.deepEqual((await flight.holds(later)).waitsFor?.[install.id], [owner, { ...event, holds: false }]);

    await flight.removeWaitFor(install.id, "owner");
    assert.deepEqual(await flight.waitsFor(install.id), [{ ...event, holds: true }]);
    await flight.closeIncrement(install.id, { pr: "#3", disposition: "landed" });
    assert.deepEqual(await flight.waitsFor(install.id), [], "a closed increment waits for nothing");
    assert.equal((await flight.holds()).waitsFor?.[install.id], undefined);
  });

  contract("11.12", "an increment waits on a capability's claim: it holds only while a live session holds that capability, and an increment wait still holds until its blocker lands", async ({ work, flight }) => {
    const arc = await flight.createArc({ title: "Speed", ...ARC });
    const story = await work.addStory({ title: "Visitor sees the arcs" });
    const surface = await work.addCapability({ title: "Arc surface", story: story.id });
    const expansion = await flight.addIncrement({ arc: arc.id, title: "Arcs tab expansion", ...WORK });
    const fix = await flight.addIncrement({ arc: arc.id, title: "Open-app speed fix", ...WORK });
    await flight.addWait(fix.id, surface.id, "refused: another session holds it");
    const claim = { on: surface.id, reason: "refused: another session holds it", forGood: false, claim: true, title: surface.fields.title };

    assert.deepEqual(await flight.waitHolds(fix.id, { claimed: new Set([surface.id]) }), [claim], "held while a live session holds the capability");
    assert.deepEqual((await flight.holds(new Date(), { claimed: new Set([surface.id]) })).waits[fix.id], [claim]);
    assert.deepEqual(await flight.waitHolds(fix.id, { claimed: new Set() }), [], "the holder released it: the wait no longer holds, with nothing written");
    assert.deepEqual((await flight.holds(new Date(), { claimed: new Set() })).waits[fix.id], []);
    assert.deepEqual(await flight.waitHolds(fix.id), [claim], "a reader that cannot see claims reads it as holding");

    // A wait on the increment, recorded on purpose, is unchanged: it holds until that increment lands, whoever holds what (D3).
    await flight.removeWait(fix.id, surface.id);
    await flight.addWait(fix.id, expansion.id, "goes after it");
    assert.deepEqual(await flight.waitHolds(fix.id, { claimed: new Set() }), [{ on: expansion.id, reason: "goes after it", forGood: false }]);
    await assert.rejects(flight.addWait(arc.id, surface.id, "?"), MissingReferenceError, "an arc waits on no claim");
  });
}
