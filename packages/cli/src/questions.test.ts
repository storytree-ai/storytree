/**
 * Capability 5 · Questions: one test per contract in the command line story, each running the real,
 * built `storytree` command.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readClaims } from "@storytree/agent-link";

import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { questions } from "./families/question.js";
import { BuiltCommand, inWorld, testServerUrl, type World } from "./testing/cli.js";

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

test("5.8 `question list` leaves out a parked arc's open questions, says how many wait there and on which arc, and that arc's own listing names them as parked with it", async () => {
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
    assert.ok(all.stdout.includes(parked.arc), "it names the parked arc to list them from");
    const one = await world.run(["question", "list", "--arc", parked.arc]);
    assert.equal(one.code, 0, one.stderr);
    assert.ok(one.stdout.includes(hidden.id), "the parked arc's own listing names its question");
    assert.match(one.stdout, /parked with the arc/, one.stdout);
    assert.doesNotMatch(one.stdout, /^1 open/m, "it is not listed as waiting on the owner");
    await library.unparkArc(parked.arc);
    const back = await world.run(["question", "list"]);
    assert.ok(back.stdout.includes(hidden.id), "unparked, its question is back on the list");
  });
});

test("5.9 `arc show` on a parked arc lists its open questions as parked with the arc, not as waiting on you", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const { arc } = await arcWithWork(world);
    const question = await library.raiseQuestion({ title: "Mailer?", stakes: "Reach readers", statement: "Which?", context: "Email", options: "Mailgun or SES", arc });
    await library.parkArc(arc);
    const parked = await world.run(["arc", "show", arc]);
    assert.equal(parked.code, 0, parked.stderr);
    assert.ok(parked.stdout.includes(question.id), parked.stdout);
    assert.doesNotMatch(parked.stdout, /waiting on you/i);
    assert.match(parked.stdout, /parked with the arc/i);
    await library.unparkArc(arc);
    const back = await world.run(["arc", "show", arc]);
    assert.match(back.stdout, /waiting on you \(1\)/i, "unparked, its question waits on you again");
  });
});

test("5.8 `question list` across arcs reads every arc in one ask to find the parked ones, however many arcs hold questions (ADR-0836 D3)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const fields = { title: "Mailer?", stakes: "Reach readers", statement: "Which?", context: "Email", options: "Mailgun or SES" };
    const arcs = [await arcWithWork(world), await arcWithWork(world), await arcWithWork(world)];
    for (const { arc } of arcs) await library.raiseQuestion({ ...fields, arc });
    await library.parkArc(arcs[2]!.arc);
    const asked = { arcView: 0, arcViews: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (key === "arcView" || key === "arcViews") asked[key]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const list = questions.verbs.find((verb) => verb.name === "list")!;
    const answer = await list.act(parseArgs([], [], world.folder), { library: async () => counted } as unknown as Context);
    assert.match(answer.text, /^2 open across arcs:/);
    assert.match(answer.text, /1 more waits on a parked arc/);
    assert.deepEqual(asked, { arcView: 0, arcViews: 1 });
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
    const stored = await (await world.library()).get(increment);
    assert.ok(stored?.type === "increment");
    assert.deepEqual(stored.fields.heldOn, [question]);

    const held = await world.run(["arc", "show", arc]);
    assert.match(held.stdout, new RegExp(`waiting on you: question ${question}`));

    await world.run(["question", "settle", question, "--answer", "Mailgun"]);
    const released = await world.run(["arc", "show", arc]);
    assert.doesNotMatch(released.stdout, /waiting on you: question/);
  });
});

test("5.12 `question new --hold` releases the asking session's claims on the held increment and the capability claims taken under it; an unrelated claim stands", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const other = await library.addIncrement({ arc, title: "Pricing page", objective: "Build it", body: "…" });
    const story = await library.addStory({ title: "Sign-up" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const log = await openActivityLog(testServerUrl());
    try {
      const asker = { log, library, project: world.project, session: "claude-ask", harness: "claude-code" } as const;
      for (const id of [other.id, increment, capability.id]) assert.equal((await claim(asker, id, "building")).ok, true, id);

      const raised = await world.run(["question", "new", ...questionFlags(arc), "--hold", increment], { CLAUDE_CODE_SESSION_ID: "claude-ask" });
      assert.equal(raised.code, 0, raised.stderr);
      assert.match(raised.stdout, new RegExp(`Released your claims on ${increment}, ${capability.id}`));
      assert.deepEqual((await readClaims(log, world.project)).map((held) => held.increment ?? held.capability), [other.id]);
      const shown = await world.run(["arc", "show", arc]);
      assert.match(shown.stdout, /waiting on you: question/);
    } finally {
      await log.close();
    }
  });
});

test("5.13 `question present` marks a question as being put to the owner by the calling session; another live session is refused, naming it, `question list` flags it, and `--done` frees it", async () => {
  await inWorld(command, async (world) => {
    const { arc } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ title: "Mailer?", stakes: "Reach readers", statement: "Which?", context: "Email", options: "Mailgun or SES", arc });
    const log = await openActivityLog(testServerUrl());
    try {
      for (const session of ["claude-a", "claude-b"]) await log.append(world.project, { session, harness: "claude-code", source: "hook", kind: "session-started" });
      const a = { CLAUDE_CODE_SESSION_ID: "claude-a" };
      const b = { CLAUDE_CODE_SESSION_ID: "claude-b" };

      const presented = await world.run(["question", "present", question.id], a);
      assert.equal(presented.code, 0, presented.stderr);
      const refused = await world.run(["question", "present", question.id], b);
      assert.notEqual(refused.code, 0);
      assert.match(refused.stderr, /claude-a/, "it names the session putting it to the owner");
      const listed = await world.run(["question", "list"]);
      assert.match(listed.stdout, new RegExp(`${question.id}.*being put to the owner by Claude Code session claude-a`));

      const done = await world.run(["question", "present", question.id, "--done"], a);
      assert.equal(done.code, 0, done.stderr);
      assert.doesNotMatch((await world.run(["question", "list"])).stdout, /being put to the owner/);
      assert.equal((await world.run(["question", "present", question.id], b)).code, 0, "free once A is done");
    } finally {
      await log.close();
    }
  });
});

test("5.10 unsupported question new flags are refused before any write, naming --hold", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const before = (await library.changesSince(0)).cursor;

    for (const extra of [["--holds", increment], ["--hold", increment, "--unknown", "value"]]) {
      const ran = await world.run(["question", "new", ...questionFlags(arc), ...extra]);

      assert.equal(ran.code, 2, ran.stdout);
      assert.match(ran.stderr, /unsupported.*--(?:holds|unknown)/i);
      assert.match(ran.stderr, /--hold\b/);
      assert.deepEqual((await library.changesSince(before)).changes, [], "neither a question nor a hold was written");
    }
  });
});

test("5.4 question retire only retires questions, releasing every increment held on it in the same step; library retire still refuses a held one", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
    await library.editIncrement(increment, { heldOn: [question.id] });

    const { cursor } = await library.changesSince(0);
    const refused = await world.run(["library", "retire", question.id, "--reason", "asked wrongly"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(increment));
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    const wrongKind = await world.run(["question", "retire", increment, "--reason", "asked wrongly"]);
    assert.equal(wrongKind.code, 1);
    assert.match(wrongKind.stderr, /not a question/);
    assert.ok(wrongKind.stderr.includes(`storytree library retire ${increment}`), wrongKind.stderr);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    const retired = await world.run(["question", "retire", question.id, "--reason", "asked wrongly"]);
    assert.equal(retired.code, 0, retired.stderr);
    assert.ok(retired.stdout.includes(`Released ${increment}`), retired.stdout);
    assert.equal(await library.get(question.id), null);
    assert.equal(((await library.get(increment))?.fields as { heldOn?: unknown } | undefined)?.heldOn, undefined);
    assert.equal((await library.history({ id: question.id })).at(-1)?.reason, "asked wrongly");
  });
});

test("5.11 `question show` reads one question whole: what it asks, its answer once settled, and the open work held on it", async () => {
  await inWorld(command, async (world) => {
    const { arc, increment } = await arcWithWork(world);
    const library = await world.library();
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "Sign-up waits", statement: "Which one?", context: "Two in reach", options: "Mailgun or SES", analogy: "Like a post office" });
    await library.editIncrement(increment, { heldOn: [question.id] });

    const open = await world.run(["question", "show", question.id]);
    assert.equal(open.code, 0, open.stderr);
    for (const text of ["Which mailer?", arc, "open", "Sign-up waits", "Which one?", "Two in reach", "Mailgun or SES", "Like a post office", `Holding: ${increment}`]) {
      assert.ok(open.stdout.includes(text), `${text}: ${open.stdout}`);
    }

    await library.settleQuestion(question.id, { answer: "Mailgun" });
    const settled = await world.run(["question", "show", question.id]);
    assert.equal(settled.code, 0, settled.stderr);
    assert.match(settled.stdout, /settled/);
    assert.match(settled.stdout, /Answer:\nMailgun/);
    assert.ok(!settled.stdout.includes("Holding:"), settled.stdout);

    const wrongKind = await world.run(["question", "show", increment]);
    assert.equal(wrongKind.code, 1);
    assert.match(wrongKind.stderr, /not a question/);
    const missing = await world.run(["question", "show", "question_000000000000"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no question/);
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
