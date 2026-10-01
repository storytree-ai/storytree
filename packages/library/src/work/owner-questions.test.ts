/**
 * Capability 12 · Owner questions (ADR-0640): one test per contract 12.1-12.4 in the library story,
 * and the half of 10.3 that waits for questions, each run on BOTH backends: a WorkModel, a
 * WorkInFlight and a Knowledge over a fresh MemoryTransactions, and those of a fresh Postgres
 * project, dropped afterwards, pass or fail.
 *
 * Whether anything was written is judged one layer down: an unchanged history means nothing was.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Knowledge } from "../knowledge/index.js";
import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SchemaError, SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { RetireRefusedError, WorkInFlight, WorkModel } from "./index.js";

interface Library {
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly knowledge: Knowledge;
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
    return {
      work: new WorkModel(records),
      flight: new WorkInFlight(records),
      knowledge: new Knowledge(records),
      records,
      transactions,
      cleanup: async () => {},
    };
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
      const { work, flight, knowledge, records, transactions } = await storytree.openProject(name);
      return { work, flight, knowledge, records, transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const ARC = { title: "Launch", intent: "Ship sign-up", endState: "Visitors can sign up" };
const WORK = { title: "Email form", objective: "Build it", body: "The steps." };
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

  contract("12.1", "a question is raised with its required fields, and is open", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });
    assert.equal(question.type, "question");
    assert.equal(question.fields.lifecycle, "open");
    assert.ok(!Number.isNaN(Date.parse(question.fields.verifiedAt ?? "")), "stamped as verified when raised (12-a)");
    assert.deepEqual(await flight.questions(arc.id), [question]);

    const history = await transactions.history();
    for (const field of ["title", "stakes", "statement", "context", "options"] as const) {
      const { [field]: _left, ...without } = ASK;
      await assert.rejects(
        flight.raiseQuestion({ arc: arc.id, ...without } as never),
        (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
        `a question with no ${field} is refused, naming it`,
      );
    }
    await assert.rejects(flight.raiseQuestion({ arc: "arc_000000000000", ...ASK }), MissingReferenceError, "it is raised on a live arc");
    assert.deepEqual(await transactions.history(), history, "nothing was written");
  });

  contract("12.2", "settling needs an answer and keeps it, with the date and the decision that carried it; a settled question stays readable on its arc", async ({ work, flight, knowledge, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const decision = await knowledge.recordDecision({ status: "accepted", title: "Send through Mailgun", text: "Its API is the simplest" });

    const history = await transactions.history();
    await assert.rejects(
      flight.settleQuestion(question.id, { decision: decision.id } as never),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("answer"),
      "a settlement with no answer is refused",
    );
    await assert.rejects(flight.settleQuestion(question.id, { answer: "Mailgun", decision: arc.id }), MissingReferenceError, "the decision must be a decision");
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun, for its API", decision: decision.id });
    assert.equal(settled?.fields.lifecycle, "settled");
    assert.equal(settled?.fields.answer, "Mailgun, for its API");
    assert.equal(settled?.fields.settledBy, decision.id);
    assert.ok(!Number.isNaN(Date.parse(settled?.fields.settledAt ?? "")), "with the date it was settled");
    assert.deepEqual(await flight.questions(arc.id), [settled], "it stays on its arc, answer and all");
  });

  contract("12.3", "an open increment held on an open question reads as waiting on the owner; settling releases it with no write to the increment; a question that does not exist holds nothing", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const held = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id] });
    assert.deepEqual(await flight.heldOnQuestion(held.id), [question.id]);
    await assert.rejects(flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [arc.id] }), MissingReferenceError, "it is held on a question");

    // 10.3's other half: an arc whose work is all closed still reads active while a question on it
    // waits on the owner.
    await flight.closeIncrement((await flight.addIncrement({ arc: arc.id, ...WORK })).id, { pr: "#1", disposition: "landed" });
    await flight.closeIncrement(held.id, { pr: "#2", disposition: "landed" });
    assert.deepEqual(await flight.heldOnQuestion(held.id), [], "closed work waits on nobody");
    assert.equal((await flight.arcView(arc.id))?.state, "active", "a question on it waits on the owner");

    const open = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id] });
    const before = await transactions.history({ id: open.id });
    await flight.settleQuestion(question.id, { answer: "Mailgun" });
    assert.deepEqual(await flight.heldOnQuestion(open.id), [], "settling released it");
    assert.deepEqual(await transactions.history({ id: open.id }), before, "with no write to the increment");
    await flight.closeIncrement(open.id, { pr: "#3", disposition: "landed" });
    assert.equal((await flight.arcView(arc.id))?.state, "closed");

    // A link to a question that does not exist (written around the check) holds nothing.
    const orphan = await flight.addIncrement({ arc: arc.id, ...WORK });
    await records.edit(orphan.id, { heldOn: ["question_000000000000"] });
    assert.deepEqual(await flight.heldOnQuestion(orphan.id), []);
  });

  contract("12.4", "a question an increment is held on cannot be retired", async ({ work, flight, records, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const held = await flight.addIncrement({ arc: arc.id, ...WORK, heldOn: [question.id] });

    const history = await transactions.history();
    await assert.rejects(
      flight.retire(question.id, "no longer asked"),
      (error: unknown) => error instanceof RetireRefusedError && error.heldBy.includes(held.id) && error.message.includes(held.id),
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    assert.notEqual(await records.get(question.id), null);

    await flight.editIncrement(held.id, { heldOn: undefined });
    await flight.retire(question.id, "no longer asked");
    assert.equal(await records.get(question.id), null, "with nothing held on it, it retires");
  });

  contract("12.8", "a question raised on a parked arc is refused, naming the arc, and nothing is written; once its wake day passes, it is raised", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    await flight.parkArc(arc.id);
    const history = await transactions.history();
    await assert.rejects(
      flight.raiseQuestion({ arc: arc.id, ...ASK }),
      (error: unknown) => error instanceof RangeError && error.message.includes(arc.id) && /parked/.test(error.message),
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    await flight.parkArc(arc.id, { until: "2020-01-01" });
    const raised = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    assert.equal(raised.fields.lifecycle, "open", "an arc past its wake day is active again, and takes questions");
  });
}

const DAY = 86_400_000;

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

  contract("12.5", "an open question carries a review date and a lease, 7 days unless given; it checks fresh until the lease runs out and lapsed after, and renewing re-stamps it", async ({ work, flight, records }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    assert.equal(question.fields.leaseDays, 7, "the lease is stored, 7 days by default");
    const short = await flight.raiseQuestion({ arc: arc.id, ...ASK, leaseDays: 2 });
    assert.equal(short.fields.leaseDays, 2, "or as given");

    const verified = Date.parse(question.fields.verifiedAt ?? "");
    const fresh = await flight.checkQuestion(question.id, new Date(verified + 6 * DAY));
    assert.equal(fresh?.state, "fresh");
    assert.equal(fresh?.verifiedAt, question.fields.verifiedAt);
    assert.equal(fresh?.leaseDays, 7);
    assert.equal(fresh?.lapsesAt, new Date(verified + 7 * DAY).toISOString());
    assert.equal((await flight.checkQuestion(question.id, new Date(verified + 7 * DAY)))?.state, "lapsed", "lapsed once the lease runs out");
    assert.equal((await flight.checkQuestion(short.id, new Date(verified + 3 * DAY)))?.state, "lapsed", "on its own lease");
    assert.equal((await flight.checkQuestion(question.id))?.state, "fresh", "fresh now, when no moment is given");
    assert.equal(await flight.checkQuestion("question_000000000000"), null, "null for no question");

    // The drain's list: the open questions lapsed at that moment, longest lapsed first.
    const later = new Date(verified + 10 * DAY);
    assert.deepEqual((await flight.lapsedQuestions(later)).map(({ id }) => id).sort(), [question.id, short.id].sort());
    assert.deepEqual((await flight.lapsedQuestions(new Date(verified + 3 * DAY))).map(({ id }) => id), [short.id]);

    // Renewing stamps it verified now: fresh again, with the lease it had.
    await records.edit(question.id, { verifiedAt: new Date(verified - 30 * DAY).toISOString() });
    assert.equal((await flight.checkQuestion(question.id))?.state, "lapsed");
    const renewed = await flight.renewQuestion(question.id);
    assert.ok(Date.parse(renewed?.fields.verifiedAt ?? "") >= verified, "re-stamped");
    assert.equal(renewed?.fields.leaseDays, 7);
    assert.equal((await flight.checkQuestion(question.id))?.state, "fresh");
    assert.deepEqual((await flight.lapsedQuestions()).map(({ id }) => id), []);
    assert.equal(await flight.renewQuestion("question_000000000000"), null, "null for no question");
  });

  contract("12.6", "renewing a settled question is refused, and nothing is written; a settled question checks settled and is never lapsed", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, leaseDays: 1 });
    await flight.settleQuestion(question.id, { answer: "Mailgun" });

    const history = await transactions.history();
    await assert.rejects(flight.renewQuestion(question.id), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const far = new Date(Date.parse(question.fields.verifiedAt ?? "") + 30 * DAY);
    assert.equal((await flight.checkQuestion(question.id, far))?.state, "settled");
    assert.deepEqual(await flight.lapsedQuestions(far), [], "a settled question is not drained");
  });

  contract("12.7", "an open question's wording is corrected in place, only the named fields; its arc, lifecycle, answer and lease are not edited so, and a settled question's edit is refused with nothing written", async ({ work, flight, transactions }) => {
    const arc = await work.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });

    const edited = await flight.editQuestion(question.id, { options: "Mailgun, SES or Postmark" });
    assert.deepEqual(edited?.fields, { ...question.fields, options: "Mailgun, SES or Postmark" });
    const cleared = await flight.editQuestion(question.id, { recommendation: undefined });
    assert.equal(cleared?.fields.recommendation, undefined);

    const history = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { arc: arc.id } as never), RangeError);
    await assert.rejects(flight.editQuestion(question.id, { answer: "Mailgun" } as never), RangeError);
    await flight.settleQuestion(question.id, { answer: "Mailgun" });
    const settled = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { options: "Too late" }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.deepEqual(await transactions.history(), settled, "nothing was written");
    assert.equal(history.length + 1, settled.length, "only the settlement was written");
    assert.equal(await flight.editQuestion("question_000000000000", { options: "x" }), null, "null for no question");
  });
}
