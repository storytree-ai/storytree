import assert from "node:assert/strict";
import { test } from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { wireClaimShort } from "./claim-short.js";

/** Claim 1's video in a page whose visibility the test drives, its media standing in for a browser's. */
function short({ reducedMotion = false } = {}) {
  const dom = new HappyWindow();
  const view = dom as unknown as Window & typeof globalThis;
  let seen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
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
  return { video, scroll: (isIntersecting: boolean) => seen?.([{ isIntersecting }]), click: () => { paused = false; video.dispatchEvent(new view.Event("play")); } };
}

test("1.13 · the first short plays as it scrolls into view and pauses as it leaves", () => {
  const { video, scroll } = short();
  assert.equal(video.paused, true, "nothing plays before it is seen");
  scroll(true);
  assert.equal(video.paused, false);
  scroll(false);
  assert.equal(video.paused, true);
  scroll(true);
  assert.equal(video.paused, false, "and plays again on the way back");
});

test("1.13 · with reduced motion the first short stays on its poster until the visitor plays it", () => {
  const { video, scroll, click } = short({ reducedMotion: true });
  scroll(true);
  assert.equal(video.paused, true, "scrolling to it never starts it");
  click();
  scroll(false);
  assert.equal(video.paused, true, "once the visitor plays it, it still pauses when it leaves the view");
  scroll(true);
  assert.equal(video.paused, true, "and is never restarted for them");
});
