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

test("3/5 the detail panel is rows you scan: a folded intent, a question per row with its status, and nothing of a question's prose until it is opened", () => {
  const list = renderBoard(board, "build");
  assert.match(list, /<details class="arc-fold arc-intent-fold" data-fold-key="build:intent"><summary>Intent<\/summary>/);
  assert.match(list, /data-question-open="q"[^>]*>.*?Which release\?.*?arc-status-open[^>]*>open</s);
  assert.doesNotMatch(list, /\d+ words|diagram stored|no diagram|Open ↗|comes only from waits|<h4>Settled/);
  assert.doesNotMatch(list, /The full question statement/);
  const reading = renderBoard(board, "build", "q");
  assert.match(reading, /The full question statement/);
  assert.match(reading, /data-question-back/);
  assert.doesNotMatch(reading, /data-question-open|Intent of build/);
  assert.equal(renderBoard(board, "build", "removed-question"), list);
});

test("3/5 the increments table follows the questions: a row per open increment opens in place to its detail, and landed ones fold behind one row", () => {
  const work = (id: string, status: "proposal" | "closed" = "proposal") => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: `Objective of ${id}`, body: "planning body", status, ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const, pr: "7" } } : {}) });
  const a = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments: [work("l1", "closed"), work("l2", "closed"), work("o1")] };
  const html = renderBoard(boardView({ arcs: [a], heldOn: {}, waits: {} }, [], new Date()), "a");
  const panel = html.slice(html.indexOf('<aside class="arc-briefing"'));
  assert.match(panel, /<details class="arc-increment" data-fold-key="a:increment:o1"><summary><span class="arc-swatch arc-grey"[^>]*><\/span><span class="arc-increment-title"[^>]*>Build o1<\/span>.*?to take.*?<\/summary>.*?Objective of o1/s);
  assert.match(panel, /<details class="arc-fold arc-landed-fold" data-fold-key="a:landed"><summary>2 landed<\/summary>.*?data-fold-key="a:increment:l1".*?#7/s);
  assert.ok(panel.indexOf("a:increment:o1") < panel.indexOf("a:landed"));
  assert.doesNotMatch(panel, /planning body|<h4>Questions/, "an arc with no questions shows no questions section");
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

test("3/4 a queued lane's hourglass names what it waits on, and its chip under the blocker names the increment", () => {
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
  assert.match(top, /class="arc-mark arc-mark-waits"[^>]*title="Waiting for outside \(missing\): the go-ahead"[^>]*>.*?<span class="arc-mark-count">1<\/span>/);
  assert.match(renderBoard(queued, "users"), /arc-state-ready[^>]*>ready · 1 to take</);
});

const rowOf = (html: string, id: string) => html.split("<section").find((part) => part.includes(`data-arc-id="${id}"`))!;

test("3.2 a lane's second line is its bars alone: the count is spoken on the bars' label, never shown, and no sentence sits beside them", () => {
  const work = (id: string, status: "proposal" | "closed" = "proposal") => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: id, body: id, status, ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const } } : {}) });
  const a = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments: [work("i1", "closed"), work("i2"), work("i3")] };
  const html = renderBoard(boardView({ arcs: [a], heldOn: {}, waits: { i2: [{ on: "i1", reason: "after i1", forGood: false }] }, waitsFor: { i3: [{ releaser: "event", note: "vendor ships the part", checkBack: "2999-01-02", holds: true }] } }, [], new Date()), "a");
  const track = html.match(/<span class="arc-track">(.*?)<\/span>\s*<\/button>/s)![1]!;
  assert.match(track, /^<span class="arc-bars" role="group" aria-label="Increments: 1 landed · 2 open">(<span class="arc-bar[^>]*>[^<]*<\/span>)+<\/span>$/);
  assert.doesNotMatch(html.slice(0, html.indexOf("<aside")), /arc-count|arc-waits-on|arc-note-marker|arc-idle-marker|>1 landed/);
});

