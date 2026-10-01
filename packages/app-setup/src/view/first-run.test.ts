import assert from "node:assert/strict";
import { test } from "node:test";

import { guideOffered, rememberGuideDismissed } from "./first-run.js";

test("3.1 the guide is offered at launch, with no project needed, until it is dismissed once; a launch that cannot remember offers it", () => {
  const kept = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } });

  assert.equal(guideOffered(storage), true, "a first launch offers it");
  rememberGuideDismissed(storage);
  assert.equal(guideOffered(storage), false, "dismissed once, it is not offered again; Help still opens it");

  const unavailable = () => { throw new Error("storage disabled"); };
  assert.equal(guideOffered(unavailable), true);
  assert.doesNotThrow(() => rememberGuideDismissed(unavailable), "Help stays usable without preference storage");
});
