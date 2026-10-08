// The test Postgres a `pnpm test` run starts (packages/dev-loop/src/test-postgres.mjs). Seen
// 2026-10-08 (friction_eba7a221f43b): a run with local-postgres's `password: true` converted
// .pgtest/data to SCRAM, and the next passwordless run reused it, so every Postgres test failed
// with "client password must be a string". These start real clusters in a scratch directory.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { start } from "@storytree/local-postgres";
import pg from "pg";

import { startTestPostgres } from "./test-postgres.mjs";

/** A scratch data directory, removed after the test once every server stopLater was given has stopped (Windows holds a live cluster's files). */
function scratchCluster(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "st-test-postgres-"));
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dataDir: path.join(dir, "data"), stopLater: (server) => (servers.push(server), server) };
}

test("6.9 a passwordless run given a cluster that demands a password makes a fresh one, and its tests connect", { timeout: 120_000 }, async (t) => {
  const { dataDir, stopLater } = scratchCluster(t);
  await (await start({ dataDir, password: true })).stop();

  const said = [];
  const server = stopLater(await startTestPostgres({ dataDir, log: (line) => said.push(line) }));
  const client = new pg.Client({ connectionString: server.url });
  await client.connect();
  try {
    assert.equal((await client.query("SELECT 1 AS one")).rows[0].one, 1);
  } finally {
    await client.end();
  }
  assert.match(said.join("\n"), /asks for a password/, "and it says why it made a fresh cluster");
});

test("6.9 a passwordless run keeps a cluster that trusts it", { timeout: 120_000 }, async (t) => {
  const { dataDir, stopLater } = scratchCluster(t);
  const first = await start({ dataDir });
  const client = new pg.Client({ connectionString: first.url });
  await client.connect();
  await client.query("CREATE TABLE kept (id int)");
  await client.end();
  await first.stop();

  const said = [];
  const server = stopLater(await startTestPostgres({ dataDir, log: (line) => said.push(line) }));
  const again = new pg.Client({ connectionString: server.url });
  await again.connect();
  try {
    assert.equal((await again.query("SELECT to_regclass('kept') IS NOT NULL AS kept")).rows[0].kept, true, "the same cluster, not a fresh one");
  } finally {
    await again.end();
  }
  assert.doesNotMatch(said.join("\n"), /asks for a password/);
});
