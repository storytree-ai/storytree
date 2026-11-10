/**
 * Capability 12 · Owner questions (ADR-0640): one test per contract 12.1-12.13 and 12.15-12.18 in the library story (12.14 is in commands.test.ts),
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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

  contract("12.3", "an open increment held on an open question reads as waiting on the owner; a settled question, or one that does not exist, holds nothing", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
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
    await records.edit(question.id, { lifecycle: "settled", answer: "Mailgun", settledAt: new Date().toISOString() });
    assert.deepEqual(await flight.heldOnQuestion(open.id), [], "a settled question holds nothing, even named in heldOn");
    await flight.closeIncrement(open.id, { pr: "#3", disposition: "landed" });
    assert.equal((await flight.arcView(arc.id))?.state, "closed");

    // A link to a question that does not exist (written around the check) holds nothing.
    const orphan = await flight.addIncrement({ arc: arc.id, ...WORK });
    await records.edit(orphan.id, { heldOn: ["question_000000000000"] });
    assert.deepEqual(await flight.heldOnQuestion(orphan.id), []);
  });

  contract("12.4", "a question an increment is held on cannot be retired", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
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
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, leaseDays: 1 });
    await flight.settleQuestion(question.id, { answer: "Mailgun" });

    const history = await transactions.history();
    await assert.rejects(flight.renewQuestion(question.id), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const far = new Date(Date.parse(question.fields.verifiedAt ?? "") + 30 * DAY);
    assert.equal((await flight.checkQuestion(question.id, far))?.state, "settled");
    assert.deepEqual(await flight.lapsedQuestions(far), [], "a settled question is not drained");
  });

  contract("12.7", "an open question's wording is corrected in place, only the named fields; its arc, lifecycle, answer and lease are not edited so, and a settled question refuses a wording edit, or a links edit that drops a link, with nothing written, but takes a links addition", async ({ flight, knowledge, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });

    const edited = await flight.editQuestion(question.id, { options: "Mailgun, SES or Postmark" });
    assert.deepEqual(edited?.fields, { ...question.fields, options: "Mailgun, SES or Postmark" });
    const cleared = await flight.editQuestion(question.id, { recommendation: undefined });
    assert.equal(cleared?.fields.recommendation, undefined);

    const history = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { arc: arc.id } as never), RangeError);
    await assert.rejects(flight.editQuestion(question.id, { answer: "Mailgun" } as never), RangeError);
    const answered = await flight.settleQuestion(question.id, { answer: "Mailgun" });
    const settled = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { options: "Too late" }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    const research = await knowledge.recordDecision({ status: "accepted", title: "Mailgun's API is the simplest", text: "Measured." });
    const other = await knowledge.recordDecision({ status: "accepted", title: "SES is the cheapest", text: "Priced." });
    const evidence = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { links: [research.id], options: "Too late" }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.deepEqual(await transactions.history(), evidence, "nothing was written");
    assert.equal(history.length + 1, settled.length, "only the settlement was written");

    const linked = await flight.editQuestion(question.id, { links: [research.id] });
    assert.deepEqual(linked?.fields, { ...answered?.fields, links: [research.id] }, "a settled question gains a link, its answer standing");
    const gained = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { links: [other.id] }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message), "it keeps every link it had");
    assert.deepEqual(await transactions.history(), gained, "nothing was written");
    assert.equal(await flight.editQuestion("question_000000000000", { options: "x" }), null, "null for no question");
  });

  contract("12.17", "a question is raised linking the evidence it cites: the ids it is given, then every live note, decision, increment or other question its words name, each once; a given link to the plan, an arc or no record is refused with nothing written", async ({ work, flight, knowledge, transactions }) => {
    const arc = await flight.createArc(ARC);
    const given = await knowledge.recordDecision({ status: "accepted", title: "Send through Mailgun", text: "Its API is the simplest" });
    const named = await knowledge.recordDecision({ status: "accepted", title: "One mail service", text: "One." });
    const increment = await flight.addIncrement({ arc: arc.id, ...WORK });
    const earlier = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const story = await work.addStory({ title: "Visitor can sign up" });

    const question = await flight.raiseQuestion({
      arc: arc.id,
      ...ASK,
      links: [given.id],
      context: `As ${named.id} and ${given.id} say, ${increment.id} waits; ${earlier.id} asked first. Not ${story.id} nor ${arc.id}, nor question_000000000000 or voice.note_0123456789ab.`,
    });
    assert.deepEqual(question.fields.links, [given.id, named.id, increment.id, earlier.id], "given first, then named, each once, never the plan, an arc, a missing record or a voice note");
    const plain = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    assert.equal(plain.fields.links, undefined, "a question citing nothing carries no links");

    const history = await transactions.history();
    for (const wrong of [story.id, arc.id, "question_000000000000"]) {
      await assert.rejects(flight.raiseQuestion({ arc: arc.id, ...ASK, links: [wrong] }), MissingReferenceError, `a link to ${wrong} is refused`);
    }
    assert.deepEqual(await transactions.history(), history, "nothing was written");
  });

  contract("12.18", "linking a question's named evidence adds every live record its words name that it does not link yet, open or settled, keeping its links and wording; one with nothing new writes nothing", async ({ flight, knowledge, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const kept = await knowledge.recordDecision({ status: "accepted", title: "Send through Mailgun", text: "Its API is the simplest" });
    const named = await knowledge.recordDecision({ status: "accepted", title: "One mail service", text: "One." });
    await flight.editQuestion(question.id, { links: [kept.id], context: `See ${named.id} and ${kept.id}; ${question.id} asks it.` });
    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun" });

    const linked = await flight.linkNamedEvidence(question.id);
    assert.deepEqual(linked?.fields, { ...settled?.fields, links: [kept.id, named.id] }, "never itself");
    const history = await transactions.history();
    assert.deepEqual((await flight.linkNamedEvidence(question.id))?.fields, linked?.fields);
    assert.deepEqual(await transactions.history(), history, "nothing new to link writes nothing");
    assert.equal(await flight.linkNamedEvidence("question_000000000000"), null, "null for no question");
  });

  contract("12.10", "an open question carries the session putting it to the owner, set and cleared in place; settling clears it, and a settled question cannot carry one", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK });
    const presenting = { session: "session-A", since: "2026-10-10T09:00:00.000Z" };

    const marked = await flight.editQuestion(question.id, { presenting });
    assert.deepEqual(marked?.fields.presenting, presenting);
    const cleared = await flight.editQuestion(question.id, { presenting: undefined });
    assert.equal(cleared?.fields.presenting, undefined);

    await flight.editQuestion(question.id, { presenting });
    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun" });
    assert.equal(settled?.fields.presenting, undefined, "settling clears who is putting it to him");

    const history = await transactions.history();
    await assert.rejects(flight.editQuestion(question.id, { presenting }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.deepEqual(await transactions.history(), history, "nothing was written");
  });

  contract("12.11", "an open question moves to another arc in place, keeping its id, wording and holders, the history recording why; a parked arc takes it, and a closed or missing arc, its own arc or a settled question is refused with nothing written", async ({ work, flight, records, transactions }) => {
    const from = await flight.createArc(ARC);
    const to = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: from.id, ...ASK });
    const held = await flight.addIncrement({ arc: from.id, ...WORK, heldOn: [question.id] });

    const moved = await flight.moveQuestion(question.id, to.id, "asked under the launch arc", { actor: "agent-m" });
    assert.equal(moved?.id, question.id, "the same question, not a copy");
    assert.deepEqual(moved?.fields, { ...question.fields, arc: to.id }, "only its arc changed");
    assert.deepEqual((await flight.questions(to.id)).map(({ id }) => id), [question.id]);
    assert.deepEqual(await flight.questions(from.id), []);
    assert.deepEqual(await flight.heldOnQuestion(held.id), [question.id], "work held on it still waits on it");
    const last = (await transactions.history({ id: question.id })).at(-1);
    assert.equal(last?.reason, "asked under the launch arc", "the history keeps why it moved");
    assert.equal(last?.actor, "agent-m");

    // Moving the last open question off an arc whose work is done closes it, clearing the waits on it (10.33).
    const finished = await flight.createArc(ARC);
    const shipped = await flight.addIncrement({ arc: finished.id, ...WORK });
    await flight.closeIncrement(shipped.id, { pr: "#2", disposition: "landed" });
    const lastAsk = await flight.raiseQuestion({ arc: finished.id, ...ASK });
    const waiter = await flight.createArc(ARC);
    await flight.addWait(waiter.id, finished.id, "after the finished arc");
    await flight.moveQuestion(lastAsk.id, to.id, "still asked, under the launch");
    assert.equal((await flight.arcView(finished.id))?.state, "closed");
    assert.equal(((await records.get(waiter.id))?.fields as { waits?: unknown } | undefined)?.waits, undefined, "the wait on the arc it closed is cleared");

    // A parked arc raises no questions, but a moved one parks with it (ADR-0835 D2).
    const parked = await flight.createArc(ARC);
    await flight.parkArc(parked.id);
    assert.equal((await flight.moveQuestion(question.id, parked.id, "waits with the parked work"))?.fields.arc, parked.id);

    const closed = await flight.createArc(ARC);
    const done = await flight.addIncrement({ arc: closed.id, ...WORK });
    await flight.closeIncrement(done.id, { pr: "#1", disposition: "landed" });
    const settledQuestion = await flight.raiseQuestion({ arc: to.id, ...ASK });
    await flight.settleQuestion(settledQuestion.id, { answer: "Mailgun" });
    const history = await transactions.history();
    await assert.rejects(flight.moveQuestion(question.id, closed.id, "too late"), (error: unknown) => error instanceof RangeError && error.message.includes("closed"));
    await assert.rejects(flight.moveQuestion(question.id, parked.id, "again"), (error: unknown) => error instanceof RangeError && error.message.includes("already"));
    await assert.rejects(flight.moveQuestion(settledQuestion.id, from.id, "answered"), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    await assert.rejects(flight.moveQuestion(question.id, "arc_000000000000", "nowhere"), MissingReferenceError);
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    assert.equal(await flight.moveQuestion("question_000000000000", to.id, "ghost"), null, "null for no question");
  });

  contract("12.12", "an open question takes a would-be answer, stamped with its time; a later one replaces it while open, and a settled question refuses one", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });
    assert.equal(await flight.questionPrediction(question.id), null, "none until one is recorded");

    const first = await flight.predictQuestion(question.id, { pick: 1, confidence: "high", why: "Its API is the simplest" });
    const read = await flight.questionPrediction(question.id);
    assert.deepEqual(
      { pick: read?.fields.pick, confidence: read?.fields.confidence, why: read?.fields.why },
      { pick: 1, confidence: "high", why: "Its API is the simplest" },
    );
    assert.ok(!Number.isNaN(Date.parse(read?.fields.at ?? "")), "stamped with its time");

    const second = await flight.predictQuestion(question.id, { pick: "defer", confidence: "low", why: "Neither is set up yet" });
    assert.equal(second?.id, first?.id, "the later one replaces it, not beside it");
    const replaced = await flight.questionPrediction(question.id);
    assert.deepEqual({ pick: replaced?.fields.pick, confidence: replaced?.fields.confidence, why: replaced?.fields.why }, { pick: "defer", confidence: "low", why: "Neither is set up yet" });

    await assert.rejects(flight.predictQuestion(question.id, { pick: 0, confidence: "high", why: "x" }), SchemaError, "a pick is an option by number, retire or defer");
    await assert.rejects(flight.predictQuestion(question.id, { pick: 1, confidence: "sure" as never, why: "x" }), SchemaError, "confidence is high, medium or low");

    await flight.settleQuestion(question.id, { answer: "Mailgun" });
    const history = await transactions.history();
    await assert.rejects(
      flight.predictQuestion(question.id, { pick: 2, confidence: "medium", why: "Too late" }),
      (error: unknown) => error instanceof RangeError && error.message.includes(question.id) && /settled/.test(error.message),
      "a settled question refuses one, naming it",
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    assert.equal(await flight.predictQuestion("question_000000000000", { pick: 1, confidence: "high", why: "x" }), null, "null for no question");
  });

  contract("12.13", "a settled question takes one score, for its would-be answer and its raiser's recommendation, with who scored it and when; an open or already scored question refuses it", async ({ work, flight, records, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });
    await flight.predictQuestion(question.id, { pick: 2, confidence: "medium", why: "SES is cheaper" });

    const open = await transactions.history();
    await assert.rejects(flight.scoreQuestion(question.id, { prediction: "different", recommendation: "match", by: "lane" }), (error: unknown) => error instanceof RangeError && /open/.test(error.message), "an open question refuses a score");
    assert.deepEqual(await transactions.history(), open, "nothing was written");

    await flight.settleQuestion(question.id, { answer: "Mailgun" });
    await assert.rejects(flight.scoreQuestion(question.id, { recommendation: "match", by: "lane" }), RangeError, "a question with a would-be answer is scored for it too");
    await assert.rejects(flight.scoreQuestion(question.id, { prediction: "different", recommendation: "sort of" as never, by: "lane" }), SchemaError, "each is match, match with changes, different or rejected");
    const scored = await flight.scoreQuestion(question.id, { prediction: "different", recommendation: "match", by: "lane" });
    assert.deepEqual({ ...scored?.fields.score, at: undefined }, { prediction: "different", recommendation: "match", by: "lane", at: undefined });
    assert.ok(!Number.isNaN(Date.parse(scored?.fields.score?.at ?? "")), "stamped with when it was scored");

    const once = await transactions.history();
    await assert.rejects(flight.scoreQuestion(question.id, { prediction: "match", recommendation: "match", by: "lane" }), (error: unknown) => error instanceof RangeError && /already scored/.test(error.message), "it takes one score");
    assert.deepEqual(await transactions.history(), once, "nothing was written");

    // A question with no would-be answer still takes the raiser's score alone, so the baseline keeps counting.
    const unpredicted = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "SES" });
    await flight.settleQuestion(unpredicted.id, { answer: "SES, with changes" });
    await assert.rejects(flight.scoreQuestion(unpredicted.id, { prediction: "match", recommendation: "match", by: "lane" }), RangeError, "no would-be answer, nothing to score for it");
    const alone = await flight.scoreQuestion(unpredicted.id, { recommendation: "match-with-changes", by: "lane" });
    assert.equal(alone?.fields.score?.recommendation, "match-with-changes");
    assert.equal(alone?.fields.score?.prediction, undefined);
    assert.equal(await flight.scoreQuestion("question_000000000000", { recommendation: "match", by: "lane" }), null, "null for no question");

    // A recommendation that declines to recommend ("None: …", with its why) is none: unscored, and left out of the deviation.
    const declined = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "None: the trial measures your reading, so a recommendation would bias it." });
    await flight.predictQuestion(declined.id, { pick: 1, confidence: "low", why: "x" });
    await flight.settleQuestion(declined.id, { answer: "Mailgun" });
    await assert.rejects(flight.scoreQuestion(declined.id, { prediction: "match", recommendation: "different", by: "lane" }), RangeError, "a declined recommendation takes no verdict");
    const unrecommended = await flight.scoreQuestion(declined.id, { prediction: "match", by: "lane" });
    assert.equal(unrecommended?.fields.score?.recommendation, undefined);
    const before = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "none — he reads it cold" });
    await flight.settleQuestion(before.id, { answer: "SES" });
    await records.edit(before.id, { score: { recommendation: "different", by: "lane", at: new Date().toISOString() } });
    const { bands } = await flight.questionDeviation(new Date(0));
    const counted = bands.reduce((sum, { recommendation }) => ({ match: sum.match + recommendation.match, "match-with-changes": sum["match-with-changes"] + recommendation["match-with-changes"], different: sum.different + recommendation.different }), { match: 0, "match-with-changes": 0, different: 0 });
    assert.deepEqual(counted, { match: 1, "match-with-changes": 1, different: 0 }, "the recommendations scored are counted; a declined one's verdict is not, even one scored before");
  });

  contract("12.15", "an open question carries a prep mark, set in place: when and its stance, with the reason; edited after its mark it reads unprepared, and settling keeps the mark", async ({ work, flight, transactions }) => {
    const arc = await flight.createArc(ARC);
    const question = await flight.raiseQuestion({ arc: arc.id, ...ASK, recommendation: "Mailgun" });

    const history = await transactions.history();
    await assert.rejects(flight.prepQuestion(question.id, { stance: "differs" }), SchemaError, "a stance that differs or proposes retire says why");
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const agreed = await flight.prepQuestion(question.id, { stance: "agrees" });
    assert.equal(agreed?.fields.prep?.stance, "agrees");
    assert.ok(!Number.isNaN(Date.parse(agreed?.fields.prep?.at ?? "")), "stamped with when it was prepped");
    assert.equal(agreed?.fields.prep?.editedAt, undefined, "prepped on its current wording");

    const presented = await flight.editQuestion(question.id, { presenting: { session: "s", since: "2026-11-04T00:00:00.000Z" } });
    assert.equal(presented?.fields.prep?.editedAt, undefined, "being put to him is no edit of what it asks");
    const edited = await flight.editQuestion(question.id, { options: "Mailgun, SES or Postmark" });
    assert.ok(edited?.fields.prep?.editedAt !== undefined, "edited after its mark, it reads unprepared");
    assert.equal(edited?.fields.prep?.stance, "agrees", "the mark itself stays");

    const retire = await flight.prepQuestion(question.id, { stance: "retire", reason: "Postmark settles it already" });
    assert.deepEqual({ ...retire?.fields.prep, at: undefined }, { stance: "retire", reason: "Postmark settles it already", at: undefined }, "a new mark replaces it, prepared again");

    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun" });
    assert.equal(settled?.fields.prep?.stance, "retire", "settling keeps the mark as the record of its prep");
    await assert.rejects(flight.prepQuestion(question.id, { stance: "agrees" }), (error: unknown) => error instanceof RangeError && /settled/.test(error.message));
    assert.equal(await flight.prepQuestion("question_000000000000", { stance: "agrees" }), null, "null for no question");
  });

  contract("12.16", "the lapsed list holds only open questions whose lease has lapsed, across every arc, longest lapsed first; fresh and settled ones are left out, and gathering it neither settles nor renews one", async ({ work, flight, transactions }) => {
    const launch = await flight.createArc(ARC);
    const polish = await flight.createArc({ title: "Polish", intent: "Tidy", endState: "Tidy" });
    const first = await flight.raiseQuestion({ arc: polish.id, ...ASK, title: "Which font?", leaseDays: 3 });
    const settled = await flight.raiseQuestion({ arc: launch.id, ...ASK, leaseDays: 1 });
    const second = await flight.raiseQuestion({ arc: launch.id, ...ASK, title: "Which host?", leaseDays: 1 });
    await flight.raiseQuestion({ arc: polish.id, ...ASK, title: "Which colour?" });
    await flight.settleQuestion(settled.id, { answer: "Mailgun" });

    assert.deepEqual(await flight.lapsedQuestions(), [], "fresh questions are not due for review");
    const history = await transactions.history();
    const now = new Date(Date.parse(first.fields.verifiedAt ?? "") + 4 * DAY);
    assert.deepEqual((await flight.lapsedQuestions(now)).map(({ id }) => id), [second.id, first.id], "ordered by lease expiry, not creation");
    assert.deepEqual(await transactions.history(), history, "gathering the list neither settles nor renews");
  });
}
