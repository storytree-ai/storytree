import assert from "node:assert/strict";
import { test } from "node:test";

import { QUIET_MS, SETTLE_MS, whenToInstall } from "./install-moment.js";

// Capability 4 · Updates, contract 4.4 (pending wording in evidence/winupdate/library-update): a
// downloaded release never restarts the app out from under someone using it. Seen on a reset
// Windows laptop: the app installed a release 17 seconds after first-run setup said it was open.
const launchedAt = 1_000_000_000;
const quietLaunch = { launchedAt, now: launchedAt + SETTLE_MS + QUIET_MS };

test("4.4 a downloaded release waits out the first minutes after a launch", () => {
  assert.equal(whenToInstall({ launchedAt, now: launchedAt + 17_000 }), "wait");
  assert.equal(whenToInstall({ launchedAt, now: launchedAt + SETTLE_MS - 1 }), "wait");
  assert.equal(whenToInstall({ launchedAt, now: launchedAt + SETTLE_MS }), "now");
});

test("4.4 a downloaded release waits while the window is in use or an agent is working", () => {
  const { now } = quietLaunch;
  assert.equal(whenToInstall({ ...quietLaunch, windowActiveAt: now - 30_000 }), "wait");
  assert.equal(whenToInstall({ ...quietLaunch, agentActiveAt: now - 30_000 }), "wait");
  assert.equal(whenToInstall({ ...quietLaunch, windowActiveAt: now - QUIET_MS, agentActiveAt: now - QUIET_MS }), "now");
});

test("4.4 the user's say-so installs at once, whatever else is going on", () => {
  assert.equal(whenToInstall({ launchedAt, now: launchedAt + 1_000, windowActiveAt: launchedAt + 1_000, agentActiveAt: launchedAt, asked: true }), "now");
});
