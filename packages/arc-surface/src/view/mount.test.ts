import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { Window } from "happy-dom";
import type { Line } from "@storytree/library";
import { waitUntil } from "@storytree/test-waits";
import type { BoardReads } from "../board/reads.js";
import { record } from "../testing/records.js";
import { mountArcSurface } from "./index.js";

// happy-dom proves the mounted controls and focus calls; browser captures prove geometry
// and native keyboard activation.
test("3.1 · the arcs fill the rail's tab and keep reading; an arc's row click selects it and opens its expansion under the row, the selected row's click closes it, and nothing opens over the map", async (t) => {
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
  assert.equal(rail.querySelector("[role=status]")?.textContent, "Reading arcs…", "it reads as soon as it is mounted, with nothing to press");
  answer([{ arc, increments: [], questions: [asking("Which vendor?"), asking("Which day?")], state: "active" }, { arc: other, increments: [], questions: [], state: "active" }]);
  await settle();
  assert.equal(rail.dataset.arcState, "ready");
  const row = (id: string) => rail.querySelector<HTMLButtonElement>(`[data-arc-select="${id}"]`)!;
  assert.match(row("arc_1").textContent ?? "", /Ship the board/);
  assert.ok(rail.querySelector(".arc-under") === null, "no arc opens on its own");
  assert.deepEqual(waiting, [2], "the Arcs tab's badge hears what waits on the owner");

  const under = (id: string) => rail.querySelector<HTMLElement>(`.arc-row[data-arc-id="${id}"] .arc-under`);
  row("arc_1").click();
  assert.match(under("arc_1")?.textContent ?? "", /See the work.*Which vendor\?/s, "its intent and questions open under its row");
  assert.equal(row("arc_1").getAttribute("aria-pressed"), "true");
  row("arc_2").click();
  assert.equal(row("arc_2").getAttribute("aria-pressed"), "true", "another row's click selects that arc");
  assert.match(under("arc_2")?.textContent ?? "", /Read easily/);
  row("arc_2").click();
  assert.equal(row("arc_2").getAttribute("aria-pressed"), "false", "the selected row's click deselects it");
  assert.ok(under("arc_2") === null, "and closes what is under it");
  assert.ok(document.querySelector('.arc-card, aside, [data-surface-layer="overlay"]') === null, "nothing is drawn over the map");

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

test("3.20 · an opened arc's expansion keeps its nodes across a refresh that changes nothing, and its copy button puts the arc's title on the clipboard as plain text", async (t) => {
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
  const intent = document.querySelector<HTMLElement>(".arc-under .arc-intent")!;
  assert.match(intent.textContent ?? "", /See the work/);
  for (const tick of [...ticks.values()]) tick();
  await settle();
  assert.ok(intent.isConnected, "a refresh that changes nothing keeps the expansion's nodes, so a selection in it holds");

  document.querySelector<HTMLButtonElement>("[data-copy-arc-title]")!.click();
  await settle();
  assert.deepEqual(copied, ["Stability & testing <rigour>"]);
  assert.equal(document.querySelector("[data-copy-arc-title]")?.textContent, "Copied");
});

test("3.1 · the Arcs tab's badge counts what waits on the owner across the active arcs, whatever scope is on show", async (t) => {
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
  const asking = (id: string, arc: string) => record(id, "question", { arc, title: id, lifecycle: "open", statement: "s", stakes: "s", context: "c", options: "o" });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [
      { arc: record("live", "arc", { title: "Live work", intent: "i", endState: "e" }), increments: [], questions: [asking("q1", "live")], state: "active" },
      { arc: record("later", "arc", { title: "Later work", intent: "i", endState: "e" }), increments: [], questions: [asking("q2", "later"), asking("q3", "later")], state: "parked" },
    ],
    closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  page.localStorage.setItem("storytree.arc-surface.v1:p", JSON.stringify({ scope: "parked" }));
  const waiting: number[] = [];
  surface = mountArcSurface(document.body, { project: "p", reads, onWaiting: (count) => { waiting.push(count); }, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: () => () => {} } });
  await settle();
  assert.ok(document.querySelector('[data-arc-select="later"]'), "it opened on the kept Parked scope");
  assert.deepEqual(waiting, [1], "the active arc's question, not the parked arc's two");
  document.querySelector<HTMLButtonElement>('[data-arc-scope="closed"]')!.click();
  await settle();
  assert.deepEqual(waiting, [1], "another scope on show changes nothing");
});

test("3.21 · a question's row under an opened arc unfolds its reading in place, and the opened caret and its folds survive the live redraw", async (t) => {
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
  const question = record("q1", "question", { arc: "arc_1", title: "Which vendor?", lifecycle: "open", statement: "Pick the vendor for the board", stakes: "s", context: "c", options: "o" });
  const work = record("i1", "increment", { arc: "arc_1", title: "Build the board", objective: "A board", body: "b", status: "proposal" });
  let title = "Ship the board";
  const arc = () => record("arc_1", "arc", { title, intent: "See the work", endState: "e" });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [{ arc: arc(), increments: [work], questions: [question], state: "active" }],
    closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const ticks: (() => void)[] = [];
  surface = mountArcSurface(document.body, { project: "p", reads, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: (_ms, tick) => { ticks.push(tick); return () => {}; } } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-arc-queue="arc_1"]')!.click();
  const fold = document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:arc_1:increment:i1"]')!;
  fold.open = true;
  fold.dispatchEvent(new page.Event("toggle") as unknown as Event);
  assert.equal(document.querySelector('[data-arc-select="arc_1"]')!.getAttribute("aria-pressed"), "false", "the caret selects nothing");
  const asked = document.querySelector<HTMLDetailsElement>('details[data-rail-question="q1"]')!;
  asked.open = true;
  asked.dispatchEvent(new page.Event("toggle") as unknown as Event);
  assert.match(asked.textContent ?? "", /Pick the vendor for the board/, "the question's reading is under its row");
  const intent = document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:arc_1:intent"]')!;
  intent.open = true;
  intent.dispatchEvent(new page.Event("toggle") as unknown as Event);
  title = "Ship the whole board";
  reads.changesSince = async () => ({ changes: [{ seq: 1, recordId: "arc_1", type: "arc", action: "updated" as const, record: arc() }], cursor: 1 });
  for (const tick of ticks) tick();
  await settle(); await settle();
  assert.match(document.querySelector('[data-arc-select="arc_1"]')!.textContent ?? "", /Ship the whole board/, "the rail was drawn again");
  assert.equal(document.querySelector('[data-arc-queue="arc_1"]')!.getAttribute("aria-expanded"), "true", "the caret is still open after the redraw");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:arc_1:increment:i1"]')!.open, true, "and so is its increment row");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-rail-question="q1"]')!.open, true, "its question's reading");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:arc_1:intent"]')!.open, true, "and its intent");
});

