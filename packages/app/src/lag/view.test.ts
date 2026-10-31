import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import type { LagReading } from "./bridge.js";
import { mountLagRecorder, type RecorderWindow } from "./view.js";

/** A page over happy-dom's document whose frames, clock, timers and inputs the test drives; what it was asked to listen to is kept. */
function page(search: string) {
  const dom = new Window();
  dom.document.body.innerHTML = `<div data-forest-mode="forest"><canvas></canvas></div><aside class="story-panel" hidden></aside>`;
  let now = 0;
  const frames: FrameRequestCallback[] = [];
  const after: (() => void)[] = [];
  const listeners = new Map<string, EventListener>();
  const timers: (() => void)[] = [];
  const win = {
    location: { search }, document: dom.document as unknown as Document, performance: { now: () => now },
    addEventListener: (type: string, listener: EventListener) => { listeners.set(type, listener); },
    removeEventListener: (type: string) => { listeners.delete(type); },
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
    setTimeout: (callback: () => void) => { after.push(callback); },
    setInterval: (callback: () => void) => timers.push(callback), clearInterval: () => {},
    storytreeGlobe: { islands: () => [{ story: "story_lib", title: "The library", capabilities: 14, x: 0, y: 0, visible: true }], notes: () => [], face: () => true, still: () => true },
  } as unknown as RecorderWindow;
  return {
    win, listeners, timers,
    /** A trusted click at `at`. */
    click(at: number) { now = at; listeners.get("pointerdown")?.({ isTrusted: true, timeStamp: at } as unknown as Event); },
    /** A trusted pointer event of `type` at `at` on the map's canvas, its button and Ctrl as given. */
    pointer(type: string, at: number, press: { button?: number; ctrlKey?: boolean } = {}) {
      now = at;
      listeners.get(type)?.({ type, isTrusted: true, timeStamp: at, button: 0, ctrlKey: false, isPrimary: true, target: dom.document.querySelector("canvas"), ...press } as unknown as Event);
    },
    /** Run the frame the recorder asked for, at `at`, then what it left to run after the frame. */
    frame(at: number) {
      now = at;
      frames.splice(0).forEach((callback) => callback(at));
      after.splice(0).forEach((callback) => callback());
    },
    openIsland(story: string) {
      dom.document.body.dataset.selected = story;
      (dom.document.querySelector(".story-panel") as unknown as HTMLElement).hidden = false;
    },
  };
}

test("5.2 · switched off, the recorder makes no call at all; switched on, a click's reading reaches the app at the next flush, not before", () => {
  const off = page("?lag-recorder=off");
  const sent: LagReading[][] = [];
  const bridge = { recordLag: async (readings: LagReading[]) => { sent.push(readings); } };
  assert.equal(mountLagRecorder(bridge, off.win), undefined);
  assert.equal(off.listeners.size, 0, "no input is listened to");
  assert.equal(off.timers.length, 0, "no flush is scheduled");

  const on = page("");
  const recorder = mountLagRecorder(bridge, on.win);
  assert.ok(recorder !== undefined);
  on.click(1000);
  on.openIsland("story_lib");
  on.frame(1040);
  on.frame(1056);
  on.frame(1073);
  assert.deepEqual(sent, [], "nothing is sent until the flush");
  on.timers.forEach((flush) => flush());
  assert.deepEqual(sent, [[{ name: "open-island", response: 0, longFrames: 0, longestFrame: 0, settled: 40, progress: false, size: 14 }]]);
  recorder.stop();
  assert.equal(on.listeners.size, 0);
});

test("5.3 · a trusted Ctrl+drag or right-drag on the map's canvas is recorded as one turn of the view on show; a plain drag is no turn", () => {
  const sent: LagReading[][] = [];
  const on = page("");
  const recorder = mountLagRecorder({ recordLag: async (readings: LagReading[]) => { sent.push(readings); } }, on.win)!;
  // A plain drag pans: no turn, and like any input the page shows no answer to, it is watched until its limit passes.
  on.pointer("pointerdown", 0);
  on.pointer("pointermove", 10);
  for (const at of [16, 33]) on.frame(at);
  on.pointer("pointerup", 40);
  on.frame(10_050);
  on.pointer("pointerdown", 11_000, { ctrlKey: true });
  for (const at of [11_016, 11_033]) on.frame(at);
  on.pointer("pointermove", 11_040, { ctrlKey: true });
  for (const at of [11_050, 11_066]) on.frame(at);
  on.pointer("pointerup", 11_070);
  for (const at of [11_083, 11_100]) on.frame(at);
  // A right-drag in the Library is a turn of the Library.
  (on.win.document.querySelector("[data-forest-mode]") as HTMLElement).dataset.forestMode = "library";
  on.pointer("pointerdown", 13_000, { button: 2 });
  on.pointer("pointermove", 13_010, { button: 2 });
  for (const at of [13_016, 13_033]) on.frame(at);
  on.pointer("pointercancel", 13_040);
  for (const at of [13_050, 13_066]) on.frame(at);
  on.timers.forEach((flush) => flush());
  assert.deepEqual(sent.flat().map((reading) => [reading.name, reading.frames]), [
    ["turn-forest", { p50: 17, p95: 17, max: 17, over: 0 }],
    ["turn-library", { p50: 17, p95: 17, max: 17, over: 0 }],
  ]);
  recorder.stop();
  assert.equal(on.listeners.size, 0);
});
