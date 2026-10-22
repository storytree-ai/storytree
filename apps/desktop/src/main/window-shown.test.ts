import assert from "node:assert/strict";
import { test } from "node:test";

import { bringWindowForward, type ShownWindow } from "./window-shown.js";

/** A stand-in for Electron's window: each call it took, and every call throws once it is destroyed, as BrowserWindow's do. */
function fakeWindow(name: string, { minimized = false, destroyed = false } = {}) {
  const calls: string[] = [];
  const act = (call: string) => () => {
    if (destroyed) throw new TypeError("Object has been destroyed");
    calls.push(`${name} ${call}`);
  };
  const window: ShownWindow = { isDestroyed: () => destroyed, isMinimized: () => minimized, restore: act("restore"), show: act("show"), focus: act("focus") };
  return { window, calls };
}

test("1.27 · bringing the window forward restores, shows and focuses the open one", () => {
  const open = fakeWindow("open", { minimized: true });
  bringWindowForward([open.window], { stopping: false, open: () => assert.fail("no second window is opened beside an open one") });
  assert.deepEqual(open.calls, ["open restore", "open show", "open focus"]);
});

test("1.27 · with the window closed, or only a destroyed one left, the window is opened again; while the app is quitting none is touched or opened", () => {
  const reopened = fakeWindow("reopened");
  bringWindowForward([], { stopping: false, open: () => reopened.window });
  assert.deepEqual(reopened.calls, ["reopened show", "reopened focus"]);

  const destroyed = fakeWindow("destroyed", { destroyed: true });
  const again = fakeWindow("again");
  assert.doesNotThrow(() => bringWindowForward([destroyed.window], { stopping: false, open: () => again.window }));
  assert.deepEqual(again.calls, ["again show", "again focus"]);

  const live = fakeWindow("live");
  bringWindowForward([live.window], { stopping: true, open: () => assert.fail("no window opens while the app is quitting") });
  assert.deepEqual(live.calls, []);
});
