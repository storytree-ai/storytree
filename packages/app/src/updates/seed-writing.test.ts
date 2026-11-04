/**
 * Capability 4 · Updates, contract 4.8: a ready build restarts the app, and the restart stops the database, so it waits while a writing library script (`pnpm check:own-health`,
 * `pnpm library:restore`, which write into the running app's database) is connected: a restart mid-seed would cut it off (seen
 * 2026-09-27, when the updater restarted the app under a reseed). Against the Postgres `pnpm test`
 * provides, in a database of its own, so another unit's seed on the shared server is not this app's.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import pg from "pg";

import { SEED_CONNECTION } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { seedWriting } from "./seed-writing.js";

test("4.8 the restart into a new build waits while a seed is writing the app's library", async () => {
  const server = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(server, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const app = url.toString();
  // Another unit's seed, writing another database on the same server.
  const stranger = new pg.Client({ connectionString: server, application_name: SEED_CONNECTION });
  await stranger.connect();
  try {
    assert.equal(await seedWriting(app), false, "with no seed connected, the restart may go ahead");

    const seed = new pg.Client({ connectionString: app, application_name: SEED_CONNECTION });
    await seed.connect();
    try {
      assert.equal(await seedWriting(app), true, "while a seed is connected, the restart waits");
    } finally {
      await seed.end();
    }
    // The server lists a backend until it has finished leaving, a moment after its client's end().
    const deadline = Date.now() + 10_000;
    while (await seedWriting(app) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await seedWriting(app), false, "and once it has gone, it may go ahead");
  } finally {
    await stranger.end();
    await admin.end();
    await dropTestDatabases([name]);
  }
});
