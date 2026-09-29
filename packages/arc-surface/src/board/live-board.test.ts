import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { openActivityLog, type Line } from "@storytree/agent-link";
import { pageReads } from "@storytree/app";
import { connect } from "@storytree/library";
import pg from "pg";
import { watchBoard, type BoardState } from "./live-board.js";
import { boardView } from "./board.js";
import { renderBoard } from "../view/render.js";
import { arcSmokeProblems } from "./smoke.js";
import type { BoardReads } from "./reads.js";
import { record } from "../testing/records.js";

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (!check() && Date.now() < end) await delay(10);
  assert.ok(check(), "the board answered within ten seconds");
}

test("3.1, 3.4–3.6 the open overlay reads the app's database, retries a failed read, sees a claim on its next poll, ages without new lines and reports what it drew", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "run through pnpm test, which supplies Postgres");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const store = await connect({ url });
  const log = await openActivityLog(url);
  const reads = pageReads({ storytree: store });
  let stop = () => {};
  try {
    const library = await store.openProject(project);
    const arc = await library.createArc({ title: "Ship the board", intent: "See the work", endState: "Board shipped" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Draw lanes", objective: "Draw", body: "Draw" });
    let now = Date.now();
    let state: BoardState | undefined;
    let fail = true;
    const ticks = new Map<number, () => void>();
    const watcher = watchBoard({ project, reads: { ...reads, arcView: async (p: string, id: string) => { if (fail) throw new Error("read unavailable"); return reads.arcView(p, id); } },
      timers: { now: () => now, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } }, onState: (next) => { state = next; } });
    stop = watcher.stop;
    assert.equal(state?.status, "loading");
    await until(() => state?.status === "error");
    assert.match(state?.error ?? "", /read unavailable/);
    fail = false;
    ticks.get(2_000)!();
    await until(() => state?.status === "ready");
    const history = await library.history();
    await log.append(project, { kind: "session-started", source: "hook", harness: "codex", session: "s" });
    await log.append(project, { kind: "claimed", source: "tool", harness: "codex", session: "s", increment: increment.id, reason: "draw the lanes" });
    ticks.get(2_000)!();
    await until(() => state?.board?.lanes[0]?.agents.length === 1);
    assert.match(renderBoard(state!.board!, arc.id), /Codex/);
    now += 42 * 60_000;
    ticks.get(60_000)!();
    assert.equal(state?.board?.lanes[0]?.state, "idle");
    const board = state!.board!;
    const drawn = { arcs: [arc.id], increments: [increment.id], holders: [{ work: increment.id, session: "s", label: "Codex" }] };
    assert.deepEqual(arcSmokeProblems(board, drawn), []);
    assert.ok(arcSmokeProblems(board, { ...drawn, holders: [] }).length > 0, "the smoke check requires the held agent");
    assert.ok(arcSmokeProblems(board, { ...drawn, increments: [] }).length > 0, "the smoke check requires every increment");
    assert.deepEqual(await library.history(), history, "all overlay actions left the library unchanged");
    stop();
    assert.equal(ticks.size, 0, "closing stops both timers");
    assert.equal(boardView({ arcs: [], waits: {}, heldOn: {} }, [], new Date()).lanes.length, 0);
  } finally {
    stop(); await reads.close(); await log.close(); await store.close();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try { await client.query(`DROP DATABASE IF EXISTS "storytree_${project}" WITH (FORCE)`); } finally { await client.end(); }
  }
});

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
    projectTree: async () => ({ stories: [], arcs: [{ id: "arc_1" }] }) as never,
    arcView: async () => ({ arc, increments: [increment], questions: [], state: "active" }),
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
