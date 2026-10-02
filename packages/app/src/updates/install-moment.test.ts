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

// Capability 4 · Updates, contract 4.13 (ADR-0871 D2): the user chooses when a release may install itself.
const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

test("4.13 manual only never installs on its own; the user's say-so still does", () => {
  const manual = { ...quietLaunch, choice: { mode: "manual" } as const, minuteOfDay: minute("03:00") };
  assert.equal(whenToInstall(manual), "wait");
  assert.equal(whenToInstall({ ...manual, asked: true }), "now");
});

test("4.13 quiet hours install only inside the window, which may cross midnight, and only at a quiet moment there", () => {
  const hours = { ...quietLaunch, choice: { mode: "hours", from: "23:00", to: "06:00" } as const };
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("02:00") }), "now");
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("23:00") }), "now");
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("06:00") }), "wait");
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("12:00") }), "wait");
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("12:00"), asked: true }), "now");
  assert.equal(whenToInstall({ ...hours, minuteOfDay: minute("02:00"), windowActiveAt: quietLaunch.now - 30_000 }), "wait");
  const daytime = { ...quietLaunch, choice: { mode: "hours", from: "12:00", to: "13:30" } as const };
  assert.equal(whenToInstall({ ...daytime, minuteOfDay: minute("13:00") }), "now");
  assert.equal(whenToInstall({ ...daytime, minuteOfDay: minute("11:59") }), "wait");
});

test("4.13 with no choice made, a release installs at any quiet moment, as before", () => {
  assert.equal(whenToInstall({ ...quietLaunch, choice: { mode: "quiet" }, minuteOfDay: minute("14:00") }), "now");
});
