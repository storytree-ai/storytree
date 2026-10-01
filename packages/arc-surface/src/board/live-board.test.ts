import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Line } from "@storytree/agent-link";
import { readBoard, watchBoard } from "../index.js";
import type { BoardState } from "./live-board.js";
import type { BoardReads } from "./reads.js";
import { record } from "../testing/records.js";

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (!check() && Date.now() < end) await delay(10);
  assert.ok(check(), "the board answered within ten seconds");
}

test("the watched board reads a holder idle at the user's idle-after setting, not a fixed half hour", async () => {
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
  let now = start + 15 * 60_000;
  let state: BoardState | undefined;
  const ticks = new Map<number, () => void>();
  const watcher = watchBoard({ project: "p", reads, timers: { now: () => now, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
    onState: (next) => { state = next; } });
  try {
    await until(() => state?.board?.lanes[0]?.agents.length === 1);
    assert.equal(state?.board?.lanes[0]?.state, "idle");
    assert.equal(state?.board?.lanes[0]?.chip, "idle · 15 min");
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