test("3.2 · the mounted strip is cut at four rows of the ovals its measured width holds, drawn again when that width changes, and counts what its marks fold as drawn", async (t) => {
  const page = new Window({ url: "https://storytree.test" });
  const document = page.document as unknown as Document;
  let surface: ReturnType<typeof mountArcSurface> | undefined;
  let width = 92;
  Object.defineProperty(page.HTMLElement.prototype, "clientWidth", { configurable: true, get(this: HTMLElement) { return this.classList.contains("arc-bars") ? width : 0; } });
  const resized: (() => void)[] = [];
  class Resizes { constructor(heard: () => void) { resized.push(heard); } observe() {} disconnect() {} }
  const globals = { document: page.document, HTMLElement: page.HTMLElement, localStorage: page.localStorage, ResizeObserver: Resizes };
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
  const work = (id: string, closed: boolean) => record(id, "increment", { arc: "arc_1", title: `Build ${id}`, objective: id, body: id, status: closed ? "closed" : "proposal", ...(closed ? { outcome: { date: "2026-10-20", disposition: "landed" as const } } : {}) });
  const increments = [...Array.from({ length: 30 }, (_, index) => work(`l${index}`, true)), ...Array.from({ length: 5 }, (_, index) => work(`o${index}`, false))];
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [{ arc: record("arc_1", "arc", { title: "Ship the board", intent: "i", endState: "e" }), increments, questions: [], state: "active" }],
    closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  surface = mountArcSurface(document.body, { project: "p", reads, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: () => () => {} } });
  await settle();
  const ovals = () => document.querySelectorAll(".arc-bars .arc-bar").length;
  assert.equal(ovals(), 5, "92 px holds five ovals a row: the thirty landed fold, the five open are drawn");
  assert.equal(document.querySelector(".arc-landed-mark")?.textContent, "30 landed");
  assert.equal(JSON.parse(document.body.dataset.drew!).arcSurface.increments.length, 35, "what a mark folds is drawn, for the smoke check");
  assert.equal(JSON.parse(document.body.dataset.drew!).arcSurface.folded.length, 30, "and named as folded");
  width = 400;
  for (const heard of resized) heard();
  assert.equal(ovals(), 35, "a wider rail holds the whole strip in four rows");
  assert.ok(document.querySelector(".arc-landed-mark") === null);
});

