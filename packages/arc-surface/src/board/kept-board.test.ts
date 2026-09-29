import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Kept } from "../live-reading/kept.js";
import { record } from "../testing/records.js";
import type { BoardSnapshot } from "./board.js";
import { isBoardSnapshot, watchBoard, type BoardState } from "./live-board.js";
import type { BoardReads } from "./reads.js";

const arc = record("arc_1", "arc", { title: "Ship the board", intent: "See the work", endState: "Board shipped" });
const increment = record("inc_1", "increment", { arc: "arc_1", title: "Draw lanes", objective: "Draw", body: "Draw", status: "active" });
const snapshot: BoardSnapshot = { arcs: [{ arc, increments: [increment], questions: [], state: "active" }], waits: {}, heldOn: {} };

function reads(fail: () => boolean): BoardReads {
  return {
    changesSince: async () => { if (fail()) throw new Error("timeout exceeded"); return { changes: [], cursor: 1 }; },
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => ({ stories: [], arcs: [{ id: "arc_1" }] }) as never,
    arcView: async () => snapshot.arcs[0]!,
    waitHolds: async () => [],
    heldOnQuestion: async () => [],
  };
}
function kept(start?: BoardSnapshot): Kept<BoardSnapshot> & { written: BoardSnapshot[] } {
  const written: BoardSnapshot[] = [];
  return { written, read: () => start, write: (value) => { written.push(value); } };
}
const timers = { now: () => Date.parse("2026-09-29T10:00:00Z"), every: () => () => {} };
async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 5_000;
  while (!check() && Date.now() < end) await delay(5);
  assert.ok(check());
}

test("the board draws its kept last state at once, marked refreshing, and keeps the fresh one when the read lands", async () => {
  const states: BoardState[] = [];
  const store = kept(snapshot);
  const watcher = watchBoard({ project: "p", reads: reads(() => false), timers, kept: store, onState: (state) => states.push(state) });
  try {
    assert.equal(states[0]?.status, "refreshing");
    assert.deepEqual(states[0]?.board?.lanes.map(({ id }) => id), ["arc_1"]);
    await until(() => states.at(-1)?.status === "ready");
    assert.deepEqual(store.written.at(-1)?.arcs.map(({ arc }) => arc.id), ["arc_1"]);
  } finally { watcher.stop(); }
});

test("a refresh that fails keeps the kept board on show with the error", async () => {
  const states: BoardState[] = [];
  const watcher = watchBoard({ project: "p", reads: reads(() => true), timers, kept: kept(snapshot), onState: (state) => states.push(state) });
  try {
    await until(() => states.at(-1)?.status === "error");
    assert.match(states.at(-1)?.error ?? "", /timeout exceeded/);
    assert.deepEqual(states.at(-1)?.board?.lanes.map(({ id }) => id), ["arc_1"]);
  } finally { watcher.stop(); }
});

test("nothing kept is loading as before; a kept value of another shape is not a board", () => {
  const states: BoardState[] = [];
  watchBoard({ project: "p", reads: reads(() => true), timers, kept: kept(), onState: (state) => states.push(state) }).stop();
  assert.equal(states[0]?.status, "loading");
  assert.equal(isBoardSnapshot(snapshot), true);
  assert.equal(isBoardSnapshot({ arcs: [{}], waits: {} }), false);
  assert.equal(isBoardSnapshot([arc]), false);
});
