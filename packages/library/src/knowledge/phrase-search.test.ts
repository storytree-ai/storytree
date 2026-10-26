/** Capability 14 · Explicit literal lookup alongside ranked search. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRecords } from "../schema/index.js";
import { withCountedProject } from "../testing/pg.js";
import { MemoryTransactions } from "../transactions/index.js";
import { Knowledge } from "./index.js";

async function exercise(knowledge: Knowledge, records: SchemaRecords): Promise<void> {
  const phrase = "Exact %_\\ 'phrase'";
  const expected: string[] = [];
  for (let index = 0; index < 13; index++) {
    const record = await records.create("definition", { term: `Note ${index}`, meaning: `Before ${phrase} after` });
    expected.push(record.id);
  }
  const story = await records.create("story", { title: phrase });
  const decision = await records.create("decision", { title: "Decision", text: phrase, status: "accepted" });
  const arc = await records.create("arc", { title: "Arc", intent: phrase, endState: "Done" });
  expected.push(story.id, decision.id, arc.id);
  const edited = await records.create("definition", { term: "Edited", meaning: "Before" });
  await records.edit(edited.id, { meaning: phrase });
  expected.push(edited.id);
  const stale = await records.create("definition", { term: "Stale", meaning: phrase });
  await records.edit(stale.id, { meaning: "After" });
  const retired = await records.create("definition", { term: "Retired", meaning: phrase });
  await records.retire(retired.id, "Gone");
  await records.create("definition", { term: "Case", meaning: phrase.toLowerCase() });
  await records.create("definition", { term: "Exact", meaning: "%_\\ 'phrase'" });
  await records.create("definition", { term: "Spacing", meaning: phrase.replace(" ", "  ") });
  await records.create("definition", { term: "Array", meaning: "No text match", links: [retired.id] });

  const ranked = await knowledge.rankAll(phrase);
  assert.equal(ranked.by, "meaning");
  assert.equal(ranked.hits.length, 10);
  const first = await knowledge.findPhrase(phrase);
  assert.equal(first.records.length, 10, "default page is bounded");
  assert.ok(first.next);
  const all: string[] = [];
  let after: string | undefined;
  do {
    const page = await knowledge.findPhrase(phrase, { limit: 3, ...(after === undefined ? {} : { after }) });
    assert.ok(page.records.length <= 3);
    assert.deepEqual(await knowledge.findPhrase(phrase, { limit: 3, ...(after === undefined ? {} : { after }) }), page, "same cursor repeats the page");
    for (const record of page.records) assert.deepEqual(record, await records.get(record.id), "whole current records");
    all.push(...page.records.map(({ id }) => id));
    after = page.next;
    assert.ok(all.length <= expected.length, "continuation advances");
  } while (after !== undefined);
  assert.deepEqual(all, expected.sort());
  assert.ok(all.some((id) => !ranked.hits.some(({ note }) => note.id === id)), "literal results include matches outside semantic top ten");
  assert.deepEqual((await knowledge.findPhrase(phrase, { kinds: ["story", "decision"], fields: ["title", "text"] })).records.map(({ id }) => id), [decision.id, story.id].sort());
  assert.deepEqual((await knowledge.findPhrase(phrase, { fields: ["title"] })).records.map(({ id }) => id), [story.id]);
  assert.deepEqual(await knowledge.findPhrase("No such phrase"), { records: [] });
  assert.deepEqual(await knowledge.findPhrase(retired.id), { records: [] }, "arrays and record envelopes are not string fields");
  assert.deepEqual(await knowledge.findPhrase(phrase, { fields: [] }), { records: [] });
  assert.deepEqual(await knowledge.findPhrase(phrase, { kinds: [] }), { records: [] });
  for (const limit of [0, 101, 1.5, Number.NaN]) await assert.rejects(knowledge.findPhrase(phrase, { limit }), /limit/);
  await assert.rejects(knowledge.findPhrase(""), /phrase/);
  await assert.rejects(knowledge.findPhrase(phrase, { kinds: ["not-a-kind" as never] }), /kind/);
}

test("14.11 · [memory] literal phrase pages find every current match independently of ranking", async () => {
  const records = new SchemaRecords(new MemoryTransactions());
  const knowledge = new Knowledge(records, undefined, { embedder: async () => ({ model: "constant", embed: async (texts) => texts.map(() => Float32Array.of(1)) }) });
  await exercise(knowledge, records);
});

test("14.11 · [postgres] literal phrase pages are complete and small reads do not transfer unrelated records", async (t) => {
  await withCountedProject(async (project, received) => {
    const knowledge = new Knowledge(project.records, undefined, { embedder: async () => ({ model: "constant", embed: async (texts) => texts.map(() => Float32Array.of(1)) }) });
    await exercise(knowledge, project.records);
    const read = async () => {
      const before = received();
      const page = await knowledge.findPhrase("Exact", { limit: 2 });
      assert.equal(page.records.length, 2);
      return received() - before;
    };
    const small = await read();
    for (let index = 0; index < 100; index++) {
      await project.records.create("definition", { term: `Unrelated ${index}`, meaning: "Unrelated prose. ".repeat(1000) });
    }
    const large = await read();
    t.diagnostic(`phrase page: ${small} bytes before and ${large} bytes after 1.6 MB of unrelated text`);
    assert.ok(large < 8192 && large <= small + 1024, `${small} -> ${large} bytes: query must filter and bound on the server`);
  });
});
