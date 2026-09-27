import assert from "node:assert/strict";
import { test } from "node:test";

import { followProjects } from "./follow.js";
import type { ProjectSelection } from "./selection.js";

test("2.2 the list is reread every three seconds, unchanged reads leave the surface alone, and stopping ends polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let state: ProjectSelection = { projects: [], current: undefined };
  let reads = 0;
  const seen: ProjectSelection[] = [];
  const follow = followProjects({
    read: async () => { reads++; return state; },
    onChange: (next) => { seen.push(next); },
    onError: (error) => { throw error; },
  });
  await follow.refresh();
  assert.equal(reads, 1);
  state = { projects: ["site"], current: "site" };
  t.mock.timers.tick(3000);
  await follow.refresh();
  assert.deepEqual(seen, [{ projects: [], current: undefined }, state]);
  t.mock.timers.tick(3000);
  await follow.refresh();
  assert.equal(reads, 3);
  assert.equal(seen.length, 2);
  follow.stop();
  t.mock.timers.tick(3000);
  assert.equal(reads, 3);
});
