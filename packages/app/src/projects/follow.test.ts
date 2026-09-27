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

test("2.2, 2.3 a transient read or picker failure can redraw the unchanged project after recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = false;
  let draws = 0;
  const errors: unknown[] = [];
  const follow = followProjects({
    read: async () => {
      if (fail) throw new Error("temporary read failure");
      return { projects: ["site"], current: "site" };
    },
    onChange: () => { draws++; },
    onError: (error) => { errors.push(error); },
  });
  t.after(() => follow.stop());
  await follow.refresh();
  fail = true;
  await follow.refresh();
  assert.equal(errors.length, 1);
  fail = false;
  await follow.refresh();
  assert.equal(draws, 2, "a failed read invalidates the old render");
  await follow.refresh(true);
  assert.equal(draws, 3, "a picker error that replaced the surface can request a redraw");
});
