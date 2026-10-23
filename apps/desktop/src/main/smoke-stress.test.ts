import assert from "node:assert/strict";
import { test } from "node:test";

import { stressWindow } from "./smoke-stress.js";

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
