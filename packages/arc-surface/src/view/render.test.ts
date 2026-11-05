import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../testing/records.js";
import { boardView, type BoardSnapshot } from "../board/board.js";
import { renderBoard } from "./render.js";

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

test("3.3 · lane rows hide queued chips until their blocker's caret opens, with downstream +N", () => {
  const closed = renderBoard(board, "build");
  assert.match(closed, /data-arc-queue="build"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(closed, /data-arc-select="release"/);
  const opened = renderBoard(board, "build", new Set(["build"]));
  assert.match(opened, /data-arc-queue="build"[^>]*aria-expanded="true"/);
  assert.match(opened, /data-arc-select="release"/);
  assert.match(opened, /\+2/);
  assert.doesNotMatch(opened, /Queued after this arc/);
});

test("5.1 · an arc's expansion opens on its intent folded behind one line with a copy-title button, then a question per row with its status, its reading folded under the row", () => {
  const under = renderBoard(board, undefined, new Set(["build"]));
  assert.match(under, /<details class="arc-fold arc-intent-fold" data-fold-key="rail:build:intent"><summary>Intent<\/summary><p[^>]*>Intent of build<\/p><\/details><button[^>]*data-copy-arc-title="build"/);
  assert.match(under, /<details class="arc-question-row" data-rail-question="q"[^>]*><summary>.*?Which release\?.*?arc-status-open[^>]*>open<\/span><\/summary>/s);
  assert.ok(under.indexOf("rail:build:intent") < under.indexOf('data-rail-question="q"'), "the intent comes first");
  assert.doesNotMatch(under.match(/data-rail-question="q"[^>]*><summary>[^]*?<\/summary>/)![0], /The full question statement|\d+ words|diagram stored/, "the question's row shows none of its prose");
  assert.doesNotMatch(renderBoard(board), /Intent of build|data-rail-question|data-copy-arc-title/, "a closed row shows nothing under it");
  assert.doesNotMatch(under, /arc-card|data-surface-layer="overlay"/, "nothing is drawn over the map");
});

test("5.2 · a question's row unfolds its full reading in place: statement first, then stakes, its options and its folds", () => {
  const under = renderBoard(board, undefined, new Set(["build"]));
  const row = under.match(/<details class="arc-question-row" data-rail-question="q"[^]*?<\/article><\/details>/)![0];
  assert.match(row, /<\/summary><article class="arc-question" data-question-id="q">.*?<h4>Statement<\/h4><p[^>]*>The full question statement<\/p><h4>Stakes<\/h4>/s);
  assert.match(row, /<details class="arc-fold" data-fold-key="rail:build:question:q:Context">/);
});

test("4.1 · selecting a queued arc's chip draws that arc's expansion under the chips, and no other chip's", () => {
  const chosen = renderBoard(board, "release", new Set(["build"]));
  assert.match(chosen, /data-arc-select="release" aria-pressed="true"/);
  const queued = chosen.slice(chosen.indexOf('class="arc-queue"'));
  assert.match(queued, /<div class="arc-queued-under"[^>]*>.*?data-fold-key="rail:release:intent".*?Intent of release/s);
  assert.doesNotMatch(renderBoard(board, undefined, new Set(["build"])), /arc-queued-under|Intent of release/, "an unselected chip draws nothing under the chips");
});

test("5.5 · the increments table follows the questions: a row per open increment opens in place to its detail, and landed ones fold behind one row", () => {
  const work = (id: string, status: "proposal" | "closed" = "proposal") => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: `Objective of ${id}`, body: "planning body", status, ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const, pr: "7" } } : {}) });
  const a = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments: [work("l1", "closed"), work("l2", "closed"), work("o1")] };
  const panel = renderBoard(boardView({ arcs: [a], heldOn: {}, waits: {} }, [], new Date()), undefined, new Set(["a"]));
  assert.match(panel, /<details class="arc-increment" data-fold-key="rail:a:increment:o1"><summary><span class="arc-swatch arc-grey"[^>]*><\/span><span class="arc-increment-title"[^>]*>Build o1<\/span>.*?to take.*?<\/summary>.*?Objective of o1/s);
  assert.match(panel, /<details class="arc-fold arc-landed-fold" data-fold-key="rail:a:landed"><summary>2 landed<\/summary>.*?data-fold-key="rail:a:increment:l1".*?#7/s);
  assert.ok(panel.indexOf("rail:a:increment:o1") < panel.indexOf("rail:a:landed"));
  assert.doesNotMatch(panel, /planning body|arc-rail-questions/, "an arc with no questions shows no questions table");
});

