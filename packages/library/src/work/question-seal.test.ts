/**
 * Capability 12 · Owner questions: contract 12.14, the would-be answer's seal, through the library's own reads of a
 * question (library read and the open tool), on a fresh project's library on the real Postgres `pnpm test` provides.
 * The arc surface's question show and list are held to it in its own 3.22 test.
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { LIBRARY_FAMILIES, NOTE_TOOLS, type LibraryVerbContext, type NoteToolContext } from "../commands/index.js";
import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("12.14 · A would-be answer is sealed: library read of its question, with or without --linked, and the open tool read the same with one recorded as without, while the question is open; only its own read gives it", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const read = family.verbs.find((one) => mounted(one.command) && one.command.name === "read")! as Verb<VerbInputs, LibraryVerbContext>;
  const open = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "open")! as Verb<VerbInputs, NoteToolContext>;
  const context = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined,
  } as NoteToolContext & LibraryVerbContext;

  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const question = await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "Sign-up waits", statement: "Mailgun or SES?", context: "Both free", options: "1. Mailgun 2. SES", recommendation: "Mailgun" });
  const reads = async (): Promise<string[]> => [
    (await read.act({ ids: [question.id], linked: false, field: undefined, out: undefined }, context, WORDS)).text,
    (await read.act({ ids: [question.id], linked: true, field: undefined, out: undefined }, context, WORDS)).text,
    JSON.stringify(await open.act({ id: question.id, field: undefined }, context, WORDS)),
  ];
  const before = await reads();
  await library.predictQuestion(question.id, { pick: 2, confidence: "high", why: "SES is the cheaper by far" });
  const after = await reads();
  assert.deepEqual(after, before, "no read of the question carries it");
  for (const text of after) assert.doesNotMatch(text, /cheaper by far/);
  assert.equal((await library.questionPrediction(question.id))?.fields.why, "SES is the cheaper by far", "its own read gives it");
});
