/**
 * Capability 27 · Fixed data questions: contracts 27.1 to 27.4, the `library count`, `changes` and `find` commands and
 * `library read` by a decision's number, run through the library family on a fresh project's library on the real
 * Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";

import { connect, type Library } from "../index.js";
import { LIBRARY_FAMILIES, type LibraryVerbContext } from "../commands/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

async function world(t: TestContext): Promise<{ library: Library; run: (name: string, inputs: Record<string, unknown>) => Promise<string> }> {
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
  const context: LibraryVerbContext = { library, project, session: "person:owner", folder: tmpdir(), writer: { actor: "person:owner" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  return { library, run: async (name, inputs) => (await verbOf(name).act(inputs as never, context, WORDS)).text };
}

test("27.1 · library count tallies live records by kind and status, and open increments by arc, leaving health out", async (t) => {
  const { library, run } = await world(t);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const work = { objective: "Do it", body: "Red then green" };
  await library.addIncrement({ arc: arc.id, title: "One", ...work });
  await library.addIncrement({ arc: arc.id, title: "Two", ...work });
  const done = await library.addIncrement({ arc: arc.id, title: "Three", ...work });
  await library.closeIncrement(done.id, { pr: "#1", disposition: "landed" });
  await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "Sign-up needs one.", statement: "Which?", context: "Two options.", options: "Mailgun or Postmark." });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const contract = await library.addContract({ capability: form.id, title: "It sends" });
  await library.reportHealth(contract.id, "passing", { by: "test-runner" });
  const gone = await library.defineTerm({ term: "Gone", meaning: "Retired." });
  await library.retire(gone.id, "wrong");

  const counted = await run("count", {});
  assert.match(counted, /^\s+increment\s+3: proposal 2, closed 1$/m);
  assert.match(counted, /^\s+question\s+1: open 1$/m);
  assert.match(counted, /^\s+story\s+1$/m);
  assert.match(counted, new RegExp(`2 open\\s+${arc.id}\\s+Launch`), "open increments by arc, with its title");
  assert.doesNotMatch(counted, /health/, "health readings are not counted");
  assert.doesNotMatch(counted, /definition/, "a retired record is not counted");
});

test("27.2 · library changes lists the latest changes newest first by sequence number, at most 20, health left out", async (t) => {
  const { library, run } = await world(t);
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const contract = await library.addContract({ capability: form.id, title: "It sends" });
  for (let n = 1; n <= 22; n += 1) await library.defineTerm({ term: `Term ${n}`, meaning: "A word." });
  await library.reportHealth(contract.id, "passing", { by: "test-runner" });

  const lines = (await run("changes", { limit: undefined })).split("\n").filter((line) => /^\s+\d+\s/.test(line));
  assert.equal(lines.length, 20, "at most 20 rows");
  assert.match(lines[0]!, /created\s+definition\s+definition_[0-9a-f]{12}\s+Term 22$/, "newest first, health left out");
  assert.match(lines[19]!, /Term 3$/);
  const seqs = lines.map((line) => Number(/^\s+(\d+)/.exec(line)![1]));
  assert.deepEqual(seqs, [...seqs].sort((one, other) => other - one), "by sequence number, newest first");

  const few = (await run("changes", { limit: "2" })).split("\n").filter((line) => /^\s+\d+\s/.test(line));
  assert.equal(few.length, 2);
  await assert.rejects(run("changes", { limit: "21" }), VerbRefusal, "never more than 20");
});

test("27.3 · library find lists live records whose title holds every word, at most 20, long titles cut", async (t) => {
  const { library, run } = await world(t);
  const arc = await library.createArc({ title: "Voice reaches storytree", intent: "Talk to it", endState: "It answers" });
  const long = `Voice ${"very ".repeat(40)}long title`;
  await library.addIncrement({ arc: arc.id, title: long, objective: "Do it", body: "Red then green" });
  for (let n = 1; n <= 22; n += 1) await library.defineTerm({ term: `voice term ${n}`, meaning: "A word." });
  const decision = await library.recordDecision({ status: "accepted", title: "Speak plainly", text: "D1. Short answers." });
  await library.defineTerm({ term: "Storytree speaks", meaning: "Out loud." });

  const both = await run("find", { words: ["STORYTREE", "voice"] });
  assert.match(both, new RegExp(`${arc.id}\\s+\\[arc\\]\\s+Voice reaches storytree`), "case-insensitive, every word");
  assert.doesNotMatch(both, /Storytree speaks/, "a title missing a word is left out");
  assert.match(await run("find", { words: ["reach"] }), /Voice reaches storytree/, "a word is found by its start");
  assert.equal(await run("find", { words: ["each"] }), 'No titles holding "each".', "never inside a word");
  assert.equal(await run("find", { words: ["term.1"] }), 'No titles holding "term.1".', "a word is matched as written, never as a pattern");

  const many = (await run("find", { words: ["voice"] })).split("\n").filter((line) => /^\s+\w+_[0-9a-f]{12}\s/.test(line));
  assert.equal(many.length, 20, "at most 20 rows");
  const cut = (await run("find", { words: ["very", "long"] })).split("\n").find((line) => line.includes("increment_"))!;
  assert.ok(cut.length < 140 && cut.endsWith("…"), `a long title is cut: ${cut}`);

  const number = String(decision.fields.number);
  for (const name of [number, `ADR-${number.padStart(4, "0")}`, `adr-${number}`]) {
    assert.match(await run("find", { words: [name] }), new RegExp(`${decision.id}\\s+\\[decision\\]\\s+Speak plainly`), `${name} finds the decision`);
  }
});

test("27.4 · library read takes a decision's number, 1103 or ADR-1103, in place of its id", async (t) => {
  const { library, run } = await world(t);
  const decision = await library.recordDecision({ status: "accepted", title: "Speak plainly", text: "D1. Short answers." });
  const number = Number(decision.fields.number);
  for (const name of [String(number), `ADR-${String(number).padStart(4, "0")}`]) {
    const read = await run("read", { ids: [name], linked: false, field: undefined });
    assert.match(read, new RegExp(`^${decision.id}  \\[decision\\]`), `${name} reads the decision whole`);
    assert.match(read, /text: D1\. Short answers\./);
  }
  await assert.rejects(run("read", { ids: [String(number + 50)], linked: false, field: undefined }), (error: unknown) => error instanceof VerbRefusal && new RegExp(`${number + 50}`).test(error.message));
});
