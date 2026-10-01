import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldsOf } from "@storytree/library";
import { briefing, firstBriefing, questionReading } from "./briefing.js";

const fields: FieldsOf<"question"> = {
  arc: "a", title: "Choose the view", lifecycle: "open", statement: "Choose a view", stakes: "Readers need clarity",
  context: "Full detail stays here", analogy: "Like a map", diagram: "A → B",
  options: "A. Compact FOR: quick scan AGAINST: less detail\n\nB. Whole FOR: full detail AGAINST: more reading\n\nKeep this older option intact.",
  recommendation: "Try the compact view",
};
const question = { id: "q", fields };

test("5.1 and 5.3 briefing starts with intent, separates open and settled questions with their answers, and initially picks the first waiting arc", () => {
  const settled = { id: "answered", fields: { ...fields, lifecycle: "settled" as const, answer: "Use the whole view", settledAt: "2026-09-27T00:00:00Z" } };
  const read = briefing("Make the work legible.", [settled, question]);
  assert.equal(read.intent, "Make the work legible.");
  assert.equal(read.waitingLabel, "Waiting on you");
  assert.deepEqual(read.waiting.map(({ id }) => id), ["q"]);
  assert.deepEqual(read.settled.map(({ id, answer }) => [id, answer]), [["answered", "Use the whole view"]]);
  assert.equal(read.blockedNote, '"Blocked" comes only from waits on other work.');
  assert.equal(briefing("Intent", [settled]).waitingLabel, "Nothing is waiting on you here");
  assert.equal(firstBriefing([{ id: "quiet", questions: [] }, { id: "waiting", questions: [question] }]), "waiting");
  assert.equal(firstBriefing([{ id: "quiet", questions: [] }, { id: "settled", questions: [settled] }]), "quiet");
  assert.equal(firstBriefing([]), undefined);
});

test("5.4 a parked arc's briefing lists its open questions as parked with the arc, and a parked arc's question does not pick the first briefing", () => {
  const read = briefing("Intent", [question], { parked: true });
  assert.deepEqual(read.waiting.map(({ id }) => id), ["q"]);
  assert.doesNotMatch(read.waitingLabel, /waiting on you/i);
  assert.match(read.waitingLabel, /parked with the arc/i);
  assert.equal(briefing("Intent", [question], { parked: false }).waitingLabel, "Waiting on you");
  assert.equal(firstBriefing([{ id: "quiet", questions: [] }, { id: "parked", parked: true, questions: [question] }]), "quiet");
});

test("5.2 a question is read statement first with trade-offs, a non-binding recommendation and measured folds; unstructured options survive", () => {
  const read = questionReading(question);
  assert.deepEqual(read.lead.map(({ label, text }) => [label, text]), [["Statement", "Choose a view"], ["Stakes", "Readers need clarity"]]);
  assert.equal(read.diagram, "A → B");
  assert.equal(read.hasDiagram, true);
  assert.deepEqual(read.options, [
    { summary: "A. Compact", for: "quick scan", against: "less detail" },
    { summary: "B. Whole", for: "full detail", against: "more reading" },
    { summary: "Keep this older option intact.", for: "", against: "" },
  ]);
  assert.deepEqual(read.recommendation, { label: "Recommendation (not binding)", text: "Try the compact view" });
  assert.deepEqual(read.folds, [
    { label: "Analogy", text: "Like a map", words: 3 },
    { label: "Context", text: "Full detail stays here", words: 4 },
  ]);
  assert.equal(read.words, 41); // 20 words in the other fields, 21 across the three options.
  const noDiagram = questionReading({ id: "q", fields: { ...fields, diagram: undefined } });
  assert.equal(noDiagram.diagram, "No diagram stored");
  assert.equal(noDiagram.hasDiagram, false);
});
