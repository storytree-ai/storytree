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
  let answer!: (arcs: Awaited<ReturnType<BoardReads["boardArcs"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<BoardReads["boardArcs"]>>>((resolve) => { answer = resolve; });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: () => pending, closedArcs: async () => [],
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

  reads.boardArcs = async () => { throw new Error("Library unavailable"); };
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

// The drawer's height at each size is the stylesheet's, measured in Chromium.
test("3.10 · Expand fills the window and reads Restore, which returns the drawer; the size is kept when it is closed, opened and mounted again", async (t) => {
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
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const mount = (project: string) => mountArcSurface(document.body, { project, reads, timers: { now: () => Date.parse("2026-10-11T00:00:00Z"), every: () => () => {} } });
  const drawer = () => document.querySelector<HTMLElement>("#arc-drawer")!;
  const size = () => drawer().querySelector<HTMLButtonElement>("[data-expand-arcs]")!;
  const launch = () => document.querySelector<HTMLButtonElement>("[data-open-arcs]")!;

  surface = mount("p");
  launch().click();
  assert.equal(drawer().dataset.expanded, "false", "a drawer opens at half height until it is expanded");
  assert.equal(size().textContent, "Expand");
  size().focus();
  size().click();
  assert.equal(drawer().dataset.expanded, "true");
  assert.equal(size().textContent, "Restore", "the control names what a press gives");
  assert.equal(page.document.activeElement, size(), "the control keeps the focus");

  page.document.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(drawer().hidden, true, "Escape closes an expanded drawer");
  assert.equal(page.document.activeElement, launch());
  launch().click();
  assert.equal(drawer().dataset.expanded, "true", "closed and opened again, it is still expanded");

  surface.stop();
  surface = mount("p");
  assert.equal(drawer().hidden, false);
  assert.equal(drawer().dataset.expanded, "true", "a new launch opens at the kept size");
  assert.equal(size().textContent, "Restore");
  size().click();
  assert.equal(drawer().dataset.expanded, "false");
  assert.equal(size().textContent, "Expand");

  surface.stop();
  surface = mount("p");
  assert.equal(drawer().dataset.expanded, "false", "the restored size is kept too");
  surface.stop();
  surface = mount("other");
  launch().click();
  size().click();
  surface.stop();
  surface = mount("p");
  assert.equal(drawer().dataset.expanded, "false", "another project's choice leaves this one's alone");
});

test("3.9 a drawer reopened on the same page draws its last board ready while it reads the work again; a new mount draws the kept board refreshing", async (t) => {
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
  const drawer = () => document.querySelector<HTMLElement>("#arc-drawer")!;
  const launch = () => document.querySelector<HTMLButtonElement>("[data-open-arcs]")!;
  surface = mount();
  launch().click();
  await settle();
  assert.equal(drawer().dataset.arcState, "ready");
  page.document.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Escape" }));

  reads.boardArcs = () => new Promise(() => {});
  launch().click();
  assert.equal(drawer().dataset.arcState, "ready", "reopened, the board read fresh on this page is not refreshing");
  assert.equal(drawer().querySelector("[role=status]")?.textContent, "");
  assert.ok(drawer().querySelector('[data-arc-select="arc_1"]'));

  surface.stop();
  surface = mount();
  assert.equal(drawer().dataset.arcState, "refreshing", "a new page's kept board is not yet fresh");
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
  document.querySelector<HTMLButtonElement>("[data-open-arcs]")!.click();
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

test("3.18 · the mounted drawer says once when it first draws a freshly read board", async (t) => {
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
  const launch = document.querySelector<HTMLButtonElement>("[data-open-arcs]")!;
  launch.click();
  await settle();
  assert.equal(fresh, 0, "nothing is said while the first read is still out");
  answer([{ arc, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(fresh, 1);

  surface.close();
  launch.click();
  answer([{ arc, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(document.querySelector<HTMLElement>("#arc-drawer")!.dataset.arcState, "ready");
  assert.equal(fresh, 1, "a reopened drawer's read is not the first fresh draw");
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
  document.querySelector<HTMLButtonElement>("[data-open-arcs]")!.click();
  await settle();
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
