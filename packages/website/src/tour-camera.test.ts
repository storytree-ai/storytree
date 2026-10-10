import assert from "node:assert/strict";
import { test } from "node:test";
import type { GlobeTarget } from "@storytree/forest/view";
import { createCameraPlayer, type CameraStep, type Stop } from "./tour-camera.js";
import type { TourDetail, TourStep } from "./tour.js";

/** A clock the test moves by hand, and a camera on it that writes down what it does and when. */
function rig() {
  let now = 0, id = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const log: string[] = [];
  let running = true, drawn = new Set<string>(["a", "b", "c", "core"]);
  const name = (target: GlobeTarget) => target.kind === "story" ? target.story : target.kind;
  const camera = createCameraPlayer({
    timers: { set: (run, ms) => { pending.set(++id, { at: now + ms, run }); return id; }, clear: timer => { pending.delete(timer as number); } },
    arrived: yes => { if (yes) log.push(`${Math.round(now)} arrive`); }, running: () => running,
  });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...pending].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      pending.delete(next[0]); now = next[1].at; next[1].run();
    }
    now = until;
  };
  const place = (stop: Stop) => { if (!drawn.has(name(stop.target))) return false; log.push(`${Math.round(now)} ${name(stop.target)} ×${+stop.framing.toFixed(2)} ${Math.round(stop.duration)}ms`); return true; };
  const tell = (tour: TourDetail, before: TourDetail | undefined, more: Partial<CameraStep> = {}) => camera.step({ tour, before, switching: false,
    to: { target: story(tour.step.target ? name(tour.step.target) : "core"), framing: tour.step.framing ?? 1.1 }, overview: { kind: "core" }, shownOverview: { kind: "core" },
    driftOrder: ["a", "b", "c"], next: 1, reduced: false, place, show: () => log.push(`${Math.round(now)} show`), ...more });
  return { camera, log, advance, tell, set running(value: boolean) { running = value; }, set drawn(value: Set<string>) { drawn = value; } };
}
const story = (id: string): GlobeTarget => id === "core" ? { kind: "core" } : { kind: "story", story: id };
const step = (id: string, more: Partial<TourStep> = {}): TourStep => ({ id, title: id, explainer: "map", lines: ["One"], decisions: [], surfaces: {}, ...more });
const detail = (s: TourStep, index: number, more: Partial<TourDetail["state"]> = {}, running = true): TourDetail => ({ step: s, running, elapsed: 0,
  state: { index, generation: 0, lines: 1, speed: 1, holds: [], freePlay: false, project: "shop", ...more } });

test("2.15 · chapter 2's first view grows in from far away, then arrives", () => {
  const { log, advance, tell } = rig();
  tell(detail(step("one", { target: story("a"), framing: .8 }), 0), undefined);
  advance(5000);
  assert.deepEqual(log, ["0 a ×5.6 0ms", "60 a ×0.8 2600ms", "2660 arrive"], "the far pose lands first, then one eased flight in");
});

test("2.15 · between steps on one globe the camera flies one leg and arrives when it ends; at 1.5× it is quicker", () => {
  const { log, advance, tell } = rig();
  const one = detail(step("one", { target: story("a"), framing: .8 }), 0);
  tell(one, undefined); advance(5000); log.length = 0;
  const two = detail(step("two", { target: story("b"), framing: .8 }), 1, { speed: 1.5 });
  tell(two, one); advance(5000);
  assert.deepEqual(log, ["5000 b ×0.8 1333ms", "6333 arrive"]);
});

test("2.15 · a line that moves the camera within a step flies it; a line that does not leaves it be", () => {
  const { log, advance, tell } = rig();
  const s = step("one", { target: story("a"), framing: 1.25 });
  const first = detail(s, 0);
  tell(first, undefined); advance(5000); log.length = 0;
  const second = detail(s, 0, { lines: 2 });
  tell(second, first); advance(5000);
  assert.deepEqual(log, [], "the same view on the next line: the camera does not move");
  tell(second, second, { to: { target: story("a"), framing: .8 } }); advance(5000);
  assert.deepEqual(log, ["10000 a ×0.8 1800ms", "11800 arrive"], "the line's own view: it eases in on the same island");
});

