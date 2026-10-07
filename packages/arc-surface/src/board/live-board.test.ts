import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Line } from "@storytree/agent-link";
import { ASK_EVERY_MS, CLOCK_EVERY_MS, readBoard, watchBoard } from "../index.js";
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
    arcViews: async () => [{ arc, increments: [increment], questions: [], state: "active" }],
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
    assert.equal(state?.board?.lanes[0]?.state, "claimed");
    now = start + 15 * 60_000;
    ticks.get(CLOCK_EVERY_MS)!();
    assert.equal(state?.board?.lanes[0]?.state, "idle");
    assert.equal(state?.board?.lanes[0]?.chip, "idle · 15 min");
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
  const asked = { arcViews: 0, holds: 0 };
  const reads: BoardReads = {
    // An ask starts its changes read first, then its lines read.
    changesSince: async () => { ask++; return { changes: asks[ask]?.changes ?? [], cursor: seq }; },
    linesSince: async () => ({ lines: asks[ask]?.lines ?? [], cursor: seq }),
    arcViews: async () => { asked.arcViews++; return [{ arc, increments: [increment], questions: [], state: "active" }]; },
    holds: async () => { asked.holds++; return { waits: {}, heldOn: {} }; },
  };
  let state: BoardState | undefined;
  let drawn = 0;
  const ticks = new Map<number, () => void>();
  const watcher = watchBoard({ project: "p", reads, timers: { now: () => start + 60_000, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
    onState: (next) => { state = next; drawn++; } });
  try {
    await until(() => state?.status === "ready");
    assert.deepEqual(asked, { arcViews: 1, holds: 1 }, "the first news reads the work");

    let before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => drawn > before);
    assert.equal(state?.board?.lanes[0]?.agents.length, 1, "the new claim is drawn");
    assert.deepEqual(asked, { arcViews: 1, holds: 1 }, "lines alone read no work");

    before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => drawn > before);
    assert.deepEqual(asked, { arcViews: 1, holds: 1 }, "a health change reads no work");

    before = drawn;
    ticks.get(ASK_EVERY_MS)!();
    await until(() => asked.arcViews === 2 && drawn > before);
    assert.deepEqual(asked, { arcViews: 2, holds: 2 }, "an increment change reads the work again");
  } finally {
    watcher.stop();
  }
});

test("the board reads every arc's view in one ask, however many arcs the project has (ADR-0836 D3)", async () => {
  const arcs = ["arc_1", "arc_2", "arc_3"].map((id) => record(id, "arc", { title: id, intent: "See the work", endState: "Shipped" }));
  const asked = { arcView: 0, arcViews: 0 };
  const reads = {
    changesSince: async () => ({ changes: [], cursor: 1 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => ({ stories: [], arcs }) as never,
    arcView: async (_project: string, id: string) => { asked.arcView++; return { arc: arcs.find((arc) => arc.id === id)!, increments: [], questions: [], state: "active" as const }; },
    arcViews: async () => { asked.arcViews++; return arcs.map((arc) => ({ arc, increments: [], questions: [], state: "active" as const })); },
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const snapshot = await readBoard("p", reads);
  assert.deepEqual(snapshot.arcs.map(({ arc }) => arc.id), ["arc_1", "arc_2", "arc_3"]);
  assert.deepEqual(asked, { arcView: 0, arcViews: 1 });
});

test("3.9 the board carries the library's waits for the owner or an event into its snapshot, and none is an empty reading (ADR-0938)", async () => {
  const reads = (waitsFor?: Record<string, { releaser: "owner"; note: string; holds: boolean }[]>) => ({
    changesSince: async () => ({ changes: [], cursor: 1 }), linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => ({ stories: [], arcs: [] }) as never, arcView: async () => undefined as never, arcViews: async () => [],
    holds: async () => ({ waits: {}, heldOn: {}, ...(waitsFor ? { waitsFor } : {}) }),
  });
  const wait = { releaser: "owner" as const, note: "approve the spend", holds: true };
  assert.deepEqual((await readBoard("p", reads({ i1: [wait] }))).waitsFor, { i1: [wait] });
  assert.deepEqual((await readBoard("p", reads())).waitsFor, {}, "a library built before waits with a note gives none");
});
