/**
 * Capability 5 · Questions: one test per contract in the command line story, each running the real,
 * built `storytree` command.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld, type World } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("5.5 `question list` lists open questions across arcs, or on one arc", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const first = await arcWithWork(world);
    const second = await arcWithWork(world);
    const fields = { title: "Mailer?", stakes: "Reach readers", statement: "Which?", context: "Email", options: "Mailgun or SES" };
    const a = await library.raiseQuestion({ ...fields, arc: first.arc });
    const b = await library.raiseQuestion({ ...fields, arc: second.arc });
    const settled = await library.raiseQuestion({ ...fields, arc: first.arc });
    await library.settleQuestion(settled.id, { answer: "Mailgun" });
    const retired = await library.raiseQuestion({ ...fields, arc: second.arc });
    await library.retire(retired.id, "Duplicate");
    const all = await world.run(["question", "list"]);
    assert.equal(all.code, 0, all.stderr);
    for (const id of [a.id, b.id]) assert.ok(all.stdout.includes(id), all.stdout);
    for (const id of [settled.id, retired.id]) assert.ok(!all.stdout.includes(id), all.stdout);
    const one = await world.run(["question", "list", "--arc", first.arc]);
    assert.equal(one.code, 0, one.stderr);
    assert.ok(one.stdout.includes(a.id), one.stdout);
    assert.ok(!one.stdout.includes(b.id), one.stdout);
  });
});

test("5.8 `question list` leaves out a parked arc's open questions and says how many wait there until it is unparked", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const active = await arcWithWork(world);
    const parked = await arcWithWork(world);
    const fields = { title: "Mailer?", stakes: "Reach readers", statement: "Which?", context: "Email", options: "Mailgun or SES" };
    const shown = await library.raiseQuestion({ ...fields, arc: active.arc });
    const hidden = await library.raiseQuestion({ ...fields, arc: parked.arc });
    await library.parkArc(parked.arc);
    const all = await world.run(["question", "list"]);
    assert.equal(all.code, 0, all.stderr);
    assert.ok(all.stdout.includes(shown.id), all.stdout);
    assert.ok(!all.stdout.includes(hidden.id), all.stdout);
    assert.match(all.stdout, /1 more waits? on a parked arc/, "it says what it left out");
    const one = await world.run(["question", "list", "--arc", parked.arc]);
    assert.equal(one.code, 0, one.stderr);
    assert.ok(!one.stdout.includes(hidden.id), one.stdout);
    assert.match(one.stdout, /parked/, one.stdout);
    await library.unparkArc(parked.arc);
    const back = await world.run(["question", "list"]);
    assert.ok(back.stdout.includes(hidden.id), "unparked, its question is back on the list");
  });
});

/** A question's fields as flags, all but those in `leaving`. */
function questionFlags(arc: string, leaving: readonly string[] = []): string[] {
  const flags: Record<string, string> = {
    arc,
    title: "Which mailer?",
    stakes: "Sign-up cannot send its email until this is chosen",
    statement: "Mailgun or SES?",
    context: "Both have a free tier",
    options: "Mailgun: simplest. SES: cheapest.",
  };
  return Object.entries(flags).flatMap(([name, value]) => (leaving.includes(name) ? [] : [`--${name}`, value]));
}

async function arcWithWork(world: World): Promise<{ arc: string; increment: string }> {
  const library = await world.library();
  const arc = await library.createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
  return { arc: arc.id, increment: increment.id };
}

test("5.1 a question with no stakes is refused", async () => {
  await inWorld(command, async (world) => {
    const { arc } = await arcWithWork(world);
    const library = await world.library();
    const before = (await library.changesSince(0)).cursor;

    const ran = await world.run(["question", "new", ...questionFlags(arc, ["stakes"])]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /\bstakes\b/);
    assert.deepEqual((await library.changesSince(before)).changes, []);
  });
});

