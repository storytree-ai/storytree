// The globe's half of world 6.10 that a headless test can reach: what it asks of its R3F root as the
// browser says its canvas has come into or gone out of view. The browser half (that Chromium really
// draws nothing) is evidence/planet/capture.mjs, which counts the shipped canvas's frames.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Clock } from 'three';
import { paintWhileSeen, startingFrameloop, viewportWatch, type PaintingRoot, type ViewportWatch } from './paint-while-seen.js';

type Frameloop = PaintingRoot['frameloop'];

/** An R3F root as far as painting goes, behaving as @react-three/fiber 9's own does. */
function root(frameloop: Frameloop) {
  const clock = new Clock();
  const state = {
    frameloop, clock, internal: { frames: 0 },
    // R3F's setFrameloop stops the clock and sets it back to zero, starting it again unless the loop is "never".
    setFrameloop(next: Frameloop) {
      clock.stop(); clock.elapsedTime = 0;
      if (next !== 'never') { clock.start(); clock.elapsedTime = 0; }
      state.frameloop = next;
    },
    // R3F's invalidate asks for nothing while the loop is "never"; an animation calls it every frame.
    invalidate() { if (state.frameloop !== 'never') state.internal.frames = 1; },
  };
  return state;
}

/** A watch the test drives: it says what the browser would. */
function watcher() {
  const watch = { seen: (_: boolean) => {}, stopped: false, element: undefined as Element | undefined };
  const observe: ViewportWatch = (element, seen) => { watch.element = element; watch.seen = seen; return () => { watch.stopped = true; }; };
  return { watch, observe };
}

const canvas = {} as Element;

test('6.10 a globe starts paused, draws once its canvas is seen, and asks for no frame while it is not', () => {
  const { watch, observe } = watcher();
  const globe = root(startingFrameloop(observe));
  const stop = paintWhileSeen(() => globe as unknown as PaintingRoot, canvas, observe);
  assert.equal(watch.element, canvas, 'it watches its own canvas');
  globe.invalidate();
  assert.equal(globe.internal.frames, 0, 'mounted out of view, an animating globe asks for no frame');
  watch.seen(true);
  assert.equal(globe.frameloop, 'demand', 'seen, it draws on demand');
  globe.invalidate();
  assert.equal(globe.internal.frames, 1);
  globe.internal.frames = 2; // an animation has asked for its next frame
  watch.seen(false);
  assert.equal(globe.frameloop, 'never');
  assert.equal(globe.internal.frames, 0, 'a frame asked for before it went out of view is not drawn');
  globe.invalidate();
  assert.equal(globe.internal.frames, 0, 'out of view, the animation asks for nothing');
  watch.seen(true);
  globe.invalidate();
  assert.equal(globe.internal.frames, 1, 'back in view it draws again');
  stop();
  assert.ok(watch.stopped, 'unmounting stops the watch');
});

test('6.10 its clock keeps time while it is away, so a lane drawing on carries on rather than starting again', () => {
  const { watch, observe } = watcher();
  const globe = root(startingFrameloop(observe));
  paintWhileSeen(() => globe as unknown as PaintingRoot, canvas, observe);
  watch.seen(true);
  globe.clock.elapsedTime = 5; // five seconds of drawing
  watch.seen(false);
  assert.ok(globe.clock.running, 'away, the clock still runs');
  assert.ok(globe.clock.getElapsedTime() >= 5, 'away, the clock has not gone back to zero');
  watch.seen(true);
  assert.ok(globe.clock.getElapsedTime() >= 5, 'back, the clock carries on from where it was');
});

test('6.10 where the browser cannot say what is on screen, the globe draws as before', () => {
  const globe = root(startingFrameloop(undefined));
  assert.equal(globe.frameloop, 'demand');
  paintWhileSeen(() => globe as unknown as PaintingRoot, canvas, undefined)();
  globe.invalidate();
  assert.equal(globe.internal.frames, 1);
  const kept = globalThis.IntersectionObserver;
  try {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    assert.equal(viewportWatch(), undefined);
  } finally {
    if (kept) globalThis.IntersectionObserver = kept;
  }
});

test('6.10 a canvas only touching the viewport is not seen; any sliver of it in view is', () => {
  const kept = globalThis.IntersectionObserver;
  let report: (entries: unknown[]) => void = () => {};
  globalThis.IntersectionObserver = class {
    constructor(callback: (entries: unknown[]) => void) { report = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  try {
    const said: boolean[] = [];
    viewportWatch()!(canvas, seen => said.push(seen));
    report([{ isIntersecting: true, intersectionRect: { width: 960, height: 0 } }]);
    report([{ isIntersecting: true, intersectionRect: { width: 960, height: 1 } }]);
    report([{ isIntersecting: false, intersectionRect: { width: 0, height: 0 } }]);
    assert.deepEqual(said, [false, true, false]);
  } finally {
    if (kept) globalThis.IntersectionObserver = kept;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  }
});