test("3.3 · a queued lane's hourglass names what it waits on, and its chip under the blocker names the increment", () => {
  const work = (id: string, arcId: string) => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status: "proposal" });
  const arcs = ["lamp", "users", "cutover"].map((id) => ({ arc: record(id, "arc", { title: `Arc ${id}`, intent: id, endState: "Done" }), state: "active" as const, increments: [work(`${id}1`, id)], questions: [] }));
  const queued = boardView({ arcs, heldOn: {}, waits: {
    lamp1: [{ on: "users1", reason: "after first users", forGood: false }],
    cutover1: [{ on: "outside", reason: "the go-ahead", forGood: false }],
  } }, [], new Date());
  const closed = renderBoard(queued, "users");
  assert.doesNotMatch(closed, /data-arc-select="lamp"/);
  const opened = renderBoard(queued, "users", new Set(["users"]));
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
  assert.doesNotMatch(html, /arc-count|arc-waits-on|arc-note-marker|arc-idle-marker|>1 landed/);
});

test("3.2 a claimed increment's oval carries its holder's flag in the session's colour, furled and greyed while the holder is idle; an unclaimed one carries none", () => {
  const work = (id: string) => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: id, body: id, status: "proposal" });
  const a = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments: [work("i1"), work("i2"), work("i3")] };
  const claim = (session: string, increment: string, at: string) => ({ seq: 1, project: "p", session, harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment, reason: `Build ${increment}`, at });
  const lanes = (claims: ReturnType<typeof claim>[]) => renderBoard(boardView({ arcs: [a], heldOn: {}, waits: {} }, claims, new Date("2026-09-27T00:42:00Z")), "a");
  const html = lanes([claim("idle-one", "i1", "2026-09-27T00:00:00Z"), claim("live-one", "i2", "2026-09-27T00:41:00Z")]);
  const bar = (id: string) => html.match(new RegExp(`<span class="arc-bar[^"]*"[^>]*data-increment-id="${id}".*?</span>`, "s"))![0];
  const fill = (id: string) => bar(id).match(/<path class="arc-flag-pennant" d="M[^"]+Z" fill="([^"]+)"/)?.[1];
  const tipOut = (id: string) => Math.max(...[...bar(id).match(/d="M([^"]+)Z"/)![1]!.matchAll(/(-?[\d.]+),/g)].map(([, x]) => Number(x)));
  assert.match(bar("i1"), /<svg class="arc-agent-mark"[^>]*data-agent-session="idle-one"[^>]*data-work-id="i1"[^>]*data-agent-label="[^"]+"/, "mount reads the holder from its flag");
  assert.equal(fill("i2"), "hsl(314, 80%, 68%)", "the live holder's own session colour, as the globe wears it");
  assert.equal(fill("i1"), "hsl(211, 53.33%, 64%)", "the idle holder's, greyed: from hsl(211, 80%, 68%)");
  assert.ok(tipOut("i1") < tipOut("i2") * 0.5, "the idle holder's pennant is furled");
  assert.doesNotMatch(bar("i3"), /<svg/);
  assert.doesNotMatch(html, /●/, "no dot");
  assert.doesNotMatch(html, /style=/, "no inline style: the window's style-src 'self' refuses one, so the flag's place comes from the stylesheet alone");
  assert.match(html, /<span class="arc-track arc-flagged">/, "a lane with a flag leaves it headroom");
  assert.match(lanes([]), /<span class="arc-track">/, "and a lane with none does not");
});

test("3.2 a long arc's strip stops at four rows: past them its landed ovals fold into one \"N landed\" mark, and open ovals still beyond four rows into a \"+N\" mark; a short arc is drawn whole, and the label keeps the full count", () => {
  const work = (id: string, status: "proposal" | "closed" = "proposal") => record(id, "increment", { arc: "a", title: `Build ${id}`, objective: id, body: id, status, ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const } } : {}) });
  const many = (prefix: string, count: number, status?: "closed") => Array.from({ length: count }, (_, index) => work(`${prefix}${String(index).padStart(2, "0")}`, status));
  const strip = (increments: ReturnType<typeof work>[], perRow?: number) => {
    const a = { arc: record("a", "arc", { title: "Arc a", intent: "a", endState: "Done" }), state: "active" as const, questions: [], increments };
    return renderBoard(boardView({ arcs: [a], heldOn: {}, waits: {} }, [], new Date()), undefined, new Set(), perRow).match(/<span class="arc-bars"[^>]*>.*?<\/span><\/span>\s*<\/button>/s)![0];
  };
  const ovals = (html: string) => [...html.matchAll(/data-increment-id="([^"]+)"/g)].map(([, id]) => id);
  const short = [...many("l", 10, "closed"), ...many("o", 10)];
  assert.equal(ovals(strip(short, 5)).length, 20, "twenty ovals fill four rows of five: drawn whole");
  assert.equal(strip(short, 5), strip(short), "and drawn exactly as an unmeasured strip is");
  assert.doesNotMatch(strip(short, 5), /arc-fold-mark/);

  const long = strip([...many("l", 30, "closed"), ...many("o", 5)], 5);
  assert.match(long, /aria-label="Increments: 30 landed · 5 open"/, "the full count stays on the label");
  assert.match(long, /^<span class="arc-bars"[^>]*><span class="arc-fold-mark arc-landed-mark" role="img" aria-label="30 landed\nBuild l00\nBuild l01[^"]*Build l29" title="30 landed\nBuild l00\nBuild l01[^"]*Build l29"[^>]*>30 landed<\/span>/, "the landed fold opens the strip and its hover names what it folds");
  assert.deepEqual(ovals(long), ["o00", "o01", "o02", "o03", "o04"], "the open ovals follow it, every one drawn");
  assert.doesNotMatch(long, /arc-more-mark/);

  const crowded = strip([...many("l", 30, "closed"), ...many("o", 25)], 5);
  assert.deepEqual(ovals(crowded), Array.from({ length: 15 }, (_, index) => `o${String(index).padStart(2, "0")}`), "a landed mark of three ovals' width, then fifteen ovals, then a +N of two: four rows of five");
  assert.match(crowded, /<span class="arc-fold-mark arc-more-mark" role="img" aria-label="10 more\nBuild o15\n[^"]*Build o24" title="10 more\nBuild o15\n[^"]*Build o24"[^>]*>\+10<\/span><\/span>/, "the +N ends the strip and names what it folds");

  const open = strip(many("o", 25), 5);
  assert.deepEqual(ovals(open).length, 18, "with nothing landed, eighteen ovals and a +N");
  assert.match(open, />\+7<\/span>/);
  assert.doesNotMatch(open, /arc-landed-mark/);
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

