import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArcView, FieldsOf } from "@storytree/library";
import { record } from "../testing/records.js";
import { boardView, type BoardSnapshot } from "./board.js";
import { renderBoard } from "../view/render.js";

const increment = (id: string, status: FieldsOf<"increment">["status"], at: string, disposition?: "landed" | "failed") => record(id, "increment", {
  arc: "a", title: id, objective: id, body: id, status, parked: at,
  ...(disposition ? { outcome: { date: at, disposition } } : {}),
}, at);
const arc = (id: string, state: ArcView["state"] = "active", at = "2026-09-27"): ArcView => ({
  arc: record(id, "arc", { title: id, intent: `Intent of ${id}`, endState: "Done" }, at), state, increments: [], questions: [],
});

test("3.2 lanes show finished bars first, then oldest open work, with named counts and state colours", () => {
  const a = arc("a");
  a.increments.push(increment("new", "proposal", "2026-09-27"), increment("failed", "closed", "2026-09-26", "failed"), increment("old", "proposal", "2026-09-25"), increment("landed", "closed", "2026-09-24", "landed"));
  const snapshot: BoardSnapshot = { arcs: [a], waits: { old: [{ on: "outside", reason: "needs it", forGood: true }] }, heldOn: {} };
  const board = boardView(snapshot, [], new Date());
  assert.deepEqual(board.lanes[0]?.bars.map(({ id, reading }) => [id, reading.color]), [["landed", "green"], ["failed", "red"], ["old", "yellow"], ["new", "grey"]]);
  assert.equal(board.lanes[0]?.count, "1 landed · 1 not completed · 2 open");
  const html = renderBoard(board, "a");
  assert.match(html, /data-increment-id="old"/);
  assert.match(html, /will not release by itself/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("3.3 lanes sort waiting, blocked, claimed, idle, quiet then recent activity; scopes partition arcs and idle age is on the chip", () => {
  const quiet = arc("quiet", "active", "2026-09-20");
  const recent = arc("recent");
  const idle = arc("idle"); idle.increments.push(record("i", "increment", { arc: "idle", title: "Build", objective: "Build", body: "Build", status: "active" }));
  const claimed = arc("claimed"); claimed.increments.push(record("j", "increment", { arc: "claimed", title: "Build", objective: "Build", body: "Build", status: "active" }));
  const waiting = arc("waiting"); waiting.questions.push(record("q", "question", { arc: "waiting", title: "Question", lifecycle: "open", statement: "Pick", stakes: "Matters", context: "Context", options: "A or B" }));
  const snapshot: BoardSnapshot = { arcs: [quiet, recent, idle, claimed, arc("blocked"), waiting, arc("parked", "parked"), arc("closed", "closed")], waits: { blocked: [{ on: "missing", reason: "needs it", forGood: true }] }, heldOn: {} };
  const lines = [
    { seq: 1, project: "p", session: "s", harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment: "i", reason: "building", at: "2026-09-27T00:00:00Z" },
    { seq: 2, project: "p", session: "t", harness: "codex", source: "hook" as const, kind: "claimed" as const, increment: "j", reason: "building", at: "2026-09-27T00:40:00Z" },
  ];
  const now = new Date("2026-09-27T00:42:00Z");
  const board = boardView(snapshot, lines, now);
  assert.deepEqual(board.lanes.map(({ id }) => id), ["waiting", "blocked", "claimed", "idle", "recent", "quiet"]);
  assert.equal(board.lanes.find(({ id }) => id === "idle")?.chip, "idle · 42 min");
  assert.equal(board.selected, "waiting");
  assert.deepEqual(boardView(snapshot, lines, now, "parked").lanes.map(({ id }) => id), ["parked"]);
  assert.deepEqual(boardView(snapshot, lines, now, "closed").lanes.map(({ id }) => id), ["closed"]);
});

test("3.3 a lane whose open work all waits reads queued, ranks with blocked and names what it waits on; free work reads ready · N to take", () => {
  const work = (id: string, arcId: string, at = "2026-09-20") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status: "proposal" }, at);
  const ready = arc("ready", "active", "2026-09-20"); ready.increments.push(work("r1", "ready"), work("r2", "ready"));
  const queued = arc("queued", "active", "2026-09-20"); queued.increments.push(work("q1", "queued"));
  const claimed = arc("claimed"); claimed.increments.push(work("c1", "claimed", "2026-09-27"));
  const snapshot: BoardSnapshot = { arcs: [ready, claimed, queued, arc("blocked", "active", "2026-09-19")], heldOn: {},
    waits: { blocked: [{ on: "missing", reason: "needs it", forGood: true }], q1: [{ on: "r1", reason: "needs r1", forGood: false }] } };
  const lines = [{ seq: 1, project: "p", session: "s", harness: "codex", source: "hook" as const, kind: "claimed" as const, increment: "c1", reason: "building", at: "2026-09-27T00:40:00Z" }];
  const board = boardView(snapshot, lines, new Date("2026-09-27T00:42:00Z"));
  assert.deepEqual(board.lanes.map(({ id, state }) => [id, state]), [["queued", "queued"], ["blocked", "blocked"], ["claimed", "claimed"], ["ready", "ready"]]);
  const lane = (id: string) => board.lanes.find((lane) => lane.id === id)!;
  assert.equal(lane("ready").chip, "ready · 2 to take");
  assert.deepEqual(lane("queued").waits.map(({ title, arc }) => [title, arc?.title]), [["Build r1", "ready"]]);
});

test("3.3 an idle claim does not hide free work: the lane reads ready with its idle claims beside the chip; only-idle work still reads idle (ADR-0938 D3)", () => {
  const work = (id: string, arcId: string, status: FieldsOf<"increment">["status"] = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status }, "2026-09-20");
  const only = arc("only"); only.increments.push(work("o1", "only", "active"));
  const mixed = arc("mixed"); mixed.increments.push(work("m1", "mixed", "active"), work("m2", "mixed"), work("m3", "mixed"));
  const free = arc("free", "active", "2026-09-20"); free.increments.push(work("f1", "free"));
  const snapshot: BoardSnapshot = { arcs: [free, mixed, only], waits: {}, heldOn: {} };
  const claim = (seq: number, session: string, increment: string) => ({ seq, project: "p", session, harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment, reason: "building", at: "2026-09-27T00:00:00Z" });
  const board = boardView(snapshot, [claim(1, "s1", "o1"), claim(2, "s2", "m1")], new Date("2026-09-27T00:42:00Z"));
  assert.deepEqual(board.lanes.map(({ id, state }) => [id, state]), [["only", "idle"], ["mixed", "ready"], ["free", "ready"]]);
  const lane = (id: string) => board.lanes.find((lane) => lane.id === id)!;
  assert.equal(lane("only").chip, "idle · 42 min");
  assert.equal(lane("only").idle, undefined, "an idle lane's own chip says it; there is no beside-marker");
  assert.equal(lane("mixed").chip, "ready · 2 to take");
  assert.deepEqual(lane("mixed").idle, { chip: "idle · 42 min", agents: [lane("mixed").agents[0]] });
  assert.equal(lane("mixed").idle?.agents[0]?.session, "s2");
  assert.equal(lane("free").idle, undefined);
});
