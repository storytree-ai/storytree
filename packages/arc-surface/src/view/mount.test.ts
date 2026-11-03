import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { Window } from "happy-dom";
import type { BoardReads } from "../board/reads.js";
import { record } from "../testing/records.js";
import { mountArcSurface } from "./index.js";

// happy-dom proves the mounted controls and focus calls; browser captures prove geometry
// and native keyboard activation.
test("3.1 · the arcs fill the rail's tab and keep reading; an arc's card opens only on its row's click, and its row, Close or Escape closes it, returning focus to the row", async (t) => {
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
  const other = record("arc_2", "arc", { title: "Tidy the docs", intent: "Read easily", endState: "Docs tidy" });
  const asking = (title: string) => record(`q_${title}`, "question", { arc: "arc_1", title, lifecycle: "open", statement: "s", stakes: "s", context: "c", options: "o" });
  let answer!: (arcs: Awaited<ReturnType<BoardReads["boardArcs"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<BoardReads["boardArcs"]>>>((resolve) => { answer = resolve; });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: () => pending, closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const ticks = new Map<number, () => void>();
  const waiting: number[] = [];
  const tab = document.createElement("div");
  document.body.append(tab);
  surface = mountArcSurface(tab, {
    project: "p", reads, onWaiting: (count) => { waiting.push(count); },
    timers: { now: () => Date.parse("2026-10-02T00:00:00Z"), every: (ms, tick) => {
      ticks.set(ms, tick);
      return () => { ticks.delete(ms); };
    } },
  });
  const rail = tab.querySelector<HTMLElement>(".arc-rail")!;
  const card = tab.querySelector<HTMLElement>(".arc-card")!;
  assert.equal(rail.querySelector("[role=status]")?.textContent, "Reading arcs…", "it reads as soon as it is mounted, with nothing to press");
  answer([{ arc, increments: [], questions: [asking("Which vendor?"), asking("Which day?")], state: "active" }, { arc: other, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(rail.dataset.arcState, "ready");
  const row = (id: string) => rail.querySelector<HTMLButtonElement>(`[data-arc-select="${id}"]`)!;
  assert.match(row("arc_1").textContent ?? "", /Ship the board/);
  assert.equal(card.hidden, true, "no arc's card opens on its own");
  assert.deepEqual(waiting, [2], "the Arcs tab's badge hears what waits on the owner");

  row("arc_1").click();
  assert.equal(card.hidden, false);
  assert.match(card.querySelector(".arc-briefing h3")?.textContent ?? "", /Ship the board/);
  assert.equal(row("arc_1").getAttribute("aria-pressed"), "true");
  row("arc_2").click();
  assert.match(card.querySelector(".arc-briefing h3")?.textContent ?? "", /Tidy the docs/, "another row's click shows its arc in the card");
  row("arc_2").click();
  assert.equal(card.hidden, true, "the open arc's row closes its card");
  assert.equal(page.document.activeElement, row("arc_2"));

  row("arc_1").click();
  page.document.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(card.hidden, true);
  assert.equal(page.document.activeElement, row("arc_1"));
  row("arc_1").click();
  card.querySelector<HTMLButtonElement>("[data-close-card]")!.click();
  assert.equal(card.hidden, true);
  assert.equal(page.document.activeElement, row("arc_1"));
  assert.equal(row("arc_1").getAttribute("aria-pressed"), "false");

  // An arc changed, so the board is read again, and that read fails.
  reads.boardArcs = async () => { throw new Error("Library unavailable"); };
  reads.changesSince = async () => ({ changes: [{ seq: 1, recordId: "arc_1", type: "arc", action: "updated" as const, record: arc }], cursor: 1 });
  for (const tick of [...ticks.values()]) tick();
  await settle();
  assert.match(rail.querySelector('[role="alert"]')?.textContent ?? "", /Arcs could not be read: Library unavailable/);
  assert.ok(row("arc_1"), "a failed refresh keeps the last board visible");
  surface.stop();
  assert.equal(tab.childElementCount, 0);
  assert.equal(ticks.size, 0, "stopped, it reads no more");
});

test("3.9 a new mount draws the kept board refreshing until its own read lands", async (t) => {
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
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [{ arc, increments: [], questions: [], state: "active" }], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const mount = () => mountArcSurface(document.body, { project: "p", reads, timers: { now: () => Date.parse("2026-10-19T00:00:00Z"), every: () => () => {} } });
  const rail = () => document.querySelector<HTMLElement>(".arc-rail")!;
  surface = mount();
  await settle();
  assert.equal(rail().dataset.arcState, "ready");

  surface.stop();
  reads.boardArcs = () => new Promise(() => {});
  surface = mount();
  assert.equal(rail().dataset.arcState, "refreshing", "a new mount's kept board is not yet fresh");
  assert.ok(rail().querySelector('[data-arc-select="arc_1"]'), "and it is drawn while the read is out");
});

test("3.12 the Closed tab's range bar: 7 days and a From–to ask the library for their days and draw what it answers", async (t) => {
  const page = new Window({ url: "https://storytree.test" });
  const document = page.document as unknown as Document;
  const globals = { document: page.document, HTMLElement: page.HTMLElement, HTMLInputElement: page.HTMLInputElement, localStorage: page.localStorage };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let surface: ReturnType<typeof mountArcSurface> | undefined;
  t.after(async () => {
    surface?.stop();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await page.happyDOM.abort();
  });
  const closedOn = (id: string, day: string) => ({ arc: record(id, "arc", { title: id, intent: "See the work", endState: "Shipped" }), increments: [], questions: [], state: "closed" as const, closed: day });
  const asked: { from: string; to: string }[] = [];
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [closedOn("arc_today", "2026-10-19")],
    closedArcs: async (_project, window) => { asked.push(window); return [closedOn(`arc_${window.from}`, window.from)]; },
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  surface = mountArcSurface(document.body, { project: "p", reads, timers: { now: () => new Date(2026, 9, 19, 12).getTime(), every: () => () => {} } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-arc-scope="closed"]')!.click();
  const lanes = () => [...document.querySelectorAll<HTMLElement>(".arc-row[data-arc-id]")].map((row) => row.dataset.arcId);
  assert.deepEqual(lanes(), ["arc_today"], "Today, from the board's own read");
  assert.equal(document.querySelector('[data-closed-range="today"]')?.getAttribute("aria-pressed"), "true");

  document.querySelector<HTMLButtonElement>('[data-closed-range="week"]')!.click();
  await settle();
  assert.deepEqual(asked, [{ from: "2026-10-13", to: "2026-10-20" }]);
  assert.deepEqual(lanes(), ["arc_2026-10-13"]);

  const from = document.querySelector<HTMLInputElement>("[data-closed-from]")!;
  from.value = "2026-10-01";
  from.dispatchEvent(new page.Event("change", { bubbles: true }) as unknown as Event);
  await settle();
  assert.deepEqual(asked[1], { from: "2026-10-01", to: "2026-10-20" }, "a From day keeps the shown To");
  assert.deepEqual(lanes(), ["arc_2026-10-01"]);
});

test("3.18 · the mounted surface says once when it first draws a freshly read board", async (t) => {
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
  let answer!: (arcs: Awaited<ReturnType<BoardReads["boardArcs"]>>) => void;
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: () => new Promise((resolve) => { answer = resolve; }), closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  let fresh = 0;
  surface = mountArcSurface(document.body, {
    project: "p", reads, onFreshDraw: () => { fresh += 1; },
    timers: { now: () => Date.parse("2026-10-02T00:00:00Z"), every: () => () => {} },
  });
  await settle();
  assert.equal(fresh, 0, "nothing is said while the first read is still out");
  answer([{ arc, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(fresh, 1);

  document.querySelector<HTMLButtonElement>('[data-arc-scope="parked"]')!.click();
  answer([{ arc, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(document.querySelector<HTMLElement>(".arc-rail")!.dataset.arcState, "ready");
  assert.equal(fresh, 1, "a later fresh read is not the first fresh draw");
});

test("3.20 · the picked arc's title stays selectable across a refresh that changes nothing, and its copy button puts the title on the clipboard as plain text", async (t) => {
  const page = new Window({ url: "https://storytree.test" });
  const document = page.document as unknown as Document;
  let surface: ReturnType<typeof mountArcSurface> | undefined;
  const copied: string[] = [];
  const navigator = { clipboard: { writeText: async (text: string) => { copied.push(text); } } };
  const globals = { document: page.document, HTMLElement: page.HTMLElement, localStorage: page.localStorage, navigator };
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
  const arc = record("arc_1", "arc", { title: "Stability & testing <rigour>", intent: "See the work", endState: "Board shipped" });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [{ arc, increments: [], questions: [], state: "active" }], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const ticks = new Map<number, () => void>();
  surface = mountArcSurface(document.body, {
    project: "p", reads,
    timers: { now: () => Date.parse("2026-10-02T00:00:00Z"), every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
  });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-arc-select="arc_1"]')!.click();
  const heading = document.querySelector<HTMLElement>(".arc-briefing h3")!;
  assert.match(heading.textContent ?? "", /Stability & testing <rigour>/);
  for (const tick of [...ticks.values()]) tick();
  await settle();
  assert.ok(heading.isConnected, "a refresh that changes nothing keeps the heading's node, so a selection in it holds");

  document.querySelector<HTMLButtonElement>("[data-copy-arc-title]")!.click();
  await settle();
  assert.deepEqual(copied, ["Stability & testing <rigour>"]);
  assert.equal(document.querySelector("[data-copy-arc-title]")?.textContent, "Copied");
});