test("3.27 · selecting an arc tells the host the capabilities its open increments name and the contracts they link, once each, and deselecting it tells none", async (t) => {
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
  const work = (id: string, arcId: string, capabilities: string[], status: "proposal" | "active" | "closed" = "proposal", links: string[] = []) => record(id, "increment", { arc: arcId, title: id, objective: id, body: id, status, capabilities, links,
    ...(status === "closed" ? { outcome: { date: "2026-09-20", disposition: "landed" as const } } : {}) });
  const shipped = { arc: record("arc_3", "arc", { title: "Shipped", intent: "Ship", endState: "Shipped" }), increments: [work("inc_4", "arc_3", ["cap_old"], "closed")], questions: [], state: "closed" as const, closed: "2026-10-02" };
  const first = { arc, increments: [work("inc_1", "arc_1", ["cap_b", "cap_a"], "proposal", ["contract_b", "decision_x", "contract_a"]), work("inc_2", "arc_1", ["cap_a", "cap_c"], "active", ["contract_a"]),
    work("inc_3", "arc_1", ["cap_done"], "closed", ["contract_done"])], questions: [], state: "active" as const };
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [first, { arc: other, increments: [], questions: [], state: "active" }, shipped],
    closedArcs: async () => [shipped],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const told: (readonly string[] | undefined)[] = [];
  const toldContracts: (readonly string[] | undefined)[] = [];
  const ticks = new Map<number, () => void>();
  surface = mountArcSurface(document.body, {
    project: "p", reads, onOpened: (capabilities, contracts) => { told.push(capabilities); toldContracts.push(contracts); },
    timers: { now: () => Date.parse("2026-10-02T12:00:00Z"), every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
  });
  await settle();
  assert.deepEqual(told, [], "nothing is open at mount, so nothing is told");
  const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-arc-select="${id}"]`)!;
  row("arc_1").click();
  assert.deepEqual(told, [["cap_a", "cap_b", "cap_c"]], "the open increments' capabilities, once each; a closed increment's are not open work");
  assert.deepEqual(toldContracts, [["contract_a", "contract_b"]], "the contracts its open increments link, once each, nothing else they cite and no closed increment's");
  row("arc_2").click();
  assert.deepEqual(told.at(-1), [], "an arc with no open work circles nothing");
  assert.deepEqual(toldContracts.at(-1), []);
  row("arc_2").click();
  assert.equal(told.at(-1), undefined, "deselecting it tells none");
  assert.equal(toldContracts.at(-1), undefined);
  assert.equal(told.length, 3);

  row("arc_1").click();
  reads.boardArcs = async () => [{ arc: other, increments: [], questions: [], state: "active" }, shipped];
  reads.changesSince = async () => ({ changes: [{ seq: 1, recordId: "arc_1", type: "arc", action: "updated" as const, record: arc }], cursor: 1 });
  for (const tick of [...ticks.values()]) tick();
  await settle();
  assert.deepEqual(told.slice(3), [["cap_a", "cap_b", "cap_c"], undefined], "its arc leaving the board tells none");

  document.querySelector<HTMLButtonElement>('[data-arc-scope="closed"]')!.click();
  await settle();
  row("arc_3").click();
  assert.deepEqual(told.at(-1), [], "a closed arc has no open work");
  document.querySelector<HTMLButtonElement>('[data-closed-range="week"]')!.click();
  assert.equal(told.at(-1), undefined, "another range of closed days deselects it, and tells none");
});

test("4.1 · a queued arc's chip selects it and draws its expansion under the chips; its click again deselects it", async (t) => {
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
    boardArcs: async () => [
      { arc: record("first", "arc", { title: "First", intent: "Go first", endState: "e" }), increments: [], questions: [], state: "active" },
      { arc: record("next", "arc", { title: "Next", intent: "Go next", endState: "e" }), increments: [], questions: [], state: "active" },
    ],
    closedArcs: async () => [],
    holds: async () => ({ waits: { next: [{ on: "first", reason: "after first", forGood: false }] }, heldOn: {} }),
  };
  const told: (readonly string[] | undefined)[] = [];
  surface = mountArcSurface(document.body, { project: "p", reads, onOpened: (capabilities) => { told.push(capabilities); }, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: () => () => {} } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-arc-queue="first"]')!.click();
  const chip = () => document.querySelector<HTMLButtonElement>('.arc-queue-chip[data-arc-select="next"]')!;
  chip().click();
  assert.equal(chip().getAttribute("aria-pressed"), "true");
  assert.match(document.querySelector(".arc-queued-under")?.textContent ?? "", /Go next/, "the queued arc's intent is under the chips");
  assert.deepEqual(told, [[]], "the host hears the queued arc selected");
  chip().click();
  assert.ok(document.querySelector(".arc-queued-under") === null);
  assert.equal(document.querySelector('[data-arc-queue="first"]')!.getAttribute("aria-expanded"), "true", "its blocker stays open");
});

test("3.34 · the rail reads each CI leg's factory median once mounted and every ten minutes, and redraws a pull request's CI bar against the clock", async (t) => {
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
  const start = Date.parse("2026-11-11T12:00:00Z");
  let now = start;
  const at = (minutesAgo: number) => new Date(start - minutesAgo * 60_000).toISOString();
  const arc = record("arc_1", "arc", { title: "Ship the board", intent: "See the work", endState: "Board shipped" });
  const shipping = record("inc_1", "increment", { arc: "arc_1", title: "Ship the bar", objective: "o", body: "b", status: "active" });
  const lines = [
    { project: "p", seq: 1, at: at(20), source: "tool", kind: "claimed", harness: "watcher", session: "pull-request-12", increment: "inc_1", reason: "handed over" },
    { project: "p", seq: 2, at: at(1), source: "tool", kind: "branch-state", session: "observer", of: "claude/ship", open: true, how: "ahead", pr: 12, checks: "pending", checksSince: at(7) },
  ] as Line[];
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async (_project, from) => ({ lines: from === 0 ? lines : [], cursor: 2 }),
    boardArcs: async () => [{ arc, increments: [shipping], questions: [], state: "active" }], closedArcs: async () => [],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const medians = [{ checks: 14 }, { checks: 28 }, undefined];
  let asked = 0;
  const ticks = new Map<number, () => void>();
  surface = mountArcSurface(document.body, {
    project: "p", reads, ciExpected: async () => medians[asked++],
    timers: { now: () => now, every: (ms, tick) => { ticks.set(ms, tick); return () => { ticks.delete(ms); }; } },
  });
  const fill = () => document.querySelector(".arc-ci-checks .arc-ci-fill")?.getAttribute("data-fill");
  await waitUntil(() => fill() === "50", 2_000, "the CI bar drawn at 7 of 14 minutes");
  assert.equal(asked, 1, "read once mounted");
  const row = document.querySelector(".arc-row");
  now = start + 7 * 60_000;
  ticks.get(60_000)!();
  assert.equal(fill(), "95", "the clock moved: 14 of 14 minutes, held at 95%");
  assert.ok(document.querySelector(".arc-ci-checks.arc-ci-long"), "and amber");
  assert.ok(document.querySelector(".arc-row") === row, "only the CI bar was drawn again: the lane's row is the node it was");
  ticks.get(600_000)!();
  await waitUntil(() => fill() === "50", 2_000, "the CI bar drawn against the new median");
  assert.equal(asked, 2, "read again ten minutes on: 14 of a median now 28 minutes");
  assert.ok(document.querySelector(".arc-row") === row, "a new median draws only the CI bar");
  ticks.get(600_000)!();
  await waitUntil(() => asked === 3, 2_000, "the third read");
  ticks.get(60_000)!();
  assert.equal(fill(), "50", "an unreadable median keeps the last one read");
  surface.stop();
  assert.equal(ticks.has(600_000), false, "stopped, it reads no more");
});

test("3.39 · opening an increment from outside selects its arc, opens its queue head and its row, landed or not, and waits for a board that shows it", async (t) => {
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
  const open = record("i_open", "increment", { arc: "next", title: "Build next", objective: "o", body: "b", status: "proposal" });
  const landed = record("i_landed", "increment", { arc: "first", title: "Built first", objective: "o", body: "b", status: "closed", outcome: { date: "2026-11-01", disposition: "landed" } });
  let read!: () => void;
  const ready = new Promise<void>((resolve) => { read = resolve; });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => {
      await ready;
      return [
        { arc: record("alone", "arc", { title: "Alone", intent: "Go alone", endState: "e", priority: 1 }), increments: [], questions: [], state: "active" },
        { arc: record("first", "arc", { title: "First", intent: "Go first", endState: "e" }), increments: [landed], questions: [], state: "active" },
        { arc: record("next", "arc", { title: "Next", intent: "Go next", endState: "e" }), increments: [open], questions: [], state: "active" },
      ];
    },
    closedArcs: async () => [],
    holds: async () => ({ waits: { next: [{ on: "first", reason: "after first", forGood: false }] }, heldOn: {} }),
  };
  const told: (readonly string[] | undefined)[] = [];
  surface = mountArcSurface(document.body, { project: "p", reads, onOpened: (capabilities) => { told.push(capabilities); }, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: () => () => {} } });
  surface.openIncrement("i_open");
  read();
  await waitUntil(() => document.querySelector('details[data-fold-key="rail:next:increment:i_open"]') !== null, 2000, "the board that shows the increment");
  assert.equal(document.querySelector('[data-arc-queue="first"]')!.getAttribute("aria-expanded"), "true", "the queue head the increment's arc waits behind is opened");
  assert.equal(document.querySelector('[data-arc-queue="alone"]')!.getAttribute("aria-expanded"), "false", "and no other");
  assert.equal(document.querySelector('.arc-queue-chip[data-arc-select="next"]')!.getAttribute("aria-pressed"), "true", "its arc is selected");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:next:increment:i_open"]')!.open, true, "and its row is open");
  assert.deepEqual(told, [[]], "the host hears the arc selected, as a click would tell it");
  surface.openIncrement("i_landed");
  await settle();
  assert.equal(document.querySelector('[data-arc-select="first"].arc-lane')!.getAttribute("aria-pressed"), "true", "a landed increment's arc is selected");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:first:landed"]')!.open, true, "its landed fold opens");
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:first:increment:i_landed"]')!.open, true, "and so does its row");
});

test("3.39 · an increment opened from outside names its arc in its row, and is scrolled into view with its arc's row at the top of the lanes when both fit, nearest when they do not", async (t) => {
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
  // The lanes show 300 px from 100 px down the page; the queued arc's chip sits 400 px into them, its increment's row below it.
  let rowAt = { top: 600, bottom: 640 };
  const scrolled: unknown[] = [];
  const prototype = page.HTMLElement.prototype as unknown as HTMLElement;
  const lanesOf = (element: Element) => element.closest<HTMLElement>(".arc-lanes");
  Object.defineProperty(prototype, "clientHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("arc-lanes") ? 300 : 0; } });
  Object.defineProperty(prototype, "getBoundingClientRect", { configurable: true, value(this: HTMLElement) {
    const scroll = lanesOf(this)?.scrollTop ?? 0;
    const at = this.classList.contains("arc-lanes") ? { top: 100, bottom: 400 }
      : this.matches('.arc-queue-chip[data-arc-select="next"]') ? { top: 400, bottom: 420 }
      : this.matches('details[data-fold-key="rail:next:increment:i_open"]') ? rowAt : { top: 0, bottom: 0 };
    const shift = this.classList.contains("arc-lanes") ? 0 : 100 - scroll;
    return { top: at.top + shift, bottom: at.bottom + shift, height: at.bottom - at.top, left: 0, right: 0, width: 0, x: 0, y: at.top + shift };
  } });
  Object.defineProperty(prototype, "scrollIntoView", { configurable: true, value(this: HTMLElement, options: unknown) { scrolled.push([this.dataset.foldKey, options]); } });
  const open = record("i_open", "increment", { arc: "next", title: "Build next", objective: "o", body: "b", status: "proposal" });
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    boardArcs: async () => [
      { arc: record("first", "arc", { title: "First", intent: "Go first", endState: "e" }), increments: [], questions: [], state: "active" },
      { arc: record("next", "arc", { title: "Next", intent: "Go next", endState: "e" }), increments: [open], questions: [], state: "active" },
    ],
    closedArcs: async () => [],
    holds: async () => ({ waits: { next: [{ on: "first", reason: "after first", forGood: false }] }, heldOn: {} }),
  };
  surface = mountArcSurface(document.body, { project: "p", reads, timers: { now: () => Date.parse("2026-11-03T00:00:00Z"), every: () => () => {} } });
  await waitUntil(() => document.querySelector(".arc-lanes") !== null, 2000, "the board");
  surface.openIncrement("i_open");
  await settle();
  assert.equal(document.querySelector<HTMLElement>(".arc-lanes")!.scrollTop, 400, "the arc's chip, holding its title, is scrolled to the top of the lanes, its opened row in view below it");
  assert.deepEqual(scrolled, [], "so the row needs no scroll of its own");
  const named = () => [...document.querySelectorAll('details[data-fold-key="rail:next:increment:i_open"] .arc-increment-detail dt')].find((dt) => dt.textContent === "Arc")?.nextElementSibling?.textContent;
  assert.equal(named(), "Next", "the opened row names its arc, readable however far above its arc's row sits");
  document.querySelector<HTMLElement>(".arc-lanes")!.scrollTop = 0;
  rowAt = { top: 900, bottom: 940 };
  surface.openIncrement("i_open");
  await settle();
  assert.equal(document.querySelector<HTMLElement>(".arc-lanes")!.scrollTop, 0, "an arc too far above its row to show both is not scrolled to");
  assert.deepEqual(scrolled, [["rail:next:increment:i_open", { block: "nearest" }]], "the row is scrolled into view instead");
  document.querySelector<HTMLElement>('.arc-lane[data-arc-select="first"]')!.click();
  document.querySelector<HTMLElement>('.arc-queue-chip[data-arc-select="next"]')!.click();
  await settle();
  assert.equal(document.querySelector<HTMLDetailsElement>('details[data-fold-key="rail:next:increment:i_open"]')!.open, true, "picked again by hand, its arc shows the row still open");
  assert.equal(named(), undefined, "but under an arc picked by hand, which is in view, no row names it");
});
