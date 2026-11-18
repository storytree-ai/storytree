// Capability 3 · Story node render
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { paintedScenes } from "./painted-scenes.js";

async function resolved(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => { done = true; });
  await setImmediate();
  return done;
}

test("3.75 · the globe says when it has painted a frame of the scene on show, including a show that changed nothing", async () => {
  const kept = { name: "kept" }, fresh = { name: "fresh" };
  const scenes = paintedScenes<object>(kept);
  const keptDrawn = scenes.drawn();
  assert.equal(await resolved(keptDrawn), false, "nothing is painted yet");
  scenes.shown(kept);
  scenes.painted(kept);
  assert.equal(await resolved(keptDrawn), true);
  assert.equal(await resolved(scenes.drawn()), true, "a scene already painted is drawn at once");

  scenes.shown(fresh);
  const freshDrawn = scenes.drawn();
  scenes.painted(kept);
  assert.equal(await resolved(freshDrawn), false, "a frame of the scene before does not count");
  scenes.painted(fresh);
  assert.equal(await resolved(freshDrawn), true);
});
