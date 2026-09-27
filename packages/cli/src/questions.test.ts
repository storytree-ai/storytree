/**
 * Capability 5 · Questions: one test per contract 5.1-5.4 in the command line story, each running the real,
 * built `storytree` command.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld, type World } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

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

test("5.4 a question an increment is held on cannot be retired", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
    await library.editIncrement(increment, { heldOn: [question.id] });

    const ran = await world.run(["question", "retire", question.id, "--reason", "asked wrongly"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, new RegExp(increment));
    assert.deepEqual((await library.questions(arc)).map((one) => one.id), [question.id]);
  });
});
