/**
 * Capability 1 · Lifecycle, contract 1.43: the order the app stops what it holds. The parts are stand-ins that record
 * each call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { appShutdown } from "./stopping.js";

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
