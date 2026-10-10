// Capability 3: dropping a throwaway test database, against the server `pnpm test` starts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import pg from "pg";

import { dropTestDatabases } from "./drop.js";

const testName = (): string => `t-${randomBytes(4).toString("hex")}`;

function adminUrl(database?: string): string {
  const url = new URL(process.env["STORYTREE_TEST_PG_ADMIN_URL"] || process.env["STORYTREE_TEST_PG_URL"] || "");
  if (database !== undefined) url.pathname = `/${database}`;
  return url.href;
}

test("3.1 only a database named with a test token is dropped; any other name is refused before anything is sent to the server", async () => {
  let sent = 0;
  const server = { query: async () => { sent++; } };
  await assert.rejects(dropTestDatabases([testName(), "storytree_storytree"], server), /refusing to drop database "storytree_storytree"/);
  assert.equal(sent, 0);
  await dropTestDatabases([`storytree_${testName()}`], server);
  assert.equal(sent, 1);
});

test("3.2 a drop ends the connections still open to the database, and a missing one is skipped", async () => {
  const name = testName();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const open = new pg.Client({ connectionString: adminUrl(name) });
    open.on("error", () => {});
    await open.connect();
    await dropTestDatabases([name, testName()]);
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    assert.equal(rows.length, 0);
    await open.end().catch(() => {});
  } finally {
    await admin.end();
  }
});

test("3.2 a drop falls back to a plain DROP when Postgres refuses to end another backend, and propagates a database still in use after a bounded number of tries", async () => {
  const termination = Object.assign(new Error("permission denied to terminate process"), {
    code: "42501", routine: "TerminateOtherDBBackends",
  });
  const occupied = Object.assign(new Error("database is being accessed by other users"), { code: "55006", routine: "dropdb" });
  const statements: string[] = [];
  await assert.rejects(dropTestDatabases([testName()], {
    query: async (text: string) => { statements.push(text); throw statements.length === 1 ? termination : occupied; },
  }), (caught: unknown) => caught === occupied);
  assert.equal(statements.length, 7, "FORCE, then plain DROP and its five retries");
  assert.match(statements[0]!, /WITH \(FORCE\)$/);
  assert.doesNotMatch(statements[1]!, /FORCE/);
});

test("3.2 a drop propagates every other error at once", async () => {
  for (const error of [
    Object.assign(new Error("must be owner of database"), { code: "42501", routine: "dropdb" }),
    Object.assign(new Error("database has prepared transactions"), { code: "55006", routine: "TerminateOtherDBBackends" }),
  ]) {
    let attempts = 0;
    await assert.rejects(dropTestDatabases([testName()], {
      query: async () => { attempts++; throw error; },
    }), (caught: unknown) => caught === error);
    assert.equal(attempts, 1);
  }
});