test("5.2 settling needs an answer", async () => {
  await inWorld(command, async (world) => {
    const { arc } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });

    const bare = await world.run(["question", "settle", question.id]);
    assert.notEqual(bare.code, 0);
    assert.match(bare.stderr, /\banswer\b/);
    assert.deepEqual((await library.questions(arc)).map((one) => one.fields.lifecycle), ["open"]);

    const answered = await world.run(["question", "settle", question.id, "--answer", "Mailgun, it is simplest"]);
    assert.equal(answered.code, 0, answered.stderr);
    assert.deepEqual((await library.questions(arc)).map((one) => one.fields.answer), ["Mailgun, it is simplest"]);
  });
});

test("5.3 a held increment reads as waiting on you until its question is settled", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);

    const raised = await world.run(["question", "new", ...questionFlags(arc), "--hold", increment]);
    assert.equal(raised.code, 0, raised.stderr);
    const question = /\bquestion_[0-9a-f]+\b/.exec(raised.stdout)?.[0];
    assert.ok(question !== undefined, raised.stdout);

    const held = await world.run(["arc", "show", arc]);
    assert.match(held.stdout, new RegExp(`waiting on you: question ${question}`));

    await world.run(["question", "settle", question, "--answer", "Mailgun"]);
    const released = await world.run(["arc", "show", arc]);
    assert.doesNotMatch(released.stdout, /waiting on you: question/);
  });
});

test("5.4 question retire only retires questions; either door refuses a question an increment is held on", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
    await library.editIncrement(increment, { heldOn: [question.id] });

    const { cursor } = await library.changesSince(0);
    for (const family of ["question", "library"]) {
      const ran = await world.run([family, "retire", question.id, "--reason", "asked wrongly"]);
      assert.equal(ran.code, 1);
      assert.match(ran.stderr, new RegExp(increment));
      assert.deepEqual((await library.changesSince(cursor)).changes, []);
    }
    assert.deepEqual((await library.questions(arc)).map((one) => one.id), [question.id]);

    const wrongKind = await world.run(["question", "retire", increment, "--reason", "asked wrongly"]);
    assert.equal(wrongKind.code, 1);
    assert.match(wrongKind.stderr, /not a question/);
    assert.ok(wrongKind.stderr.includes(`storytree library retire ${increment}`), wrongKind.stderr);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await library.editIncrement(increment, { heldOn: [] });
    const retired = await world.run(["question", "retire", question.id, "--reason", "asked wrongly"]);
    assert.equal(retired.code, 0, retired.stderr);
    assert.equal(await library.get(question.id), null);
    assert.equal((await library.history({ id: question.id })).at(-1)?.reason, "asked wrongly");
  });
});

test("5.6 `question check` says whether a question's review is fresh or lapsed; `question renew` re-stamps it, and renewing a settled question is refused", async () => {
  await inWorld(command, async (world) => {
    const { arc } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });

    const checked = await world.run(["question", "check", question.id]);
    assert.equal(checked.code, 0, checked.stderr);
    assert.match(checked.stdout, /\bfresh\b/);
    assert.match(checked.stdout, /7-day lease/);

    const renewed = await world.run(["question", "renew", question.id]);
    assert.equal(renewed.code, 0, renewed.stderr);
    assert.match(renewed.stdout, new RegExp(`Renewed ${question.id}`));

    await library.settleQuestion(question.id, { answer: "Mailgun" });
    const before = (await library.changesSince(0)).cursor;
    const refused = await world.run(["question", "renew", question.id]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /settled/);
    assert.deepEqual((await library.changesSince(before)).changes, [], "nothing was written");
    assert.match((await world.run(["question", "check", question.id])).stdout, /\bsettled\b/);

    const missing = await world.run(["question", "check", "question_000000000000"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no question/);
  });
});

test("5.7 `library edit <question>` corrects an open question's wording in place; editing a settled question is refused, pointing at its standing answer", async () => {
  await inWorld(command, async (world) => {
    const { arc } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });

    const edited = await world.run(["library", "edit", question.id, "--options", "Mailgun, SES or Postmark"]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.deepEqual((await library.get(question.id))?.fields, { ...question.fields, options: "Mailgun, SES or Postmark" });

    await library.settleQuestion(question.id, { answer: "Mailgun" });
    const before = (await library.changesSince(0)).cursor;
    const refused = await world.run(["library", "edit", question.id, "--options", "Too late"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /settled/);
    assert.deepEqual((await library.changesSince(before)).changes, [], "nothing was written");
  });
});
