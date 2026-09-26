/**
 * Capability 13 · Decision log (ADR-0640): one test per contract 13.1-13.4 in stories/library.md,
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
