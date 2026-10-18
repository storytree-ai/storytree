import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { DayWindow, Line } from "@storytree/library";
import { ASK_EVERY_MS, CLOCK_EVERY_MS, readBoard, watchBoard } from "../index.js";
import type { BoardSnapshot } from "./board.js";
import type { BoardState } from "./live-board.js";
import type { BoardReads } from "./reads.js";
import { record } from "../testing/records.js";

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (!check() && Date.now() < end) await delay(10);
  assert.ok(check(), "the board answered within ten seconds");
}

test("3.5 the public watched board ages a holder at the user's idle-after setting without new lines", async () => {
  const arc = record("arc_1", "arc", { title: "Ship the board", intent: "See the work", endState: "Board shipped" });
  const increment = record("inc_1", "increment", { arc: "arc_1", title: "Draw lanes", objective: "Draw", body: "Draw", status: "active" });
  const start = Date.parse("2026-09-29T10:00:00Z");
  const lines: Line[] = [
    { kind: "session-started", source: "hook", harness: "codex", session: "s", seq: 1, at: new Date(start).toISOString(), project: "p" },
    { kind: "claimed", source: "tool", harness: "codex", session: "s", increment: "inc_1", reason: "draw the lanes", seq: 2, at: new Date(start).toISOString(), project: "p" },
  ];
  let served = false;
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 1 }),
    linesSince: async () => { const answer = served ? [] : lines; served = true; return { lines: answer, cursor: 2 }; },
    boardArcs: async () => [{ arc, increments: [increment], questions: [], state: "active" }], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
    idleAfterMs: async () => 10 * 60_000,
  };
  let now = start + 5 * 60_000;
  let state: BoardState | undefined;
  const ticks = new Map<number, () => void>();
  const watcher = watchBoard({ project: "p", reads, timers: { now: () => now, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
    onState: (next) => { state = next; } });
  try {
    await until(() => state?.board?.lanes[0]?.agents.length === 1);
    assert.equal(state?.board?.lanes[0]?.state, "in-progress");
    now = start + 15 * 60_000;
    ticks.get(CLOCK_EVERY_MS)!();
    assert.equal(state?.board?.lanes[0]?.state, "idle");
    assert.equal(state?.board?.lanes[0]?.chip, "in progress · idle 15 min");
  } finally {
    watcher.stop();
  }
});

test("3.9 the open board re-reads the work only when its news holds an arc, increment or question change: lines alone, or other records, redraw it from what it has; its first news always reads", async () => {
  const arc = record("arc_1", "arc", { title: "Ship the board", intent: "See the work", endState: "Board shipped" });
  const increment = record("inc_1", "increment", { arc: "arc_1", title: "Draw lanes", objective: "Draw", body: "Draw", status: "active" });
  const start = Date.parse("2026-09-29T10:00:00Z");
  let seq = 0;
  const line = (kind: "session-started" | "claimed"): Line => (kind === "claimed"
    ? { kind, source: "tool", harness: "codex", session: "s", increment: "inc_1", reason: "draw the lanes", seq: ++seq, at: new Date(start).toISOString(), project: "p" }
    : { kind, source: "hook", harness: "codex", session: "s", seq: ++seq, at: new Date(start).toISOString(), project: "p" });
  const change = (type: string, recordId: string) => ({ seq: ++seq, recordId, type, action: "updated" as const, record: record(recordId, type as never, {} as never) });
  // What each ask finds new: the first everything, then lines alone, a health change, and an increment change.
  const asks = [
    { lines: [line("session-started")], changes: [change("arc", "arc_1")] },
    { lines: [line("claimed")], changes: [] },
    { lines: [], changes: [change("health", "health_contract_1_verified")] },
    { lines: [], changes: [change("increment", "inc_1")] },
  ];
  let ask = -1;
  const asked = { boardArcs: 0, holds: 0 };
  const reads: BoardReads = {
    // An ask starts its changes read first, then its lines read.
    changesSince: async () => { ask++; return { changes: asks[ask]?.changes ?? [], cursor: seq }; },
    linesSince: async () => ({ lines: asks[ask]?.lines ?? [], cursor: seq }),
    boardArcs: async () => { asked.boardArcs++; return [{ arc, increments: [increment], questions: [], state: "active" }]; }, closedArcs: async () => [],
    holds: async () => { asked.holds++; return { waits: {}, heldOn: {} }; },
  };
  let state: BoardState | undefined;
  let drawn = 0;
  const ticks = new Map<number, () => void>();
  const watcher = watchBoard({ project: "p", reads, timers: { now: () => start + 60_000, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
    onState: (next) => { state = next; drawn++; } });
  try {
    await until(() => state?.status === "ready");
    assert.deepEqual(asked, { boardArcs: 1, holds: 1 }, "the first news reads the work");

    let before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => drawn > before);
    assert.equal(state?.board?.lanes[0]?.agents.length, 1, "the new claim is drawn");
    assert.deepEqual(asked, { boardArcs: 1, holds: 1 }, "lines alone read no work");

    before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => drawn > before);
    assert.deepEqual(asked, { boardArcs: 1, holds: 1 }, "a health change reads no work");

    before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => asked.boardArcs === 2 && drawn > before);
    assert.deepEqual(asked, { boardArcs: 2, holds: 2 }, "an increment change reads the work again");
  } finally {
    watcher.stop();
  }
});

