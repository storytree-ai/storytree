// Capability 4 · Updates
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import pg from "pg";

import { SEED_CONNECTION } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { waitUntil } from "@storytree/test-waits";
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
    await waitUntil(async () => !(await seedWriting(app)), 10_000, "the restart to go ahead once the seed has gone");
  } finally {
    await stranger.end();
    await admin.end();
    await dropTestDatabases([name]);
  }
});
