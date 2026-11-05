/**
 * Capability 11 · Waits (ADR-0640): one test per contract 11.1, 11.2, 11.4-11.6 and 11.10-11.12 in the library story (its wait writes' 10.32-10.34 are in work-in-flight.test.ts), each run
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


  contract("11.6", "an increment waits for the owner or an outside event with a note: an owner wait holds until cleared, an event wait until its check-back day, then reads passed", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc({ title: "Installer", ...ARC });
    const install = await flight.addIncrement({ arc: arc.id, title: "Real install", ...WORK });
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const before = await transactions.history();
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "event", note: "the next failed-checks removal" }), /check-back day/, "no event wait without a day");
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "owner", note: "run it", checkBack: day(1) }), /owner/, "an owner wait takes no day");
    await assert.rejects(flight.addWaitFor(install.id, { releaser: "event", note: "it happens", checkBack: day(-1) }), /before today/);
    assert.deepEqual(await transactions.history(), before, "nothing written");

    await flight.addWaitFor(install.id, { releaser: "owner", note: "power on the old laptop", why: "the installer is proved on real hardware" });
    await flight.addWaitFor(install.id, { releaser: "owner", note: "run the NSIS install on the old laptop", why: "the installer is proved on real hardware" });
    await flight.addWaitFor(install.id, { releaser: "event", note: "the next release build", checkBack: day(1) });
    const owner = { releaser: "owner", note: "run the NSIS install on the old laptop", why: "the installer is proved on real hardware", reviewed: day(0), holds: true };
    const event = { releaser: "event", note: "the next release build", checkBack: day(1) };
    assert.deepEqual(await flight.waitsFor(install.id), [owner, { ...event, holds: true }], "one note per releaser, the latest");
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

  contract("11.10", "an owner wait needs a why and may carry a rank, 1 first; each write stamps the day it was read again, and writing it again keeps the note, why and rank not given; an event wait takes neither", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc({ title: "Security", ...ARC });
    const rotate = await flight.addIncrement({ arc: arc.id, title: "Rotate the token", ...WORK });
    const today = new Date().toISOString().slice(0, 10);
    const before = await transactions.history();
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate the GitHub token" }), /needs a why/, "no owner wait without a why");
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "  " }), /needs a why/, "a blank why is none");
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "a leak", rank: 0 }), /whole number/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", note: "rotate it", why: "a leak", rank: 1.5 }), /whole number/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "event", note: "it lands", checkBack: today, why: "a leak" }), /only an owner wait/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "event", note: "it lands", checkBack: today, rank: 2 }), /only an owner wait/);
    await assert.rejects(flight.addWaitFor(rotate.id, { releaser: "owner", why: "a leak" }), /needs a note/, "a first owner wait needs its note");
    await assert.rejects(flight.addIncrement({ arc: arc.id, title: "Born waiting", ...WORK, waitsFor: [{ releaser: "owner", note: "sign in" }] }), /needs a why/, "nor is one born without it");
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

    const born = await flight.addIncrement({ arc: arc.id, title: "Sign in", ...WORK, waitsFor: [{ releaser: "owner", note: "sign in", why: "the box reads mail", rank: 3 }] });
    assert.deepEqual(born.fields.waitsFor, [{ releaser: "owner", note: "sign in", why: "the box reads mail", rank: 3, reviewed: today }]);
  });

  contract("11.11", "clearing an increment's event wait as a pull request it was handed over with merges stamps that pull request on its owner wait in the same write; writing the owner wait again drops it, and only an owner wait carries one", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc({ title: "Hand-overs", ...ARC });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const ship = await flight.addIncrement({ arc: arc.id, title: "Ship in two pull requests", ...WORK });
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

    const alone = await flight.addIncrement({ arc: arc.id, title: "Only an event", ...WORK });
    await flight.addWaitFor(alone.id, { releaser: "event", note: "PR #174 lands", checkBack: tomorrow });
    await flight.removeWaitFor(alone.id, "event", undefined, { merged: 174 });
    assert.equal(((await records.get(alone.id))?.fields as { waitsFor?: unknown } | undefined)?.waitsFor, undefined, "with no owner wait, nothing is stamped");
    await assert.rejects(records.edit(alone.id, { waitsFor: [{ releaser: "event", note: "it lands", checkBack: tomorrow, merged: 1 }] } as never), /only an owner wait/);
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
