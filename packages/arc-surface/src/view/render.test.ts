import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../testing/records.js";
import { boardView, type BoardSnapshot } from "../board/board.js";
import { renderBoard, renderHandle } from "./render.js";

const snapshot: BoardSnapshot = {
  arcs: ["build", "release", "follow", "other"].map((id) => ({
    arc: record(id, "arc", { title: id, intent: `Intent of ${id}`, endState: "Done" }),
    state: "active", increments: [], questions: id === "build" ? [record("q", "question", {
      arc: id, title: "Which release?", lifecycle: "open", statement: "The full question statement",
      stakes: "A useful first release", context: "Some context", options: "One or several",
    })] : [],
  })),
  waits: { release: [{ on: "build", reason: "Board first", forGood: false }], follow: [{ on: "release", reason: "Release first", forGood: false }], other: [{ on: "release", reason: "Release first", forGood: false }] },
  heldOn: {},
};
const board = boardView(snapshot, [], new Date());

test("3/4 drawer rows hide queued chips until their blocker's caret opens, with downstream +N", () => {
  const closed = renderBoard(board, "build");
  assert.match(closed, /data-arc-queue="build"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(closed, /data-arc-select="release"/);
  const opened = renderBoard(board, "build", undefined, new Set(["build"]));
  assert.match(opened, /data-arc-queue="build"[^>]*aria-expanded="true"/);
  assert.match(opened, /data-arc-select="release"/);
  assert.match(opened, /\+2/);
  assert.doesNotMatch(opened, /Queued after this arc/);
});

test("3/5 question list gives reading cost; opening swaps in the reading and back restores the list", () => {
  const list = renderBoard(board, "build");
  assert.match(list, /data-question-open="q"/);
  assert.match(list, /\d+ words/);
  assert.doesNotMatch(list, /The full question statement/);
  const reading = renderBoard(board, "build", "q");
  assert.match(reading, /The full question statement/);
  assert.match(reading, /data-question-back/);
  assert.doesNotMatch(reading, /data-question-open|Intent of build/);
  assert.equal(renderBoard(board, "build", undefined), list);
  assert.equal(renderBoard(board, "build", "removed-question"), list);
});

// Arc surface contract 3.1: the bar is dedicated to arcs and exposes its toggle state.
test("3.1 the arc bar omits the project and exposes open/close to keyboard users", () => {
  const closed = renderHandle('A <project> & "team"', false);
  assert.match(closed, /<button[^>]*type="button"/);
  assert.match(closed, /aria-label="Open arc surface"/);
  assert.match(closed, /aria-expanded="false" aria-controls="arc-drawer"/);
  assert.match(closed, />Arcs<\/span>/);
  assert.doesNotMatch(closed, /project|team/);
  assert.doesNotMatch(renderHandle("storytree", true), /storytree/);
  const open = renderHandle("storytree", true);
  assert.match(open, /aria-label="Close arc surface"/);
  assert.match(open, /aria-expanded="true" aria-controls="arc-drawer"/);
  assert.match(open, /data-close-arcs/);
});
