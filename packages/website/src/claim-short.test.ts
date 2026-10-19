import assert from "node:assert/strict";
import { test } from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { wireClaimShort } from "./claim-short.js";

/** Claim 1's video in a page whose visibility the test drives, counting the plays and pauses it is asked for. */
function short({ reducedMotion = false } = {}) {
  const dom = new HappyWindow();
  const view = dom as unknown as Window & typeof globalThis;
  let seen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  Object.assign(view, {
    matchMedia: (query: string) => ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)" }),
    IntersectionObserver: class { constructor(callback: typeof seen) { seen = callback; } observe() {} disconnect() {} },
  });
  const video = (dom.document as unknown as Document).createElement("video");
  const asked = { plays: 0, pauses: 0 };
  let paused = true;
  Object.defineProperty(video, "paused", { get: () => paused });
  video.play = async () => { asked.plays++; paused = false; };
  video.pause = () => { asked.pauses++; paused = true; };
  wireClaimShort(video, view);
  return { video, asked, scroll: (isIntersecting: boolean) => seen?.([{ isIntersecting }]), click: () => { paused = false; video.dispatchEvent(new view.Event("play")); } };
}

test("1.13 · the first short plays as it scrolls into view and pauses as it leaves", () => {
  const { asked, scroll } = short();
  assert.equal(asked.plays, 0, "nothing plays before it is seen");
  scroll(true);
  assert.equal(asked.plays, 1);
  scroll(false);
  assert.equal(asked.pauses, 1);
  scroll(true);
  assert.equal(asked.plays, 2, "and plays again on the way back");
});

test("1.13 · with reduced motion the first short stays on its poster until the visitor plays it", () => {
  const { asked, scroll, click } = short({ reducedMotion: true });
  scroll(true);
  assert.equal(asked.plays, 0, "scrolling to it never starts it");
  click();
  scroll(false);
  assert.equal(asked.pauses, 1, "once the visitor plays it, it still pauses when it leaves the view");
  scroll(true);
  assert.equal(asked.plays, 0, "and is never restarted for them");
});