test("2.15 · to another project's globe it pulls back, swaps the globe, waits for it to be drawn and dives in", () => {
  const { camera, log, advance, tell } = rig();
  const one = detail(step("one", { target: story("a"), framing: .8 }), 0);
  tell(one, undefined); advance(5000); log.length = 0;
  const two = detail(step("two", { target: story("b"), framing: .6 }), 1);
  tell(two, one, { switching: true }); advance(900);
  assert.deepEqual(log, ["5000 a ×2.4 900ms", "5900 show"], "pull back on the old globe until it is small, then swap it");
  assert.ok(camera.diving, "the dive waits for the new globe");
  advance(5000);
  assert.equal(log.length, 2, "nothing more until the new globe is drawn");
  camera.drawn(); advance(5000);
  assert.deepEqual(log.slice(2), ["10900 core ×2.4 0ms", "10960 b ×0.6 1500ms", "12460 arrive"], "from the new globe's whole view, one dive in");
});

test("2.12 · a globe that grows from a point is shown at once, with no pull back and dive", () => {
  const { log, advance, tell } = rig();
  const one = detail(step("one", { target: story("a"), framing: 1.1 }), 0);
  tell(one, undefined); advance(5000); log.length = 0;
  tell(detail(step("two", { growth: { seconds: 10 } }), 1), one, { switching: true }); advance(5000);
  assert.deepEqual(log, ["5000 show", "5000 core ×1.1 2000ms", "7000 arrive"]);
});

test("2.15 · with reduced motion the camera cuts to each view and never drifts", () => {
  const { log, advance, tell } = rig();
  const one = detail(step("one", { target: story("a"), framing: .8, drift: true }), 0);
  tell(one, undefined, { reduced: true }); advance(60_000);
  assert.deepEqual(log, ["0 a ×0.8 0ms", "0 arrive"]);
  log.length = 0;
  tell(detail(step("two", { target: story("b") }), 1), one, { reduced: true, switching: true }); advance(1000);
  assert.deepEqual(log, ["60000 show", "60000 arrive", "60060 b ×1.1 0ms"], "a new globe at once, the camera on it a beat later");
});

test("2.15 · an overview step drifts round the islands one leg at a time; pausing freezes the drift and playing returns and drifts on", () => {
  const rigged = rig();
  const { log, advance, tell } = rigged;
  const s = step("one", { target: story("a"), framing: 1.1, drift: true });
  const playing = detail(s, 0);
  tell(playing, undefined); advance(2660 + 18_000 * 2 - 1);
  assert.deepEqual(log, ["0 a ×7.7 0ms", "60 a ×1.1 2600ms", "2660 arrive", "2660 b ×1.1 18000ms", "20660 c ×1.1 18000ms"], "a leg to each island in turn, from the one after the step's");
  log.length = 0;
  const paused = detail(s, 0, { holds: ["paused"] }, false);
  tell(paused, playing); advance(60_000);
  assert.deepEqual(log, [], "waiting freezes the drift");
  const again = detail(s, 0);
  tell(again, paused); advance(1400 + 18_000);
  assert.deepEqual(log, ["98659 a ×1.1 1400ms", "100059 b ×1.1 18000ms", "118059 c ×1.1 18000ms"], "back to the step's view, then on round the islands");
});

test("2.15 · a step's island drawn late is aimed at again until it is drawn, by its latest aim", () => {
  const rigged = rig();
  const { log, advance, tell } = rigged;
  rigged.drawn = new Set(["core"]);
  const one = detail(step("one", { target: story("a"), framing: .8 }), 0);
  tell(one, undefined); advance(200);
  assert.deepEqual(log, [], "the island is not drawn yet");
  rigged.drawn = new Set(["a", "core"]); advance(50);
  assert.deepEqual(log, ["210 a ×0.8 2600ms"], "aimed at on the next beat once it is, by the latest aim only: the far pose it superseded never pulls the camera back out");
});
