import assert from "node:assert/strict";
import { test } from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { wireClaimShort } from "./claim-short.js";

/** A claim's video in a page whose visibility the test drives, its media standing in for a browser's. */
function short({ reducedMotion = false } = {}) {
  const dom = new HappyWindow();
  const view = dom as unknown as Window & typeof globalThis;
  let seen: ((entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) | undefined;
  Object.assign(view, {
    matchMedia: (query: string) => ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)" }),
    IntersectionObserver: class { constructor(callback: typeof seen) { seen = callback; } observe() {} disconnect() {} },
  });
  const video = (dom.document as unknown as Document).createElement("video");
  // happy-dom plays no media: its paused state follows play() and pause() as a browser's does.
  let paused = true;
  Object.defineProperty(video, "paused", { get: () => paused });
  video.play = async () => { paused = false; };
  video.pause = () => { paused = true; };
  wireClaimShort(video, view);
  // How much of it is in view: all of it, none, or a sliver, still intersecting but under half.
  const scroll = (shown: boolean | number) => seen?.([{ isIntersecting: shown !== false && shown !== 0, intersectionRatio: shown === true ? 1 : Number(shown) }]);
  return { video, scroll, click: () => { paused = false; video.dispatchEvent(new view.Event("play")); } };
}

test("1.13 · a claim's short plays as it scrolls into view and pauses as it leaves", () => {
  const { video, scroll } = short();
  assert.equal(video.paused, true, "nothing plays before it is seen");
  scroll(true);
  assert.equal(video.paused, false);
  scroll(false);
  assert.equal(video.paused, true);
  scroll(true);
  assert.equal(video.paused, false, "and plays again on the way back");
  scroll(0.3);
  assert.equal(video.paused, true, "and pauses once most of it has left, so the next claim's short never plays beside it");
});

test("1.13 · with reduced motion a claim's short stays on its poster until the visitor plays it", () => {
  const { video, scroll, click } = short({ reducedMotion: true });
  scroll(true);
  assert.equal(video.paused, true, "scrolling to it never starts it");
  click();
  scroll(false);
  assert.equal(video.paused, true, "once the visitor plays it, it still pauses when it leaves the view");
  scroll(true);
  assert.equal(video.paused, true, "and is never restarted for them");
});
