import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../projects/open/index.js";
import { SchemaRecords } from "../../storage/rules/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { HealthRecord } from "../../health/index.js";
import { MemoryTransactions, type Transactions } from "../../storage/store/index.js";
import { WorkModel } from "../../plan/index.js";
import { WorkInFlight } from "./index.js";

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
      const work = new WorkModel(project.records);
      const flight = new WorkInFlight(project.records, work);
      return { work, flight, health: new HealthRecord(project.records, work, flight), records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const ARC = { title: "Launch v1", intent: "Ship sign-up", endState: "Visitors can sign up" };
const BARE_WORK = { objective: "Do it", body: "The steps." };

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
    const parking = new Date().toISOString();
    const listed = await flight.addIncrement({ arc: arc.id, title: "Fix the render", ...BARE_WORK, capabilities: [render!.id], waitsFor: [event, owner] });
    const unrelated = await flight.addIncrement({ arc: arc.id, title: "Other work", ...BARE_WORK, capabilities: [other!.id], links: [elsewhere.id], waitsFor: [event] });
    const ownerOnly = await flight.addIncrement({ arc: arc.id, title: "Waits for the owner", ...BARE_WORK, links: [lag.id], waitsFor: [owner] });
    const fields = async (id: string) => (await records.get(id))?.fields as { body: string; waitsFor?: unknown };
    const stamp = readAt(((await fields(listed.id)).waitsFor as { reviewed?: unknown }[] | undefined)?.[1]?.reviewed, parking);

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
    assert.deepEqual((await fields(listed.id)).waitsFor, [{ ...owner, reviewed: stamp }], "its owner wait stays");
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

function readAt(stamp: unknown, from: string): string {
  assert.match(String(stamp), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `stamped with the instant of the write, not only its day: ${String(stamp)}`);
  assert.ok(String(stamp) >= from && String(stamp) <= new Date().toISOString(), `${String(stamp)} is the instant of the write, at or after ${from}`);
  return String(stamp);
}
