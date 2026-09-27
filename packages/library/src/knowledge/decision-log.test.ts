/**
 * Capability 13 · Decision log (ADR-0640): one test per contract 13.1-13.4 in the library story,
 * each run on BOTH backends:
 *
 * - memory: Knowledge layers over one fresh MemoryTransactions; "separate connections" are two
 *   Knowledge layers over it, each with its own SchemaRecords;
 * - postgres: the `knowledge` of a fresh project on the server `pnpm test` provides, opened twice
 *   for separate connections (two pools), and dropped afterwards, pass or fail.
 *
 * Whether anything was written is judged one layer down: an unchanged history means nothing was.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { SchemaError, SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, NumberTakenError, type Transactions } from "../transactions/index.js";
import { Knowledge, SupersessionLoopError } from "./index.js";

interface Library {
  readonly knowledge: Knowledge;
  /** The same project, reached through a connection of its own. */
  readonly other: Knowledge;
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
      knowledge: new Knowledge(records),
      other: new Knowledge(new SchemaRecords(transactions)),
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
    const first = await connect({ url: testServerUrl() });
    const second = await connect({ url: testServerUrl() });
    const cleanup = async (): Promise<void> => {
      try {
        await Promise.all([first.close(), second.close()]);
      } finally {
        await dropTestDatabases([`storytree_${name}`]);
      }
    };
    try {
      const project = await first.openProject(name);
      const again = await second.openProject(name);
      return { knowledge: project.knowledge, other: again.knowledge, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

const DECIDE = { title: "Send through Mailgun", text: "Its API is the simplest.", status: "accepted" } as const;

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

  contract("13.1", "decisions recorded at once from separate connections get distinct numbers, each higher than any before, never reused", async ({ knowledge, other, records, transactions }) => {
    const first = await knowledge.recordDecision(DECIDE);
    assert.equal(first.fields.number, 1, "a project's first decision is number 1");

    const raced = await Promise.all(
      Array.from({ length: 6 }, (_, n) => (n % 2 === 0 ? knowledge : other).recordDecision({ ...DECIDE, title: `Raced ${n}` })),
    );
    const numbers = raced.map((decision) => decision.fields.number ?? 0);
    assert.equal(new Set(numbers).size, 6, `distinct: ${numbers.join(", ")}`);
    assert.ok(numbers.every((number) => number > 1), "each higher than any before");
    assert.deepEqual([...numbers].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);

    // A retired decision's number is never handed out again.
    const last = raced.find((decision) => decision.fields.number === 7)!;
    await records.retire(last.id, "recorded by mistake");
    assert.equal((await knowledge.recordDecision(DECIDE)).fields.number, 8);

    // A decision brought in under its own number (the one-copy lane loading 0.2's, N1) keeps it, and
    // numbering continues after it; a number already used is refused, with nothing written.
    assert.equal((await knowledge.recordDecision({ ...DECIDE, number: 640 })).fields.number, 640);
    assert.equal((await other.recordDecision(DECIDE)).fields.number, 641);
    const history = await transactions.history();
    await assert.rejects(knowledge.recordDecision({ ...DECIDE, number: 7 }), NumberTakenError, "7 was used, though retired");
    assert.deepEqual(await transactions.history(), history, "nothing was written");
    await assert.rejects(knowledge.editNote(first.id, { number: 900 } as never), RangeError, "a number never changes");
  });

  contract("13.5", "storytree repairs a number once from its own Full record line, preserving history and refusing unsafe repairs", async ({ records, transactions, knowledge }) => {
    const own = new Knowledge(records, "storytree");
    const imported = await records.create("decision", { ...DECIDE, number: 1, text: "Summary.\nFull record: ADR-0621 in 0.2." });
    const unnumbered = await transactions.save({ id: "legacy-decision", type: "decision", version: 1, fields: { title: "Legacy import", text: "Full record: ADR-0169 in 0.2." } });
    const founding = await records.create("decision", { ...DECIDE, number: 2 });
    const retired = await records.create("decision", { ...DECIDE, number: 3, text: "Full record: ADR-0623" });
    await records.retire(retired.id, "retired");
    const taken = await records.create("decision", { ...DECIDE, number: 640 });
    await records.retire(taken.id, "still reserves its number");
    const collision = await records.create("decision", { ...DECIDE, number: 4, text: "Full record: ADR-0640" });
    const malformed = [];
    for (const text of ["Mention Full record: ADR-0621", "Full record: ADR-0621x", "Full record: ADR-0621\nFull record: ADR-0622", "Full record: ADR-0000"]) {
      malformed.push(await records.create("decision", { ...DECIDE, text }));
    }
    const before = await transactions.history();
    const plan = await own.decisionNumberPlan();
    assert.deepEqual(plan.find((row) => row.id === imported.id), { id: imported.id, oldNumber: 1, number: 621 });
    assert.match(plan.find((row) => row.id === collision.id)?.refusal ?? "", /taken/);
    assert.ok(!plan.some((row) => row.id === founding.id || row.id === retired.id));
    for (const record of malformed) await assert.rejects(own.numberDecision(record.id, 621), /Full record/);
    await assert.rejects(own.numberDecision(imported.id, 622), /Full record/);
    await assert.rejects(own.numberDecision(founding.id, 622), /Full record/);
    await assert.rejects(own.numberDecision(retired.id, 623), /live decision/);
    await assert.rejects(own.numberDecision("missing", 623), /live decision/);
    await assert.rejects(own.numberDecision(collision.id, 640), NumberTakenError);
    await assert.rejects(knowledge.numberDecision(imported.id, 621), /storytree project/);
    await assert.rejects(own.editNote(imported.id, { number: 621 }), /editNote does not change/);
    assert.deepEqual(await transactions.history(), before, "dry run and refusals write nothing");

    const repaired = await own.numberDecision(imported.id, 621, { actor: "supervisor" });
    assert.deepEqual(repaired.fields, { ...imported.fields, number: 621 });
    const upgraded = await own.numberDecision(unnumbered.id, 169);
    assert.equal(upgraded.fields.number, 169);
    assert.equal(upgraded.fields.status, "accepted", "normal legacy schema upgrade is preserved");
    assert.deepEqual(await records.get(founding.id), founding, "founding book is untouched");
    const history = await records.history({ id: imported.id });
    assert.deepEqual(history.map((entry) => entry.record.fields.number), [1, 621]);
    assert.equal(history.at(-1)?.actor, "supervisor");
    await assert.rejects(own.recordDecision({ ...DECIDE, number: 1 }), NumberTakenError, "old number remains reserved");
    await assert.rejects(own.numberDecision(imported.id, 621), /already/);
    await own.editNote(imported.id, { text: "Full record: ADR-0622" });
    await assert.rejects(own.numberDecision(imported.id, 622), /already/);
  });

  contract("13.5", "simultaneous repairs cannot share a number or repair the same decision twice", async ({ records }) => {
    const own = new Knowledge(records, "storytree");
    const a = await records.create("decision", { ...DECIDE, number: 1, text: "Full record: ADR-0621" });
    const b = await records.create("decision", { ...DECIDE, number: 2, text: "Full record: ADR-0621" });
    const plan = await own.decisionNumberPlan();
    assert.ok(plan.every((row) => row.refusal?.includes("same Full record")), "dry run identifies duplicate targets");
    const raced = await Promise.allSettled([own.numberDecision(a.id, 621), own.numberDecision(b.id, 621)]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    const loser = raced.find((result) => result.status === "rejected");
    assert.ok(loser?.status === "rejected" && loser.reason instanceof NumberTakenError);
    const c = await records.create("decision", { ...DECIDE, text: "Full record: ADR-0623" });
    const same = await Promise.allSettled([own.numberDecision(c.id, 623), own.numberDecision(c.id, 623)]);
    assert.equal(same.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await records.history({ id: c.id })).length, 2);
  });

  contract("13.6", "only storytree requires an explicit decision number from 0.2", async ({ records, knowledge, transactions }) => {
    const own = new Knowledge(records, "storytree");
    const history = await transactions.history();
    await assert.rejects(own.recordDecision(DECIDE), /0\.2.*adr new.*until cutover.*explicit/i);
    assert.deepEqual(await transactions.history(), history);
    assert.equal((await knowledge.recordDecision(DECIDE)).fields.number, 1);
    assert.equal((await own.recordDecision({ ...DECIDE, number: 660 })).fields.number, 660);
  });

  contract("13.7", "Full record bulk repair previews by default, reports refusals, and skips completed repairs", async ({ records, transactions, knowledge }) => {
    const own = new Knowledge(records, "storytree");
    const imported = await records.create("decision", { ...DECIDE, number: 1, text: "Full record: ADR-0621" });
    const founding = await records.create("decision", { ...DECIDE, number: 2 });
    const correct = await records.create("decision", { ...DECIDE, number: 622, text: "Full record: ADR-0622" });
    const collision = await records.create("decision", { ...DECIDE, number: 3, text: "Full record: ADR-0622" });
    const malformed = await records.create("decision", { ...DECIDE, text: "Full record: ADR-0623x" });
    const duplicate = await Promise.all([1, 2].map(() => records.create("decision", { ...DECIDE, text: "Full record: ADR-0624" })));
    const before = await transactions.history();

    const preview = await own.numberDecisionsFromFullRecord();
    assert.equal(preview.length, 5);
    assert.deepEqual(preview.find((row) => row.id === imported.id), { id: imported.id, oldNumber: 1, number: 621 });
    assert.match(preview.find((row) => row.id === collision.id)?.refusal ?? "", /taken/);
    assert.match(preview.find((row) => row.id === malformed.id)?.refusal ?? "", /Full record/);
    for (const record of duplicate) assert.match(preview.find((row) => row.id === record.id)?.refusal ?? "", /same Full record/);
    await assert.rejects(knowledge.numberDecisionsFromFullRecord({ apply: true }), /storytree project/);
    assert.deepEqual(await transactions.history(), before, "default preview and refusal write nothing");

    assert.deepEqual(await own.numberDecisionsFromFullRecord({ apply: true, actor: "supervisor" }), preview);
    assert.deepEqual((await records.get(imported.id))?.fields, { ...imported.fields, number: 621 });
    assert.deepEqual(await records.get(founding.id), founding);
    assert.deepEqual(await records.get(correct.id), correct);
    const history = await records.history({ id: imported.id });
    assert.equal(history.at(-1)?.actor, "supervisor");
    assert.deepEqual(history.map((entry) => entry.record.fields.number), [1, 621]);
    assert.equal((await transactions.history()).length, before.length + 1);
    assert.deepEqual(await own.decisionNumberPlan(), preview.filter((row) => row.id !== imported.id));
    const after = await transactions.history();
    await own.numberDecisionsFromFullRecord({ apply: true });
    assert.deepEqual(await transactions.history(), after, "repeat apply writes nothing");
  });

  contract("13.5", "repair refuses numbers any record ever held, including a collision arriving after preview", async ({ records, transactions }) => {
    const own = new Knowledge(records, "storytree");
    const imported = await records.create("decision", { ...DECIDE, number: 1, text: "Full record: ADR-0621" });
    // Transaction history may contain old or foreign schemas; every record counts.
    await transactions.save({ id: "old-kind", type: "legacy", fields: { number: 621 } });
    await transactions.retire({ id: "old-kind", reason: "retired" });
    const definition = await records.create("definition", { term: "A term", meaning: "Full record: ADR-0621" });
    const before = await transactions.history();
    assert.match((await own.decisionNumberPlan())[0]?.refusal ?? "", /taken/);
    await assert.rejects(own.numberDecision(imported.id, 621), NumberTakenError);
    await assert.rejects(own.numberDecision(definition.id, 621), /live decision/);
    assert.deepEqual(await transactions.history(), before);

    const later = await records.create("decision", { ...DECIDE, number: 2, text: "Full record: ADR-0622" });
    // Insert a competing writer after preflight reads history, before the repair takes its lock.
    const history = records.history.bind(records);
    records.history = async (filter) => {
      const read = await history(filter);
      await transactions.save({ id: "racing-kind", type: "legacy", fields: { number: 622 } });
      return read;
    };
    await assert.rejects(own.numberDecision(later.id, 622), NumberTakenError);
    assert.deepEqual(await records.get(later.id), later);
    assert.equal((await history({ id: later.id })).length, 1, "atomic refusal wrote no repair");
  });

  contract("13.2", "a decision is superseded exactly when an accepted decision names it in supersedes; it stays readable, and a supersession loop is refused", async ({ knowledge, records, transactions }) => {
    const story = await records.create("story", { title: "Visitor can sign up" });
    const old = await knowledge.recordDecision({ ...DECIDE, frontCoverOf: story.id });
    assert.equal((await knowledge.decision(old.id))?.status, "accepted");

    const proposal = await knowledge.recordDecision({ ...DECIDE, title: "Send through SES", status: "proposed", supersedes: [old.id] });
    assert.equal((await knowledge.decision(old.id))?.status, "accepted", "a proposal supersedes nothing yet");
    assert.deepEqual((await knowledge.frontCovers(story.id)).map(({ id }) => id), [old.id]);

    await knowledge.editNote(proposal.id, { status: "accepted", frontCoverOf: story.id });
    const read = await knowledge.decision(old.id);
    assert.equal(read?.status, "superseded");
    assert.deepEqual(read?.supersededBy, [proposal.id]);
    assert.equal(read?.record.fields.text, DECIDE.text, "its wording stays readable");
    assert.deepEqual((await knowledge.frontCovers(story.id)).map(({ id }) => id), [proposal.id], "it leaves its shelf, and its successor takes the place (13-b)");
    assert.deepEqual(await knowledge.relatedNotes(old.id), [], "supersedes is never a link (13-c)");

    const history = await transactions.history();
    await assert.rejects(
      knowledge.editNote(old.id, { supersedes: [proposal.id] }),
      (error: unknown) => error instanceof SupersessionLoopError && error.message.includes(`${old.id} → ${proposal.id} → ${old.id}`),
    );
    await assert.rejects(knowledge.editNote(old.id, { supersedes: [old.id] }), SupersessionLoopError);
    assert.deepEqual(await transactions.history(), history, "nothing was written");
  });

  contract("13.3", "status and the load-bearing mark are stored and read back, and a decision written before status was is upgraded to carry one", async ({ knowledge, records, transactions }) => {
    const history = await transactions.history();
    await assert.rejects(
      knowledge.recordDecision({ title: "No status", text: "?" } as never),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("status"),
    );
    assert.deepEqual(await transactions.history(), history, "nothing was written");

    const marked = await knowledge.recordDecision({
      ...DECIDE,
      status: "proposed",
      loadBearing: true,
      authority: { basis: "owner-directed", scribedBy: "cli@main", at: "2026-09-27", ownerSaid: "yes, Mailgun" },
    });
    const read = await records.get(marked.id);
    assert.equal(read?.type === "decision" && read.fields.status, "proposed");
    assert.equal(read?.type === "decision" && read.fields.loadBearing, true);
    assert.equal(read?.type === "decision" && read.fields.authority?.ownerSaid, "yes, Mailgun", "who decided, in their own words");
    await assert.rejects(
      knowledge.recordDecision({ ...DECIDE, authority: { basis: "owner-ratified", scribedBy: "cli@main", at: "2026-09-27" } }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("authority"),
      "a stamp claiming the owner quotes him",
    );

    // A decision as storytree wrote it before (version 1): a title, a text and a cover.
    await transactions.save({ id: "decision-old", type: "decision", version: 1, fields: { title: "Old", text: "Decided before status" } });
    const upgraded = await records.get("decision-old");
    assert.equal(upgraded?.version, 2);
    assert.equal(upgraded?.type === "decision" && upgraded.fields.status, "accepted", "what was recorded as decided reads accepted");
  });

  contract("13.4", "a decision may carry one composed statement, read as stale once the decision's text changed after it, and the full text is always readable", async ({ knowledge }) => {
    const decision = await knowledge.recordDecision(DECIDE);
    assert.equal((await knowledge.decision(decision.id))?.composed, undefined, "none until one is composed");

    await knowledge.composeStatement(decision.id, "Mail goes through Mailgun.");
    const fresh = await knowledge.decision(decision.id);
    assert.equal(fresh?.composed?.statement, "Mail goes through Mailgun.");
    assert.equal(fresh?.composed?.stale, false);

    await knowledge.composeStatement(decision.id, "All mail goes through Mailgun.");
    assert.equal((await knowledge.decision(decision.id))?.composed?.statement, "All mail goes through Mailgun.", "one statement, replaced");

    await knowledge.editNote(decision.id, { title: "Mail through Mailgun" });
    assert.equal((await knowledge.decision(decision.id))?.composed?.stale, false, "only a change of text makes it stale");
    await knowledge.editNote(decision.id, { text: "Its API is the simplest, and it is cheap." });
    const stale = await knowledge.decision(decision.id);
    assert.equal(stale?.composed?.stale, true);
    assert.equal(stale?.composed?.statement, "All mail goes through Mailgun.", "kept, marked stale");
    assert.equal(stale?.record.fields.text, "Its API is the simplest, and it is cheap.", "and the full text reads as it is");
    assert.equal(await knowledge.composeStatement("decision_000000000000", "?"), null);
  });
}
