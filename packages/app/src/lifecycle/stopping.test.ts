/**
 * Capability 1 · Lifecycle, contracts 1.43 and 1.44: the order the app stops what it holds, and when it may restart
 * itself. The parts are stand-ins that record each call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { appShutdown, restartAllowed } from "./stopping.js";

function parts(failing: readonly string[] = []) {
  const calls: string[] = [];
  const errors: string[] = [];
  const step = (name: string) => async () => {
    calls.push(name);
    if (failing.includes(name)) throw new Error(`${name} broke`);
  };
  const held: {
    backups?: { stop(): void };
    journey?: { finish(): Promise<void> };
    reads?: { close(): Promise<void> };
    library?: { close(): Promise<void> };
    postgres?: { stop(): Promise<void> };
  } = {
    backups: { stop: () => { calls.push("backups"); } },
    journey: { finish: step("journey") },
    reads: { close: step("reads") },
    library: { close: step("library") },
    postgres: { stop: step("postgres") },
  };
  const shutdown = appShutdown({
    backups: { held: () => held.backups },
    journey: { held: () => held.journey },
    reads: { held: () => held.reads, letGo: () => { delete held.reads; } },
    library: { held: () => held.library, letGo: () => { delete held.library; } },
    postgres: { held: () => held.postgres, letGo: () => { delete held.postgres; } },
    error: (line) => errors.push(line),
  });
  return { calls, errors, held, shutdown };
}

test("1.43 quitting stops the journey, then the page reads, then the library, then Postgres, once however often it is asked, and lets each go", async () => {
  const { calls, held, shutdown } = parts();
  assert.equal(shutdown.stopping(), false);
  const first = shutdown.shutdown();
  assert.equal(shutdown.stopping(), true, "a shutdown has begun as soon as it is asked for");
  const second = shutdown.shutdown();
  await Promise.all([first, second]);
  assert.deepEqual(calls.filter((call) => call !== "backups"), ["journey", "reads", "library", "postgres"], "the parts stop once, in order");
  assert.equal(calls.filter((call) => call === "backups").length, 2, "the backups are told to stop each time");
  assert.deepEqual(Object.keys(held), ["backups", "journey"], "the reads, the library and Postgres are let go once stopped");
});

test("1.43 a part that fails to stop is said, and the next stops all the same", async () => {
  const { calls, errors, shutdown } = parts(["reads", "library", "postgres"]);
  await shutdown.shutdown();
  assert.deepEqual(calls, ["backups", "journey", "reads", "library", "postgres"]);
  assert.deepEqual(errors, ["closing the projects: reads broke", "closing the library: library broke", "stopping Postgres: postgres broke"]);
});

test("1.44 the app restarts itself only while it is not stopping, no seed is being written to its Postgres, and no backup holds it", async () => {
  const state = { stopping: false, url: "postgres://own" as string | undefined, seed: false, backups: undefined as { canRestart(): boolean } | undefined };
  const asked: string[] = [];
  const may = restartAllowed({
    stopping: () => state.stopping,
    postgresUrl: () => state.url,
    seedWriting: async (url) => { asked.push(url); return state.seed; },
    backups: () => state.backups,
  });
  assert.equal(await may(), true);
  assert.deepEqual(asked, ["postgres://own"], "the seed check asks the app's own Postgres");
  state.seed = true;
  assert.equal(await may(), false, "a seed being written holds it");
  state.url = undefined;
  assert.equal(await may(), true, "with no Postgres of its own there is no seed to wait for");
  state.backups = { canRestart: () => true };
  assert.equal(await may(), true, "backups not being written let it through, as no backups do");
  state.backups = { canRestart: () => false };
  assert.equal(await may(), false, "a backup holds it");
  state.backups = undefined;
  state.stopping = true;
  assert.equal(await may(), false, "a stopping app never restarts");
});

test("1.44 a shutdown begun while the seed check is answering holds the restart", async () => {
  let stopping = false;
  const may = restartAllowed({
    stopping: () => stopping,
    postgresUrl: () => "postgres://own",
    seedWriting: async () => { stopping = true; return false; },
    backups: () => undefined,
  });
  assert.equal(await may(), false);
});
