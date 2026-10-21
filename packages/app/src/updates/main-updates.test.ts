import assert from "node:assert/strict";
import { test } from "node:test";
import { mainUpdates, UPDATE_EVERY_MS } from "./main-updates.js";
import type { RunningBuild } from "./follow-main.js";
import type { InstallChoice } from "./install-choice.js";
import { QUIET_MS, quietMoment, SETTLE_MS } from "./install-moment.js";

// Capability 4 · Updates: pending contracts 4.7–4.10 in evidence/gear-updates/library-update.
const running: RunningBuild = { slot: "a", dir: "/runtime/a", sha: "1234567890" };
const next: RunningBuild = { slot: "b", dir: "/runtime/b", sha: "abcdef1234" };
const base = { runtimeDir: "/runtime", running, runningBuild: "main 1234567", canRestart: async () => true };

test("4.7 asking checks now, joins an ongoing automatic check, and reports up to date with the running build", async () => {
  let calls = 0;
  const fetched = deferred<undefined>();
  const updates = mainUpdates({ ...base, update: async () => { calls++; return fetched.promise; }, restart: async () => assert.fail("no restart") });
  assert.equal(updates.request("check").phase, "checking");
  const checking = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(updates.request("status").phase, "checking", "reading status does not start another check");
  fetched.resolve(undefined);
  assert.deepEqual(await checking, { phase: "up-to-date", runningBuild: "main 1234567" });
  assert.equal(calls, 1);
  updates.stop();
});

test("4.8 a new build reports building, waits for a library seed, then restarts once without rebuilding", async () => {
  let writing = true, calls = 0;
  const built = deferred<RunningBuild>();
  const restarted: RunningBuild[] = [];
  const updates = mainUpdates({ ...base, canRestart: async () => !writing,
    update: async (options) => { calls++; options.onBuilding?.(next.sha); return built.promise; },
    restart: async target => { assert.equal(updates.request("status").phase, "restarting"); restarted.push(target); },
  });
  const checking = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.request("status").phase, "building");
  built.resolve(next);
  assert.equal((await checking).phase, "ready");
  assert.deepEqual(restarted, []);
  writing = false;
  await updates.check();
  await updates.check();
  assert.deepEqual(restarted, [next]);
  assert.equal(calls, 1);
  updates.stop();
});

test("4.9 a failed build reports its reason, leaves the running app alone, and can be retried", async () => {
  let calls = 0;
  const updates = mainUpdates({ ...base, update: async () => { if (++calls === 1) throw new Error("pnpm build: missing module"); return undefined; }, restart: async () => assert.fail("no restart") });
  assert.deepEqual(await updates.check(), { phase: "failed", runningBuild: "main 1234567", reason: "pnpm build: missing module" });
  assert.equal((await updates.check()).phase, "up-to-date");
  updates.stop();
});

test("4.10 a checkout explains that it does not update itself and never fetches or restarts", async () => {
  const updates = mainUpdates({ runtimeDir: "/runtime", runningBuild: "development build", canRestart: async () => true,
    update: async () => assert.fail("no fetch"), restart: async () => assert.fail("no restart") });
  assert.deepEqual(await updates.check(), { phase: "unavailable", runningBuild: "development build" });
  updates.stop();
});

test("stopping during a build prevents a late restart", async () => {
  const built = deferred<RunningBuild>();
  const updates = mainUpdates({ ...base, update: () => built.promise, restart: async () => assert.fail("no restart after stop") });
  const checking = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  updates.stop();
  built.resolve(next);
  await checking;
});

test("background checks remain periodic, wait for the initial health write, and stop with the app", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const health = deferred<void>();
  let calls = 0;
  const updates = mainUpdates({ ...base, prepare: () => health.promise,
    update: async () => { calls++; return undefined; }, restart: async () => assert.fail("no restart") });
  updates.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0, "even a manual check waits for the initial health write");
  const manual = updates.check();
  health.resolve(undefined);
  await manual;
  assert.equal(calls, 1);
  t.mock.timers.tick(UPDATE_EVERY_MS);
  await updates.check();
  assert.equal(calls, 2, "the three-minute timer still checks");
  updates.stop();
  t.mock.timers.tick(UPDATE_EVERY_MS);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("4.8 a seed that starts during the restart notice also holds the ready build", async () => {
  let guards = 0, restarts = 0;
  const updates = mainUpdates({ ...base, update: async () => next,
    canRestart: async () => ++guards !== 2, restart: async () => { restarts++; } });
  assert.equal((await updates.check()).phase, "ready");
  assert.equal(restarts, 0);
  assert.equal((await updates.check()).phase, "restarting");
  assert.equal(restarts, 1);
  updates.stop();
});

// Capability 4 · Updates, contract 4.4: a merged-main build restarts the app only at the moment
// the user's install choice allows (4.13), as a downloaded release does. Owner, 2026-10-21: the
// follow-main app "keeps closing on me".
test("4.4 a new main build waits while the window is in use, then restarts at the first quiet check", async () => {
  const launchedAt = 1_000_000_000;
  let now = launchedAt + SETTLE_MS + QUIET_MS, usedAt: number | undefined = now - 2 * 60_000;
  const restarted: RunningBuild[] = [];
  const updates = mainUpdates({ ...base, update: async () => next, restart: async target => { restarted.push(target); },
    quiet: quietMoment({ launchedAt, now: () => new Date(now), choice: () => ({ mode: "quiet" }),
      windowActiveAt: () => usedAt, agentActiveAt: async () => undefined }) });
  assert.equal((await updates.check()).phase, "pending", "the window was used two minutes ago");
  assert.deepEqual(restarted, []);
  now += 5 * 60_000;
  assert.equal((await updates.check()).phase, "pending", "still within ten minutes of that use");
  usedAt = undefined;
  assert.equal((await updates.check()).phase, "restarting");
  assert.deepEqual(restarted, [next]);
  updates.stop();
});

test("4.13 with updates installed only when the user says, a main build waits until Restart to update", async () => {
  const launchedAt = 1_000_000_000;
  const choice: InstallChoice = { mode: "manual" };
  let restarts = 0;
  const updates = mainUpdates({ ...base, update: async () => next, restart: async () => { restarts++; },
    quiet: quietMoment({ launchedAt, now: () => new Date(launchedAt + 24 * 60 * 60_000), choice: () => choice,
      windowActiveAt: () => undefined, agentActiveAt: async () => undefined }) });
  assert.equal((await updates.check()).phase, "pending", "a quiet app still waits in manual mode");
  assert.equal((await updates.check()).phase, "pending");
  assert.equal(restarts, 0);
  updates.request("install");
  await updates.check();
  assert.equal(restarts, 1, "Restart to update installs at once");
  updates.stop();
});

test("4.4 Restart to update still waits for a library seed", async () => {
  let writing = true, restarts = 0;
  const updates = mainUpdates({ ...base, update: async () => next, canRestart: async () => !writing,
    restart: async () => { restarts++; }, quiet: async () => false });
  assert.equal((await updates.check()).phase, "pending");
  updates.request("install");
  assert.equal((await updates.check()).phase, "ready", "the seed holds even the user's restart");
  assert.equal(restarts, 0);
  writing = false;
  await updates.check();
  assert.equal(restarts, 1);
  updates.stop();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