test("3.21 · an arc row's caret opens under the row its intent, then its questions, then its increments with the landed folded, then its queued arcs; an arc with no questions shows no question rows", () => {
  const work = (arcId: string, id: string, status: "proposal" | "closed" = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: `Objective of ${id}`, body: "planning body", status, ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const, pr: "7" } } : {}) });
  const asking = (id: string, lifecycle: "open" | "settled") => record(id, "question", { arc: "a", title: `Ask ${id}`, lifecycle, statement: "s", stakes: "s", context: "c", options: "o" });
  const arcs = [
    { arc: record("a", "arc", { title: "Arc a", intent: "Intent of a", endState: "Done" }), state: "active" as const, questions: [asking("settled1", "settled"), asking("open1", "open")], increments: [work("a", "l1", "closed"), work("a", "o1")] },
    { arc: record("b", "arc", { title: "Arc b", intent: "Intent of b", endState: "Done" }), state: "active" as const, questions: [], increments: [work("b", "b1")] },
    { arc: record("c", "arc", { title: "Arc c", intent: "Intent of c", endState: "Done" }), state: "active" as const, questions: [], increments: [work("c", "c1")] },
  ];
  const shown = boardView({ arcs, heldOn: {}, waits: { c1: [{ on: "o1", reason: "after o1", forGood: false }] } }, [], new Date());
  const closed = renderBoard(shown);
  assert.match(rowOf(closed, "b"), /data-arc-queue="b"[^>]*aria-expanded="false"/, "an arc with increments and nothing queued has a caret");
  assert.doesNotMatch(closed, /data-rail-question|arc-increment|arc-intent/, "nothing opens until the caret does");
  const opened = renderBoard(shown, undefined, new Set(["a", "b"]));
  const a = rowOf(opened, "a"), b = rowOf(opened, "b");
  assert.match(a, /data-arc-queue="a"[^>]*aria-expanded="true"/);
  assert.match(a, /data-arc-queue="a"[^>]*aria-label="Hide the intent, 2 questions, 2 increments, 1 queued arc under Arc a"/, "the caret names what it opens, each counted");
  assert.match(b, /data-arc-queue="b"[^>]*aria-label="Hide the intent, 1 increment under Arc b"/);
  assert.ok(a.indexOf('data-rail-question="open1"') < a.indexOf('data-rail-question="settled1"'), "open questions first");
  assert.ok(a.indexOf("Intent of a") < a.indexOf('data-rail-question="open1"'), "the intent before the questions");
  assert.ok(a.indexOf('data-rail-question="settled1"') < a.indexOf("rail:a:increment:o1"), "questions before increments");
  assert.match(a, /<details class="arc-fold arc-landed-fold" data-fold-key="rail:a:landed"><summary>1 landed<\/summary>.*?data-fold-key="rail:a:increment:l1"/s);
  assert.ok(a.indexOf("rail:a:increment:o1") < a.indexOf("rail:a:landed"), "open work before the landed fold");
  assert.ok(a.indexOf("rail:a:landed") < a.indexOf('data-arc-select="c"'), "the queued arcs come last");
  assert.doesNotMatch(opened, /planning body/, "no planning body");
  assert.doesNotMatch(b, /data-rail-question/, "an arc with no questions shows only its increments");
  assert.match(b, /rail:b:increment:b1/);
  assert.doesNotMatch(a.replace(/<span class="arc-track.*?<\/span><\/span>/s, ""), /data-increment-id/, "the rows under an arc are not drawn bars");
});
