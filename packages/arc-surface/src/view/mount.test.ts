import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { Window } from "happy-dom";
import type { BoardReads } from "../board/reads.js";
import { record } from "../testing/records.js";
import { mountArcSurface } from "./index.js";

// happy-dom proves the mounted controls and focus calls; browser captures prove geometry
// and native keyboard activation.
test("3.1 clicking Arcs opens a reading drawer; Escape and Close return focus to the bar", async (t) => {
  const page = new Window({ url: "https://storytree.test" });
  const document = page.document as unknown as Document;
  let surface: ReturnType<typeof mountArcSurface> | undefined;
  const globals = { document: page.document, HTMLElement: page.HTMLElement, localStorage: page.localStorage };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(async () => {
    surface?.stop();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await page.happyDOM.abort();
  });
  const arc = record("arc_1", "arc", { title: "Ship the board", intent: "See the work", endState: "Board shipped" });
  let answer!: (arcs: Awaited<ReturnType<BoardReads["arcViews"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<BoardReads["arcViews"]>>>((resolve) => { answer = resolve; });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    arcViews: () => pending,
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const ticks = new Map<number, () => void>();
  surface = mountArcSurface(document.body, {
    project: "p", reads,
    timers: { now: () => Date.parse("2026-10-02T00:00:00Z"), every: (ms, tick) => {
      ticks.set(ms, tick);
      return () => { ticks.delete(ms); };
    } },
  });
  const launch = document.querySelector<HTMLButtonElement>("[data-open-arcs]")!;
  const drawer = document.querySelector<HTMLElement>("#arc-drawer")!;
  const close = document.querySelector<HTMLButtonElement>("[data-close-arcs]")!;
  assert.equal(drawer.hidden, true);
  assert.equal(launch.getAttribute("aria-expanded"), "false");

  launch.click();
  assert.equal(drawer.hidden, false);
  assert.equal(launch.hidden, true);
  assert.equal(launch.getAttribute("aria-expanded"), "true");
  assert.equal(page.document.activeElement, close);
  assert.equal(drawer.querySelector("[role=status]")?.textContent, "Reading arcs…");
  answer([{ arc, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(drawer.dataset.arcState, "ready");
  assert.match(drawer.querySelector('[data-arc-select="arc_1"]')?.textContent ?? "", /Ship the board/);

  page.document.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(drawer.hidden, true);
  assert.equal(launch.hidden, false);
  assert.equal(launch.getAttribute("aria-expanded"), "false");
  assert.equal(page.document.activeElement, launch);
  assert.equal(ticks.size, 0);

  reads.arcViews = async () => { throw new Error("Library unavailable"); };
  launch.click();
  await settle();
  assert.equal(drawer.hidden, false);
  assert.equal(page.document.activeElement, close);
  assert.match(drawer.querySelector('[role="alert"]')?.textContent ?? "", /Arcs could not be read: Library unavailable/);
  assert.ok(drawer.querySelector('[data-arc-select="arc_1"]'), "a failed refresh keeps the last board visible");
  close.click();
  assert.equal(drawer.hidden, true);
  assert.equal(page.document.activeElement, launch);
  assert.equal(ticks.size, 0);
  surface.stop();
  assert.equal(page.document.body.childElementCount, 0);
});
