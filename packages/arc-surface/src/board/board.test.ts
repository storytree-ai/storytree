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
  a.increments = [increment("new", "proposal", "2026-09-27"), increment("failed", "closed", "2026-09-26", "failed"), increment("old", "ready", "2026-09-25"), increment("landed", "closed", "2026-09-24", "landed")];
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
  const idle = arc("idle"); idle.increments = [record("i", "increment", { arc: "idle", title: "Build", objective: "Build", body: "Build", status: "active" })];
  const claimed = arc("claimed"); claimed.increments = [record("j", "increment", { arc: "claimed", title: "Build", objective: "Build", body: "Build", status: "active" })];
  const waiting = arc("waiting"); waiting.questions = [record("q", "question", { arc: "waiting", title: "Question", lifecycle: "open", statement: "Pick", stakes: "Matters", context: "Context", options: "A or B" })];
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