test("3.3 a lane counts what its open work waits on at the right of its title: an hourglass for other work and events, a question mark for the owner; a mark with nothing to count is not drawn, and a ready lane's idle claims are in its chip's hover", () => {
  const work = (id: string, arcId: string, status: "proposal" | "active" = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status });
  const arcs = ["ready", "owner", "free", "mixed"].map((id) => ({ arc: record(id, "arc", { title: `Arc ${id}`, intent: id, endState: "Done" }), state: "active" as const,
    questions: id === "owner" ? [record("q1", "question", { arc: id, title: "Which release?", lifecycle: "open", statement: "s", stakes: "s", context: "c", options: "o" })] : [],
    increments: id === "ready" ? [work("r1", id), work("r2", id), work("r3", id), work("r4", id)] : id === "owner" ? [work("o1", id)] : id === "free" ? [work("f1", id, "active"), work("f2", id)] : [work("m1", id), work("m2", id), work("m3", id)] }));
  const owner = { releaser: "owner" as const, note: "approve the spend", holds: true };
  const event = { releaser: "event" as const, note: "vendor ships the part", checkBack: "2999-01-02", holds: true };
  const passed = { releaser: "event" as const, note: "the review window", checkBack: "2020-01-01", holds: false };
  const claim = { seq: 1, project: "p", session: "s1", harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment: "f1", reason: "Fix the footer", at: "2026-09-27T00:00:00Z" };
  const html = renderBoard(boardView({ arcs, heldOn: {}, waits: { m1: [{ on: "o1", reason: "needs o1", forGood: false }], m2: [{ on: "o1", reason: "also o1", forGood: false }], m3: [{ on: "outside", reason: "the go-ahead", forGood: false }] },
    waitsFor: { r2: [owner], r3: [owner, event], r4: [passed], o1: [owner] } }, [claim], new Date("2026-09-27T00:42:00Z")), "ready");
  const marks = (id: string) => [...rowOf(html, id).matchAll(/class="arc-mark arc-mark-(\w+)"[^>]*aria-label="([^"]*)"[^>]*title="([^"]*)"[^>]*>.*?<span class="arc-mark-count">(\d+)<\/span>/g)].map(([, kind, label, title, count]) => ({ kind, label, title, count }));
  assert.deepEqual(marks("ready").map(({ kind, count }) => [kind, count]), [["waits", "1"], ["owner", "1"]], "one event, one owner note held by two increments; a passed check-back holds nothing");
  assert.equal(marks("ready")[0]!.title, "Build r3: waits for an event: vendor ships the part (check back 2999-01-02)");
  assert.equal(marks("ready")[1]!.title, "Build r2: waits for you: approve the spend\nBuild r3: waits for you: approve the spend");
  assert.equal(marks("ready")[1]!.label, marks("ready")[1]!.title);
  assert.deepEqual(marks("owner").map(({ kind, count, title }) => [kind, count, title]), [["owner", "2", "waiting on you: Which release?\nBuild o1: waits for you: approve the spend"]]);
  assert.deepEqual(marks("mixed").map(({ kind, count }) => [kind, count]), [["waits", "2"]], "two increments waiting on one blocker count it once, beside a missing one");
  assert.deepEqual(marks("free"), []);
  assert.match(rowOf(html, "free"), /arc-state-ready" title="[^"]*Fix the footer[^"]*\nin progress · idle 42 min: holds Build f1">ready · 1 to take</, "a ready lane's idle claim moves from beside its chip into the chip's hover");
  assert.match(rowOf(html, "ready"), /<span class="arc-title"[^>]*>Arc ready<\/span><span class="arc-marks">/, "the marks follow the title, at the right of line one");
});

test("3.3 each bar's hover names its note waits, and a bar whose check-back has passed says so", () => {
  const work = (id: string) => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: id, body: id, status: "proposal" });
  const a = { arc: record("a", "arc", { title: "a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments: [work("i1"), work("i2"), work("i3"), work("i4")] };
  const html = renderBoard(boardView({ arcs: [a], heldOn: {}, waits: {}, waitsFor: {
    i1: [{ releaser: "owner", note: "approve the spend", holds: true }],
    i2: [{ releaser: "event", note: "vendor ships the part", checkBack: "2999-01-02", holds: true }],
    i3: [{ releaser: "event", note: "the review window", checkBack: "2020-01-01", holds: false }] } }, [], new Date()), "a");
  const bar = (id: string) => html.match(new RegExp(`<span class="arc-bar[^>]*data-increment-id="${id}"[^>]*>`))![0];
  assert.match(bar("i1"), /arc-yellow[^>]*title="[^"]*waiting on you[^"]*\nwaits for you: approve the spend"/);
  assert.match(bar("i2"), /arc-yellow[^>]*title="[^"]*queued[^"]*\nwaits for an event: vendor ships the part \(check back 2999-01-02\)"/);
  assert.match(bar("i3"), /arc-grey arc-check-back"[^>]*data-check-back-passed="true"[^>]*title="[^"]*\ncheck-back passed 2020-01-01: the review window"/);
  assert.doesNotMatch(bar("i4"), /check-back|waits for/);
  assert.doesNotMatch(bar("i1") + bar("i2"), /data-check-back-passed/);
});