test("3.12 the board reads live arcs and those closed yesterday and today; the Closed tab's Today and Yesterday draw from that, and 7 days or a From–to asks the library for its window when it changes, the kept board holding only the routine read", async () => {
  const closedOn = (id: string, day: string) => ({ arc: record(id, "arc", { title: id, intent: "See the work", endState: "Shipped" }), increments: [], questions: [], state: "closed" as const, closed: day });
  const live = { arc: record("arc_live", "arc", { title: "live", intent: "See the work", endState: "Shipped" }), increments: [], questions: [], state: "active" as const };
  const asked: { board: DayWindow[]; closed: DayWindow[] } = { board: [], closed: [] };
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 1 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async (_project, window) => { asked.board.push(window); return [live, closedOn("arc_today", "2026-10-19"), closedOn("arc_yesterday", "2026-10-18")]; },
    closedArcs: async (_project, window) => { asked.closed.push(window); return [closedOn("arc_old", "2026-10-14")]; },
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const written: BoardSnapshot[] = [];
  let state: BoardState | undefined;
  const now = new Date(2026, 9, 19, 12).getTime(); // noon on the 19th, local time
  const watcher = watchBoard({ project: "p", reads, timers: { now: () => now, every: () => () => {} }, kept: { read: () => undefined, write: (value) => { written.push(value); } },
    onState: (next) => { state = next; } });
  const lanes = () => state?.board?.lanes.map(({ id }) => id);
  try {
    await until(() => state?.status === "ready");
    assert.deepEqual(asked.board, [{ from: "2026-10-18", to: "2026-10-20" }], "the routine read asks live arcs and those closed yesterday and today");
    assert.deepEqual(lanes(), ["arc_live"]);
    assert.deepEqual(written.at(-1)?.arcs.map(({ arc }) => arc.id), ["arc_live", "arc_today", "arc_yesterday"], "the kept board holds the routine read alone");

    watcher.setScope("closed");
    assert.deepEqual(lanes(), ["arc_today"], "Today is the closed tab's first range, drawn from the routine read");
    assert.deepEqual(state?.board?.closed, { range: { preset: "today" }, from: "2026-10-19", to: "2026-10-19", reading: false });
    watcher.setClosedRange({ preset: "yesterday" });
    assert.deepEqual(lanes(), ["arc_yesterday"]);
    assert.deepEqual(asked.closed, [], "today and yesterday ask nothing more");

    watcher.setClosedRange({ preset: "week" });
    assert.equal(state?.board?.closed?.reading, true, "a wider range reads while it is asked");
    await until(() => state?.board?.closed?.reading === false);
    assert.deepEqual(asked.closed, [{ from: "2026-10-13", to: "2026-10-20" }], "7 days asks the library for its window");
    assert.deepEqual(lanes(), ["arc_old"]);

    watcher.setClosedRange({ from: "2026-10-01", to: "2026-10-05" });
    await until(() => asked.closed.length === 2 && state?.board?.closed?.reading === false);
    assert.deepEqual(asked.closed[1], { from: "2026-10-01", to: "2026-10-06" }, "a From–to asks its days, the last one included");
    assert.equal(written.length, 1, "a range read is never kept");
  } finally {
    watcher.stop();
  }
});

test("3.9 the board carries the library's waits for the owner or an event into its snapshot, and none is an empty reading (ADR-0938)", async () => {
  const reads = (waitsFor?: Record<string, { releaser: "owner"; note: string; holds: boolean }[]>) => ({
    changesSince: async () => ({ changes: [], cursor: 1 }), linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => ({ stories: [], arcs: [] }) as never, boardArcs: async () => [], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {}, ...(waitsFor ? { waitsFor } : {}) }),
  });
  const wait = { releaser: "owner" as const, note: "approve the spend", holds: true };
  assert.deepEqual((await readBoard("p", reads({ i1: [wait] }))).waitsFor, { i1: [wait] });
  assert.deepEqual((await readBoard("p", reads())).waitsFor, {}, "a library built before waits with a note gives none");
});
