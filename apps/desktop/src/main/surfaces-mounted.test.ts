/**
 * The frame mounting the arc surface (capability 3 · Arc surface, the arc-surface story): the app's
 * Surfaces menu lists and switches it, and its live board reads the app's database through the
 * app's page reads. These need both the frame and the story, so they live here, where both meet;
 * the board's own behaviour is tested in packages/arc-surface without the frame (ADR-0847).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { openActivityLog } from "@storytree/session-management";
import { pageReads, readSurfaces, setSurface, surfaceOn } from "@storytree/app";
import { arcSmokeProblems, boardView, watchBoard, type BoardState } from "@storytree/arc-surface";
import { arcSurfaces } from "@storytree/arc-surface/surfaces";
import { connect } from "@storytree/library";

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (!check() && Date.now() < end) await delay(10);
  assert.ok(check(), "the board answered within ten seconds");
}

test("3.8 the app's Surfaces menu lists the arc surface as Arcs, with no settings, on until the user switches it off; switched off, it is saved and reads off at the next launch", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-arc-surfaces-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const [arcs] = readSurfaces(arcSurfaces, home);
  assert.deepEqual({ id: arcs!.id, name: arcs!.name, on: arcs!.on, switchable: arcs!.switchable, settings: arcs!.settings }, { id: "arcs", name: "Arcs", on: true, switchable: true, settings: [] });

  setSurface(arcSurfaces, ["arcs", "off"], home);
  assert.equal(surfaceOn(readSurfaces(arcSurfaces, home), "arcs"), false, "a fresh read, as the next launch makes, finds it off");
});

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
    const watcher = watchBoard({ project, reads: { ...reads, idleAfterMs: async () => 30 * 60_000, arcViews: async (p: string) => { if (fail) throw new Error("read unavailable"); return reads.arcViews(p); } },
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
    stop(); await reads.close(); await log.close();
    try { await store.dropProject(project); } finally { await store.close(); }
  }
});
