import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldsOf } from "@storytree/library";
import { boardView } from "../board/board.js";
import { record } from "../testing/records.js";
import { briefing, firstBriefing, incrementRows, questionReading } from "./briefing.js";

const fields: FieldsOf<"question"> = {
  arc: "a", title: "Choose the view", lifecycle: "open", statement: "Choose a view", stakes: "Readers need clarity",
  context: "Full detail stays here", analogy: "Like a map", diagram: "A → B",
  options: "A. Compact FOR: quick scan AGAINST: less detail\n\nB. Whole FOR: full detail AGAINST: more reading\n\nKeep this older option intact.",
  recommendation: "Try the compact view",
};
const question = { id: "q", fields };

test("5.1 and 5.3 briefing starts with intent, lists every question in one list, open first, each with its status, and initially picks the first waiting arc", () => {
  const settled = { id: "answered", fields: { ...fields, lifecycle: "settled" as const, answer: "Use the whole view", settledAt: "2026-09-27T00:00:00Z" } };
  const read = briefing("Make the work legible.", [settled, question]);
  assert.equal(read.intent, "Make the work legible.");
  assert.deepEqual(read.questions.map(({ id, status, answer }) => [id, status, answer]), [["q", "open", undefined], ["answered", "settled", "Use the whole view"]]);
  assert.equal(read.parkedNote, undefined);
  assert.equal(firstBriefing([{ id: "quiet", questions: [] }, { id: "waiting", questions: [question] }]), "waiting");
  assert.equal(firstBriefing([{ id: "quiet", questions: [] }, { id: "settled", questions: [settled] }]), "quiet");
  assert.equal(firstBriefing([]), undefined);
});

test("5.4 a parked arc's briefing says once that its open questions are parked with the arc, and a parked arc's question does not pick the first briefing", () => {
  const read = briefing("Intent", [question], { parked: true });
  assert.deepEqual(read.questions.map(({ id }) => id), ["q"]);
  assert.match(read.parkedNote ?? "", /parked with the arc/i);
  assert.equal(briefing("Intent", [question], { parked: false }).parkedNote, undefined);
  assert.equal(briefing("Intent", [], { parked: true }).parkedNote, undefined);
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

const work = (id: string, extra: Partial<FieldsOf<"increment">> = {}) => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: `Objective of ${id}`, body: "planning body", status: "proposal", parked: "2026-09-27T00:00:00Z", ...extra });
const closed = (id: string, disposition: "landed" | "failed", pr?: string) => work(id, { status: "closed", outcome: { date: "2026-09-20", disposition, ...(pr ? { pr } : {}), note: `Closed ${id}` } });

test("5.5 the increments table gives each increment one short cell of chips, open work first (waiting, in progress, to take), then not completed, then landed", () => {
  const arc = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const,
    questions: [record("q1", "question", { arc: "a", title: "Which release?", lifecycle: "open", statement: "s", stakes: "s", context: "c", options: "o" })],
    increments: [closed("l1", "landed", "storytree-ai/storytree#131"), closed("l2", "landed"), closed("f1", "failed"), work("free"), work("held"), work("owner", { heldOn: ["q1"] }),
      work("other"), work("event"), work("passed"), work("blocked", { capabilities: ["c1"] }), work("holder", { capabilities: ["c1"] })] };
  const claim = (increment: string, session: string) => ({ seq: 1, project: "p", session, harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment, reason: "Working", at: "2026-09-27T00:00:00Z" });
  const board = boardView({ arcs: [arc], heldOn: { owner: ["q1"] }, waits: { other: [{ on: "event", reason: "after event", forGood: false }, { on: "free", reason: "after free", forGood: false }] },
    waitsFor: { event: [{ releaser: "event", note: "vendor ships", checkBack: "2999-01-02", holds: true }], passed: [{ releaser: "event", note: "review window", checkBack: "2020-01-01", holds: false }] } },
    [claim("held", "s1"), claim("holder", "s2")], new Date("2026-09-27T00:12:00Z"));
  const rows = incrementRows(board.lanes[0]!);
  const cells = Object.fromEntries(rows.map(({ id, chips }) => [id, chips.map(({ text }) => text)]));
  assert.deepEqual(cells.owner, ["you"]);
  assert.deepEqual(cells.other, ["2 increments"]);
  assert.deepEqual(cells.event, ["event"]);
  assert.deepEqual(cells.passed, ["check-back passed"]);
  assert.deepEqual(cells.blocked, ["blocked"]);
  assert.match(cells.held!.join(), /12 min quiet/);
  assert.deepEqual(cells.free, ["to take"]);
  assert.deepEqual(cells.f1, ["not completed"]);
  assert.deepEqual(cells.l1, ["#131"]);
  assert.deepEqual(cells.l2, ["landed"]);
  const order = rows.map(({ id }) => id);
  assert.deepEqual(order.slice(-3), ["f1", "l1", "l2"]);
  assert.ok(order.indexOf("blocked") < order.indexOf("held") && order.indexOf("owner") < order.indexOf("held") && order.indexOf("held") < order.indexOf("free"));
  assert.deepEqual(rows.filter(({ landed }) => landed).map(({ id }) => id), ["l1", "l2"]);
  assert.equal(rows.find(({ id }) => id === "l1")!.color, "green");
});

test("5.6 opening an increment row reads its objective, each wait by name with its reason, the questions it waits behind, what it holds up, who holds it and how it closed, never its planning body", () => {
  const arc = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [],
    increments: [closed("l1", "landed", "131"), work("w1"), work("w2")] };
  const board = boardView({ arcs: [arc], heldOn: {}, waits: { w1: [{ on: "w2", reason: "after w2", forGood: false }] },
    waitsFor: { w2: [{ releaser: "owner", note: "approve the spend", holds: true }] } }, [], new Date());
  const rows = new Map(incrementRows(board.lanes[0]!).map((row) => [row.id, row]));
  const w1 = rows.get("w1")!.detail;
  assert.equal(w1.objective, "Objective of w1");
  assert.deepEqual(w1.waits, ["Build w2 (Arc a): after w2"]);
  assert.deepEqual(rows.get("w2")!.detail.waits, ["waits for you: approve the spend"]);
  assert.deepEqual(rows.get("w2")!.detail.holdsUp, ["Build w1 (Arc a): after w2"]);
  assert.deepEqual(rows.get("l1")!.detail.close, "landed · PR 131 · Closed l1");
  assert.doesNotMatch(JSON.stringify([...rows.values()]), /planning body/);
});
