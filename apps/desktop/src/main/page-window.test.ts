import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { keepPageInWindow, type PageWindow } from "./page-window.js";

/** A stand-in for Electron's window and its contents: its events, its window-open handler, and whether it was shown. */
function fakeWindow() {
  let destroyed = false, shown = 0;
  let openHandler: (() => { action: "deny" | "allow" }) | undefined;
  const emitter = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler: (handler: () => { action: "deny" }) => { openHandler = handler; } });
  const window: PageWindow = {
    webContents: contents,
    isDestroyed: () => destroyed,
    show: () => {
      if (destroyed) throw new TypeError("Object has been destroyed");
      shown++;
    },
    once: (event, listener) => { emitter.once(event, listener); },
  };
  return {
    window, contents,
    ready: () => emitter.emit("ready-to-show"),
    destroy: () => { destroyed = true; },
    shown: () => shown,
    opening: () => openHandler?.(),
  };
}

test("1.28 · the page never navigates away or opens another window", () => {
  const fake = fakeWindow();
  keepPageInWindow(fake.window, { headless: false });
  const navigation = { prevented: false, preventDefault() { this.prevented = true; } };
  fake.contents.emit("will-navigate", navigation);
  assert.equal(navigation.prevented, true);
  assert.deepEqual(fake.opening(), { action: "deny" });
});

test("1.28 · the window shows itself once ready, but not headless, and not once destroyed", () => {
  const shown = fakeWindow();
  keepPageInWindow(shown.window, { headless: false });
  shown.ready();
  assert.equal(shown.shown(), 1);

  const headless = fakeWindow();
  keepPageInWindow(headless.window, { headless: true });
  headless.ready();
  assert.equal(headless.shown(), 0);

  const destroyed = fakeWindow();
  keepPageInWindow(destroyed.window, { headless: false });
  destroyed.destroy();
  assert.doesNotThrow(() => destroyed.ready());
  assert.equal(destroyed.shown(), 0);
});
