/**
 * Capability 3 · Arc surface: contract 3.11, the `arc` and `question` verbs the arc surface declares for the command line,
 * run with a caller on a fresh project's library and activity log on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { openActivityLog } from "@storytree/session-management";
import { VerbRefusal, type DoorWords, type Verb, type VerbFamilies, type VerbInputs } from "@storytree/library/verbs";

import { ARC_FAMILIES, type ArcVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

function verbOf(family: VerbFamilies<ArcVerbContext>, name: string): Verb<VerbInputs, ArcVerbContext> {
  return family.verbs.find((one) => "name" in one.command && one.command.name === name)!;
}

test("3.11 · the arc surface declares the `arc` family, with `arc increment` within it, and the `question` family, that the command line lists 2nd and 3rd: a question raised holding an increment on its arc holds it, an empty --held-on clears the hold, and retiring a record that is no question names library retire", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(project);
  const log = await openActivityLog(storytree);
  t.after(async () => {
    try {
      await log.close();
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });

  const [arc, question] = ["arc", "question"].map((name) => ARC_FAMILIES.find((family) => family.name === name)!);
  assert.deepEqual([arc!.order, question!.order], [2, 3]);
  const increment = arc!.families!.find((family) => family.name === "increment")!;
  const context: ArcVerbContext = { library, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } };

  const plan = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const work = await library.addIncrement({ arc: plan.id, title: "Mail", objective: "Send", body: "…" });
  const raised = await verbOf(question!, "new").act({ arc: plan.id, title: "Which mailer?", stakes: "Sign-up waits", statement: "Mailgun or SES?", context: "Both free", options: "Mailgun or SES", hold: [work.id] }, context, WORDS);
  const [asked] = await library.questions(plan.id);
  assert.equal(raised.text, `Raised question ${asked!.id} on ${plan.id}, holding ${work.id}.`);
  assert.deepEqual((await library.holds()).heldOn[work.id], [asked!.id]);

  await verbOf(increment, "edit").act({ increment: work.id, "held-on": "" }, context, WORDS);
  assert.equal(((await library.get(work.id))?.fields as { heldOn?: string[] }).heldOn, undefined, "an empty --held-on clears the hold");

  await assert.rejects(verbOf(question!, "retire").act({ question: work.id, reason: "wrong" }, context, WORDS), (error: unknown) =>
    error instanceof VerbRefusal && error.message === `${work.id} is a increment, not a question` && error.next[0]?.command === `library retire ${work.id} --reason <why>`);
});
