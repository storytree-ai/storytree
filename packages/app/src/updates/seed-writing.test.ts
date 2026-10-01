/**
 * Capability 4 · Updates, contract 4.1: when merged main moves, the app restarts into the new build.
 * The restart stops the database, so it waits while a writing library script (`pnpm check:own-health`,
 * `pnpm library:restore`, which write into the running app's database) is connected: a restart mid-seed would cut it off (seen
 * 2026-09-27, when the updater restarted the app under a reseed). Against the Postgres `pnpm test`
 * provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import pg from "pg";

import { SEED_CONNECTION } from "@storytree/library";
import { seedWriting } from "./seed-writing.js";

test("4.1 the restart into a new build waits while a seed is writing the app's library", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  assert.equal(await seedWriting(url), false, "with no seed connected, the restart may go ahead");

  const seed = new pg.Client({ connectionString: url, application_name: SEED_CONNECTION });
  await seed.connect();
  try {
    assert.equal(await seedWriting(url), true, "while a seed is connected, the restart waits");
  } finally {
    await seed.end();
  }
  assert.equal(await seedWriting(url), false, "and once it has gone, it may go ahead");
});
