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

test("3/4 a queued lane says what it waits on, and its chip under the blocker names the increment", () => {
  const work = (id: string, arcId: string) => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status: "proposal" });
  const arcs = ["lamp", "users", "cutover"].map((id) => ({ arc: record(id, "arc", { title: `Arc ${id}`, intent: id, endState: "Done" }), state: "active" as const, increments: [work(`${id}1`, id)], questions: [] }));
  const queued = boardView({ arcs, heldOn: {}, waits: {
    lamp1: [{ on: "users1", reason: "after first users", forGood: false }],
    cutover1: [{ on: "outside", reason: "the go-ahead", forGood: false }],
  } }, [], new Date());
  const closed = renderBoard(queued, "users");
  assert.doesNotMatch(closed, /data-arc-select="lamp"/);
  const opened = renderBoard(queued, "users", undefined, new Set(["users"]));
  assert.match(opened, /data-arc-select="lamp"[^>]*aria-label="Arc lamp — queued behind Arc users, waits on Build users1"/);
  const top = renderBoard(queued, "cutover");
  assert.match(top, /arc-state-queued[^>]*>queued</);
  assert.match(top, /class="arc-waits-on"[^>]*>waits on outside \(missing\)</);
  assert.match(renderBoard(queued, "users"), /arc-state-ready[^>]*>ready · 1 to take</);
});

test("3.3 a ready lane that also has idle claims keeps a small muted marker beside its chip, whose hover names who holds what; an idle lane has only its own chip", () => {
  const work = (id: string, arcId: string, status: "proposal" | "active" = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status });
  const arcs = ["mixed", "only", "free"].map((id) => ({ arc: record(id, "arc", { title: `Arc ${id}`, intent: id, endState: "Done" }), state: "active" as const, questions: [],
    increments: id === "mixed" ? [work("m1", id, "active"), work("m2", id), work("m3", id)] : id === "only" ? [work("o1", id, "active")] : [work("f1", id)] }));
  const claim = (seq: number, session: string, increment: string) => ({ seq, project: "p", session, harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment, reason: "Fix the footer", at: "2026-09-27T00:00:00Z" });
  const html = renderBoard(boardView({ arcs, heldOn: {}, waits: {} }, [claim(1, "s1", "o1"), claim(2, "s2", "m1")], new Date("2026-09-27T00:42:00Z")), "mixed");
  const row = (id: string) => html.split("<section").find((part) => part.includes(`data-arc-id="${id}"`))!;
  assert.match(row("mixed"), /arc-state-ready[^>]*>ready · 2 to take<\/span><span class="arc-chip arc-idle-marker"[^>]*title="[^"]*Fix the footer[^"]*idle for 42 min[^"]*"[^>]*>idle · 42 min<\/span>/);
  assert.equal((row("only").match(/arc-chip/g) ?? []).length, 1, "an idle lane has only its own chip");
  assert.match(row("only"), /arc-state-idle[^>]*>idle · 42 min</);
  assert.doesNotMatch(row("free"), /arc-idle-marker/);
});
