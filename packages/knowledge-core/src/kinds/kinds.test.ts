/** Capability 5 · Show and filter by artifact kind. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { knowledge } from "../ghosts/ghosts.js";
import { History } from "../testing/changes.js";
import { createKnowledgeCore } from "../view/index.js";
import { dotColour, drawnPoints, kindRows } from "./kinds.js";

const history = () => new History().story("front")
  .create("friction-a", "friction", { title: "It fought me" })
  .create("friction-b", "friction", { title: "It fought me again" })
  .create("rule", "principle", { title: "Protect a behaviour" })
  .decision("cover", { frontCoverOf: "front" })
  .decision("old", { frontCoverOf: "front" })
  .decision("new", { frontCoverOf: "front", supersedes: ["old"] })
  .decision("maybe", { status: "proposed" })
  .create("word", "definition", { term: "Shelf", meaning: "An entrance." });

test("5.5 the kind list has a row per kind with a drawn dot, in a fixed order, with its name, colour and count; ghosts and proposals are not counted", () => {
  const rows = kindRows(knowledge(history().changes), new Set(["friction"]));
  assert.deepEqual(rows.map(({ kind, label, count, shown }) => ({ kind, label, count, shown })), [
    { kind: "decision", label: "Decisions", count: 2, shown: true },
    { kind: "definition", label: "Definitions", count: 1, shown: true },
    { kind: "principle", label: "Principles", count: 1, shown: true },
    { kind: "friction", label: "Friction", count: 2, shown: false },
  ]);
  assert.equal(new Set(rows.map(({ colour }) => colour)).size, rows.length, "each kind has its own colour");
});

test("5.6 a core opens with every kind shown but friction and re-steers; switching a kind flips it alone, and switching off the pinned artifact's kind closes its card", () => {
  const core = createKnowledgeCore("app");
  const state = () => (core as unknown as { get(): { hidden: ReadonlySet<string>; pinned: string | undefined; dismissed: string | undefined } }).get();
  try {
    core.take(history().changes, []);
    assert.deepEqual([...state().hidden].sort(), ["friction", "resteer"]);
    core.pin("rule");
    core.showKind("decision", false);
    assert.equal(state().dismissed, undefined, "another kind's card stays open");
    core.showKind("principle", false);
    assert.deepEqual([...state().hidden].sort(), ["decision", "friction", "principle", "resteer"]);
    assert.equal(state().dismissed, "rule", "the pinned principle's card closes");
    core.pin(undefined);
    core.showKind("principle", true);
    core.showKind("friction", true);
    assert.deepEqual([...state().hidden].sort(), ["decision", "resteer"]);
    core.pin("rule");
    assert.equal(state().dismissed, undefined, "pinned again once its kind is back, its card opens");
  } finally {
    core.dispose();
  }
});

test("5.7 no dot of a switched-off kind is drawn, except a note the selected session touched", () => {
  const { notes } = knowledge(history().changes);
  const points = ["friction-a", "friction-b", "rule", "cover"].map(id => ({ id }));
  const drawn = (hidden: string[], kept: string[] = []) => drawnPoints(points, notes, new Set(hidden), new Set(kept)).map(({ id }) => id);
  assert.deepEqual(drawn([]), ["friction-a", "friction-b", "rule", "cover"]);
  assert.deepEqual(drawn(["friction"]), ["rule", "cover"]);
  assert.deepEqual(drawn(["friction", "decision"], ["friction-b"]), ["friction-b", "rule"]);
});

test("5.8 a dot no session colours wears its kind's colour, the one its row shows; a session's colour wins", () => {
  const rows = kindRows(knowledge(history().changes), new Set());
  const principle = rows.find(({ kind }) => kind === "principle")!.colour;
  assert.equal(dotColour("principle", undefined), principle);
  assert.notEqual(dotColour("friction", undefined), principle);
  assert.equal(dotColour("principle", "#0072B2"), "#0072B2");
});
