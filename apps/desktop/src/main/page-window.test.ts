import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { keepPageInWindow, type PageWindow } from "./page-window.js";

/** A stand-in for Electron's window and its contents: its events, its window-open handler, and whether it was shown. */
function fakeWindow() {
  let destroyed = false, shown = 0;
  let openHandler: (() => { action: "deny" | "allow" }) | undefined;
  const emitter = new EventEmitter();
  type Session = PageWindow["webContents"]["session"];
  let requestHandler: Parameters<Session["setPermissionRequestHandler"]>[0] | undefined;
  let checkHandler: Parameters<Session["setPermissionCheckHandler"]>[0] | undefined;
  const session: Session = {
    setPermissionRequestHandler: (handler) => { requestHandler = handler; },
    setPermissionCheckHandler: (handler) => { checkHandler = handler; },
  };
  const contents = Object.assign(new EventEmitter(), { session, setWindowOpenHandler: (handler: () => { action: "deny" }) => { openHandler = handler; } });
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
    /** Ask for `permission` as a page would, returning what the session's handler granted (undefined when no handler answered). */
    request: (permission: string) => {
      let granted: boolean | undefined;
      requestHandler?.(contents, permission, (answer) => { granted = answer; });
      return granted;
    },
    /** Check `permission` as Chromium does before using it, returning the session's answer. */
    check: (permission: string) => checkHandler?.(contents, permission),
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

test("1.35 · the window's session grants only writing plain text to the clipboard, and refuses every other permission request and check", () => {
  const fake = fakeWindow();
  keepPageInWindow(fake.window, { headless: false });
  // The copy buttons' navigator.clipboard.writeText is asked and checked as clipboard-sanitized-write.
  assert.equal(fake.request("clipboard-sanitized-write"), true);
  assert.equal(fake.check("clipboard-sanitized-write"), true);
  for (const permission of ["media", "notifications", "geolocation", "clipboard-read", "openExternal", "fullscreen"]) {
    assert.equal(fake.request(permission), false, permission);
    assert.equal(fake.check(permission), false, permission);
  }
});
