/**
 * Capability 23 · Catalogue: one test per contract 23.1-23.3 in The library story, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withLibrary } from "../testing/pg.js";
import { worklist, worklistView } from "../rounds/rounds.js";
import { newNotes, retire } from "./index.js";

test("23.1 retire retires a note nothing points at, and refuses one a live record points at, naming it", async () => {
  await withLibrary(async (library) => {
    const decision = await library.recordDecision({ title: "Send through Mailgun", text: "Simplest API.", status: "accepted" });
    const definition = await library.defineTerm({ term: "Verified domain", meaning: "Mailgun needs a verified domain.", links: [decision.id] });
    const friction = await library.writeKnowledge("friction", {
      title: "Mailgun bounced a test email",
      description: "An unverified domain bounces.",
      statement: "Mailgun refuses mail from an unverified domain.",
      evidence: "`curl https://api.mailgun.net/v3/example.com/messages` answered 403 Forbidden.",
      impact: "Sign-up emails never arrive.",
    });
    const arc = await library.createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Verify the domain", objective: "Mail arrives", body: "Add the DNS records.", remedies: [friction.id] });
    const answer = await library.recordDecision({ title: "Use Mailgun", text: "The owner chose Mailgun.", status: "accepted" });
    const question = await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "Sign-up needs one.", statement: "Which?", context: "Two options.", options: "Mailgun or Postmark." });
    await library.settleQuestion(question.id, { answer: "Mailgun", decision: answer.id });
    const lone = await library.defineTerm({ term: "Lone artifact", meaning: "An artifact nothing rests on." });
    const { cursor } = await library.changesSince(0);

    await assert.rejects(retire(library, decision.id, "overtaken"), new RegExp(`${definition.id}.*links`));
    await assert.rejects(retire(library, friction.id, "remedied"), new RegExp(`${increment.id}.*remedies`));
    await assert.rejects(retire(library, answer.id, "done"), new RegExp(`${question.id}.*settled`));
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await retire(library, lone.id, "event-specific");
    assert.deepEqual(await library.search("lone artifact"), []);
  });
});

test("23.1 retire reads every arc's increments and questions in one ask, however many arcs the project has (ADR-0836 D3)", async () => {
  await withLibrary(async (library) => {
    for (const title of ["Launch v1", "Launch v2", "Launch v3"]) {
      const arc = await library.createArc({ title, intent: "Ship sign-up", endState: "Visitors sign up" });
      await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Mail arrives", body: "Build it." });
      await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "Sign-up needs one.", statement: "Which?", context: "Two options.", options: "Mailgun or Postmark." });
    }
    const lone = await library.defineTerm({ term: "Lone artifact", meaning: "An artifact nothing rests on." });
    const asked = { arcView: 0, arcViews: 0, questions: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (key === "arcView" || key === "arcViews" || key === "questions") asked[key]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await retire(counted, lone.id, "event-specific");
    assert.deepEqual(asked, { arcView: 0, arcViews: 1, questions: 0 });
  });
});

test("23.2 the worklist lists each note written new since a cursor, with the live notes a plain search for any word of its title finds", async () => {
  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", {
      title: "Send from a verified domain",
      description: "Mail from an unverified domain bounces.",
      statement: "Every email is sent from a verified domain.",
      why: "Providers refuse the rest.",
      howToApply: "Verify the domain before the first send.",
    });
    const unrelated = await library.defineTerm({ term: "Arc", meaning: "Arcs hold increments." });
    const { cursor } = await library.changesSince(0);

    const definition = await library.defineTerm({ term: "Verified domain", meaning: "Mailgun needs a verified domain." });
    await library.editNote(unrelated.id, { meaning: "Arcs hold their increments." });

    const listed = await newNotes(library, cursor);
    assert.deepEqual(
      listed.map(({ note, lookalikes }) => ({ note: note.id, lookalikes: lookalikes.map((one) => one.id) })),
      [{ note: definition.id, lookalikes: [principle.id] }],
    );
  });
});

test("23.3 the worklist lists each write to an agent role or a principle since its cursor that was made after its session read outside text, with what was read", async () => {
  await withLibrary(async (library) => {
    const read = async () => ["gh issue view 7"];
    const before = await library.writeKnowledge("principle", {
      title: "Written before the cursor", description: "Earlier.", statement: "S.", why: "W.", howToApply: "H.",
    }, { actor: "session:lane", outsideRead: read });
    const { cursor } = await library.changesSince(0);

    const principle = await library.writeKnowledge("principle", {
      title: "Trust the issue", description: "As an issue asked.", statement: "S.", why: "W.", howToApply: "H.",
    }, { actor: "session:lane", outsideRead: read });
    await library.writeKnowledge("principle", {
      title: "Written with nothing read", description: "Unmarked.", statement: "S.", why: "W.", howToApply: "H.",
    }, { actor: "session:other" });
    await library.writeKnowledge("pattern", {
      title: "A pattern, marked", description: "Not a role or a principle.", statement: "S.", problem: "P.", approach: "A.",
    }, { actor: "session:lane", outsideRead: read });
    await library.editNote(before.id, { statement: "S, edited." }, { actor: "session:lane", outsideRead: read });

    const full = await worklist(library, { since: cursor });
    assert.deepEqual(
      full.rest?.marked?.map(({ id, action, actor, outsideRead }) => ({ id, action, actor, outsideRead })),
      [
        { id: principle.id, action: "created", actor: "session:lane", outsideRead: ["gh issue view 7"] },
        { id: before.id, action: "updated", actor: "session:lane", outsideRead: ["gh issue view 7"] },
      ],
      "marked role and principle writes since the cursor, in order; not the unmarked one, the pattern, or the write before",
    );
    const view = worklistView(full);
    assert.deepEqual(view.rest?.marked?.map(({ note }) => note.id), [principle.id, before.id]);
    assert.equal(view.rest?.counts.marked, 2);
  });
});
