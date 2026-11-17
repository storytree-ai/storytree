/**
 * Capability 3 · Arc surface: contracts 3.22, 3.23, 3.32 and 3.33, the `question` family's predict, prediction, score, prep and
 * deviation verbs (ADR-1231 D3) and its evidence links, 3.42, question and arc reads of another library of the factory's circle, and 3.43, the owner's questions and waits gathered across that circle and a question settled in its own project's library, run with a caller on a fresh project's library and activity log on the real Postgres
 * `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Library } from "@storytree/library";
import { openActivityLog } from "@storytree/session-management";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import { ARC_FAMILIES, type ArcVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const ASK = { title: "Which mailer?", stakes: "Sign-up waits", statement: "Mailgun or SES?", context: "Both free", options: "1. Mailgun 2. SES", recommendation: "Mailgun" };

async function opened(t: TestContext): Promise<{ library: Library; context: ArcVerbContext; run: (name: string, input: Record<string, unknown>) => Promise<string> }> {
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
  const family = ARC_FAMILIES.find((one) => one.name === "question")!;
  const context: ArcVerbContext = { library, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } };
  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    const verb = family.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, ArcVerbContext>;
    return (await verb.act(input as never, context, WORDS)).text;
  };
  return { library, context, run };
}

test("3.22 · the question family declares predict, prediction, score and prep, each storing or reading through the library and printing it; question show and list carry no would-be answer, list flags the prep mark, and a refused step prints its reason", async (t) => {
  const { library, context, run } = await opened(t);
  const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const question = await library.raiseQuestion({ arc: arc.id, ...ASK });
  const reads = async (): Promise<string[]> => [await run("show", { question: question.id }), await run("list", { arc: undefined })];
  const unsealed = await reads();

  const predicted = await run("predict", { question: question.id, pick: "2", confidence: "high", why: "SES is the cheaper by far" });
  assert.match(predicted, new RegExp(`Recorded a would-be answer for ${question.id}: option 2, high confidence`));
  assert.deepEqual(await reads(), unsealed, "question show and list read the same with a would-be answer as without (12.14)");
  const shown = await run("prediction", { question: question.id });
  assert.match(shown, /option 2, high confidence: SES is the cheaper by far/);
  await assert.rejects(run("predict", { question: question.id, pick: "second", confidence: "high", why: "x" }), (error: unknown) => error instanceof VerbRefusal && /option's number, retire or defer/.test(error.message));

  assert.match(await run("prep", { question: question.id, stance: "differs", reason: "SES is cheaper" }), new RegExp(`Prepped ${question.id}: differs from the raiser`));
  assert.match(await run("list", { arc: undefined }), new RegExp(`${question.id} .*\\(prepped: differs\\)`));
  await library.editQuestion(question.id, { options: "1. Mailgun 2. SES 3. Postmark" });
  assert.match(await run("list", { arc: undefined }), new RegExp(`${question.id} .*\\(unprepared: edited since its prep\\)`));

  await assert.rejects(run("score", { question: question.id, prediction: "match", recommendation: "different", by: undefined }), (error: unknown) => error instanceof VerbRefusal && /open/.test(error.message), "an open question's score is refused with its reason");
  await library.settleQuestion(question.id, { answer: "SES" });
  await assert.rejects(run("predict", { question: question.id, pick: "1", confidence: "low", why: "x" }), (error: unknown) => error instanceof VerbRefusal && /settled/.test(error.message));
  assert.match(await run("score", { question: question.id, prediction: "match", recommendation: "different", by: undefined }), new RegExp(`Scored ${question.id} by person:test: would-be answer match, raiser's recommendation different`));

  // A question with no would-be answer is scored for its raiser's recommendation alone.
  const unpredicted = await library.raiseQuestion({ arc: arc.id, ...ASK });
  await assert.rejects(run("prep", { question: unpredicted.id, stance: "differs", reason: undefined }), (error: unknown) => error instanceof VerbRefusal && /--reason/.test(error.message));
  await library.settleQuestion(unpredicted.id, { answer: "Mailgun" });
  assert.equal(await run("score", { question: unpredicted.id, prediction: undefined, recommendation: "match", by: "lane" }), `Scored ${unpredicted.id} by lane: raiser's recommendation match.`);
  // A caller with no writer is named by its session.
  const unwritten = await library.raiseQuestion({ arc: arc.id, ...ASK });
  await library.settleQuestion(unwritten.id, { answer: "Mailgun" });
  const scoreVerb = ARC_FAMILIES.find((one) => one.name === "question")!.verbs.find((one) => "name" in one.command && one.command.name === "score") as Verb<VerbInputs, ArcVerbContext>;
  const { writer: _writer, ...noWriter } = context;
  assert.match((await scoreVerb.act({ question: unwritten.id, recommendation: "match" } as never, noWriter as ArcVerbContext, WORDS)).text, new RegExp(`^Scored ${unwritten.id} by person:test:`));
  assert.equal(((await library.get(unwritten.id))?.fields as { score?: { by: string } } | undefined)?.score?.by, "person:test");

  const ghost = "question_000000000000";
  for (const [name, input] of [
    ["prediction", {}],
    ["predict", { pick: "1", confidence: "high", why: "x" }],
    ["score", { recommendation: "match" }],
    ["prep", { stance: "agrees" }],
  ] as const) {
    await assert.rejects(run(name, { question: ghost, ...input }), (error: unknown) => error instanceof VerbRefusal && error.message === `no question "${ghost}" in this project`, `${name} names the missing question`);
  }
});

test("3.23 · question deviation counts, per confidence band, the would-be answers settled in its window by their score beside the raiser's recommendation on the same questions, and the questions settled unscored; a window with no scored question says so", async (t) => {
  const { library, run } = await opened(t);
  assert.equal(await run("deviation", { days: undefined }), "No question settled in the last 14 days has been scored.");

  const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const settle = async (prediction: { confidence: "high" | "medium" | "low" } | undefined, score: { prediction?: "match" | "different"; recommendation: "match" | "different" } | undefined): Promise<void> => {
    const question = await library.raiseQuestion({ arc: arc.id, ...ASK });
    if (prediction !== undefined) await library.predictQuestion(question.id, { pick: 1, confidence: prediction.confidence, why: "Simplest" });
    await library.settleQuestion(question.id, { answer: "Mailgun" });
    if (score !== undefined) await library.scoreQuestion(question.id, { ...score, by: "lane" });
  };
  await settle({ confidence: "medium" }, undefined);
  assert.equal(await run("deviation", { days: undefined }), "No question settled in the last 14 days has been scored. 1 settled unscored.");
  await settle({ confidence: "high" }, { prediction: "match", recommendation: "different" });
  await settle({ confidence: "high" }, { prediction: "match", recommendation: "match" });
  await settle({ confidence: "low" }, { prediction: "different", recommendation: "match" });
  await settle(undefined, { recommendation: "match" });

  const report = await run("deviation", { days: undefined });
  assert.match(report, /^Questions settled in the last 14 days: 5, 1 of them unscored\.$/m);
  assert.match(report, /^ {2}high \(2\): would-be answer 2 match, 0 match with changes, 0 different, 0 rejected; raiser's recommendation 1 match, 0 match with changes, 1 different, 0 rejected$/m);
  assert.match(report, /^ {2}low \(1\): would-be answer 0 match, 0 match with changes, 1 different, 0 rejected; raiser's recommendation 1 match, 0 match with changes, 0 different, 0 rejected$/m);
  assert.match(report, /^ {2}no would-be answer \(1\): raiser's recommendation 1 match, 0 match with changes, 0 different, 0 rejected$/m);
  assert.doesNotMatch(report, /medium/, "a band with no scored question is left out");
  assert.match(await run("deviation", { days: "1" }), /^Questions settled in the last 1 day: 5/m);
  await assert.rejects(run("deviation", { days: "soon" }), VerbRefusal);
});

test("3.32 · question new links the ids given with --links, comma-separated, as well as the records its words name; question show names each linked record by title on an Evidence line after Holding, or as no longer live once retired, and question list counts them right after the title", async (t) => {
  const { library, run } = await opened(t);
  const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const research = await library.recordDecision({ status: "accepted", title: "Mailgun's API is the simplest", text: "Measured." });
  const named = await library.recordDecision({ status: "accepted", title: "One mail service", text: "One." });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "Steps." });

  const raised = await run("new", { ...ASK, arc: arc.id, context: `As ${named.id} says`, links: research.id, hold: [increment.id] });
  const id = /Raised question (question_[0-9a-f]{12})/.exec(raised)?.[1] ?? "";
  assert.deepEqual(((await library.get(id))?.fields as { links?: string[] } | undefined)?.links, [research.id, named.id]);

  const shown = await run("show", { question: id });
  assert.match(shown, new RegExp(`Holding: ${increment.id}\\n\\nEvidence: Mailgun's API is the simplest \\[${research.id}\\], One mail service \\[${named.id}\\]$`));
  await library.prepQuestion(id, { stance: "agrees" });
  assert.match(await run("list", { arc: undefined }), new RegExp(`${id}  \\[${arc.id}\\]  Which mailer\\?  \\(2 linked\\)  \\(prepped: agrees\\)`));
  const plain = await library.raiseQuestion({ arc: arc.id, ...ASK });
  assert.doesNotMatch(await run("show", { question: plain.id }), /Evidence/, "a question citing nothing shows no Evidence line");
  assert.match(await run("list", { arc: undefined }), new RegExp(`${plain.id}  \\[${arc.id}\\]  Which mailer\\?$`, "m"));
  await assert.rejects(run("new", { ...ASK, arc: arc.id, links: arc.id, hold: [] }), /arc/, "a link to an arc is refused");
  await library.retire(named.id, "overtaken");
  assert.match(await run("show", { question: id }), new RegExp(`, ${named.id} \\(no longer live\\)$`), "a link whose record was retired says so");
});

test("3.33 · question link-named links each named question's, or with --all every question's, live records its words name that it does not link yet, open or settled, and says how many it added", async (t) => {
  const { library, run } = await opened(t);
  const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const question = await library.raiseQuestion({ arc: arc.id, ...ASK });
  const other = await library.raiseQuestion({ arc: arc.id, ...ASK });
  const research = await library.recordDecision({ status: "accepted", title: "Mailgun's API is the simplest", text: "Measured." });
  await library.editQuestion(question.id, { context: `See ${research.id}` });
  await library.settleQuestion(question.id, { answer: "Mailgun" });
  await library.editQuestion(other.id, { context: `Asked after ${question.id}` });

  assert.equal(await run("link-named", { questions: [question.id], all: false }), `Linked 1 record ${question.id} names.`);
  assert.deepEqual(((await library.get(question.id))?.fields as { links?: string[] } | undefined)?.links, [research.id]);
  assert.equal(await run("link-named", { questions: [], all: true }), `Linked 1 record across 2 questions.`);
  assert.deepEqual(((await library.get(other.id))?.fields as { links?: string[] } | undefined)?.links, [question.id]);
  assert.equal(await run("link-named", { questions: [], all: true }), `Linked 0 records across 2 questions.`);
  await assert.rejects(run("link-named", { questions: ["question_000000000000"], all: false }), (error: unknown) => error instanceof VerbRefusal && /no question/.test(error.message));
  await assert.rejects(run("link-named", { questions: [], all: false }), VerbRefusal, "name a question or --all");
});

test("3.42 · question list and show and arc list and show read the factory's library or a project it builds when --project names one, from either folder, the answer under that project's name; a project outside the circle is refused (ADR-1348 D2)", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const [factoryName, productName, outsideName] = [0, 1, 2].map(() => `t-${randomBytes(4).toString("hex")}`) as [string, string, string];
  const log = await openActivityLog(storytree);
  t.after(async () => {
    try {
      await log.close();
      for (const name of [productName, factoryName, outsideName]) await storytree.dropProject(name).catch(() => undefined);
    } finally {
      await storytree.close();
    }
  });
  const factory = await storytree.openProject(factoryName);
  await factory.markFactory();
  const product = await storytree.openProject(productName);
  await product.recordFactory(factoryName);
  await storytree.openProject(outsideName);
  const siteArc = await product.createArc({ title: "Ricky's site goes live", intent: "Ship it", endState: "It is live" });
  const siteQuestion = await product.raiseQuestion({ arc: siteArc.id, ...ASK });
  const toolArc = await factory.createArc({ title: "The factory's tooling", intent: "Tools", endState: "Tooled" });
  const contextOf = (library: Library): ArcVerbContext => ({ library, log, project: library.name, session: "person:test", folder: "/work" });
  const run = async (family: string, name: string, input: Record<string, unknown>, context: ArcVerbContext): Promise<string> => {
    const verb = ARC_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, ArcVerbContext>;
    return (await verb.act(input as never, context, WORDS)).text;
  };
  const fromFactory = contextOf(factory);
  const fromProduct = contextOf(await storytree.openProject(productName));

  // From the factory's folder, the project's questions and arcs.
  const listed = await run("question", "list", { arc: undefined, project: productName }, fromFactory);
  assert.match(listed, new RegExp(`^project ${productName}:\\n1 open across arcs:\\n  - ${siteQuestion.id}`));
  assert.match(await run("question", "show", { question: siteQuestion.id, project: productName }, fromFactory), new RegExp(`^project ${productName}:\\nWhich mailer\\?`));
  assert.match(await run("arc", "list", { project: productName }, fromFactory), new RegExp(`^project ${productName}:[\\s\\S]*${siteArc.id}`));
  assert.match(await run("arc", "show", { arc: siteArc.id, project: productName }, fromFactory), new RegExp(`^project ${productName}:\\nRicky's site goes live`));
  assert.doesNotMatch(await run("question", "list", { arc: undefined }, fromFactory), new RegExp(siteQuestion.id), "named nowhere, it reads the folder's own");

  // From the project's folder, the factory's.
  const arcs = await run("arc", "list", { project: factoryName }, fromProduct);
  assert.ok(arcs.startsWith(`project ${factoryName}:`) && arcs.includes(toolArc.id) && !arcs.includes(siteArc.id));
  await assert.rejects(run("arc", "list", { project: outsideName }, fromProduct), (error: unknown) => error instanceof VerbRefusal && error.message.includes(outsideName));
});

test("3.43 · question list and arc waits with --project all read every library of the factory's circle, the folder's own first, each under its project's name; question settle --project settles a question in that project's library (ADR-1348 D2)", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const [factoryName, productName] = [0, 1].map(() => `t-${randomBytes(4).toString("hex")}`) as [string, string];
  const log = await openActivityLog(storytree);
  t.after(async () => {
    try {
      await log.close();
      for (const name of [productName, factoryName]) await storytree.dropProject(name).catch(() => undefined);
    } finally {
      await storytree.close();
    }
  });
  const factory = await storytree.openProject(factoryName);
  await factory.markFactory();
  const product = await storytree.openProject(productName);
  await product.recordFactory(factoryName);
  const siteArc = await product.createArc({ title: "Ricky's site goes live", intent: "Ship it", endState: "It is live" });
  const siteQuestion = await product.raiseQuestion({ arc: siteArc.id, ...ASK });
  const domain = await product.addIncrement({ arc: siteArc.id, title: "Domain", objective: "Domain", body: "…" });
  await product.addWaitFor(domain.id, { releaser: "owner", note: "Buy the domain", why: "the site needs it" });
  const toolArc = await factory.createArc({ title: "The factory's tooling", intent: "Tools", endState: "Tooled" });
  const toolQuestion = await factory.raiseQuestion({ arc: toolArc.id, ...ASK, title: "Which runner?" });
  const context: ArcVerbContext = { library: factory, log, project: factoryName, session: "person:test", folder: "/work", writer: { actor: "person:test" } };
  const run = async (family: string, name: string, input: Record<string, unknown>): Promise<string> => {
    const verb = ARC_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, ArcVerbContext>;
    return (await verb.act(input as never, context, WORDS)).text;
  };

  // Each says so in its usage, which is how a session finds the flag.
  for (const [family, name] of [["question", "list"], ["arc", "waits"]] as const) {
    const verb = ARC_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    assert.match((verb.command as { usage?: string }).usage ?? "", /\[--project <project\|all>\]$/, `${family} ${name}`);
  }
  const questions = await run("question", "list", { arc: undefined, project: ["all"] });
  // The shared test Postgres holds other tests' projects too, so the circle may name one it could not open
  // (dropped mid-read) between these two: find the product's section by its name, not its position.
  const sections = questions.split("\n\n");
  const own = sections[0]!;
  const theirs = sections.find((section) => section.startsWith(`project ${productName}:\n`));
  assert.ok(own.startsWith(`project ${factoryName}:\n`) && own.includes(toolQuestion.id) && !own.includes(siteQuestion.id), questions);
  assert.ok(theirs !== undefined && theirs.includes(siteQuestion.id), questions);
  const waits = await run("arc", "waits", { audit: false, project: ["all"] });
  assert.match(waits, new RegExp(`^project ${factoryName}:\\nNo waits[\\s\\S]*\\n\\nproject ${productName}:\\n1 wait for you[\\s\\S]*you +Buy the domain \\(why: the site needs it\\) — ${domain.id}`));
  assert.doesNotMatch(await run("question", "list", { arc: undefined }), new RegExp(siteQuestion.id), "named nowhere, it reads the folder's own");

  assert.match(await run("question", "settle", { question: siteQuestion.id, answer: "Mailgun", project: productName }), new RegExp(`^project ${productName}:\\nSettled question ${siteQuestion.id}`));
  assert.equal(((await product.get(siteQuestion.id))?.fields as { lifecycle?: string } | undefined)?.lifecycle, "settled");
  assert.equal(((await factory.get(toolQuestion.id))?.fields as { lifecycle?: string } | undefined)?.lifecycle, "open");
});
