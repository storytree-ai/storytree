import assert from "node:assert/strict";
import { test } from "node:test";

import { stressWindow, windowSteps } from "./smoke-stress.js";

test("1.30 · the smoke check's stress closes the window, reopens it, closes it while it loads, and leaves one loading for the quit", async () => {
  const steps: string[] = [];
  let opened = 0;
  const last = await stressWindow("first", 2, {
    open: () => { const name = `w${++opened}`; steps.push(`open ${name}`); return name; },
    loaded: async (window) => { steps.push(`loaded ${window}`); },
    close: async (window) => { steps.push(`close ${window}`); },
    log: () => {},
  });
  assert.deepEqual(steps, [
    "close first", "open w1", "close w1", "open w2", "loaded w2",
    "close w2", "open w3", "close w3", "open w4", "loaded w4",
    "close w4", "open w5",
  ]);
  assert.equal(last, "w5", "the last window is left loading, for the quit to land during its load");
});

test("1.30 · with no rounds asked the stress touches nothing", async () => {
  const touched: string[] = [];
  const last = await stressWindow("first", 0, {
    open: () => { touched.push("open"); return "x"; },
    loaded: async () => { touched.push("loaded"); },
    close: async () => { touched.push("close"); },
    log: () => {},
  });
  assert.equal(last, "first");
  assert.deepEqual(touched, []);
});

test("1.30 · the stress's window steps open the window again through the app's reopening, and never touch a destroyed window", async () => {
  const touched: string[] = [];
  const fake = (name: string, destroyed = false) => {
    const window = {
      destroyed,
      isDestroyed: () => window.destroyed,
      once: (_event: "closed", listener: () => void) => { window.closed = listener; },
      closed: undefined as undefined | (() => void),
      close: () => {
        if (window.destroyed) throw new TypeError("Object has been destroyed");
        touched.push(`close ${name}`);
        window.destroyed = true;
        window.closed?.();
      },
    };
    return window;
  };
  const gone = fake("gone", true);
  const live = fake("live");
  let all = [gone];
  const steps = windowSteps({
    windows: () => all,
    reopen: () => { touched.push("reopen"); all = [gone, live]; },
    loaded: async (window) => { touched.push(`loaded ${window === live ? "live" : "gone"}`); },
    log: () => {},
  });
  await steps.close(gone);
  await steps.loaded(gone);
  assert.equal(steps.open(), live, "the window opened is the one still alive");
  await steps.loaded(live);
  await steps.close(live);
  assert.deepEqual(touched, ["reopen", "loaded live", "close live"]);

  all = [gone];
  const none = windowSteps({ windows: () => all, reopen: () => {}, loaded: async () => {}, log: () => {} });
  assert.throws(() => none.open(), /did not open again/);
});
