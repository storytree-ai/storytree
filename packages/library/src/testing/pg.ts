/**
 * Helpers for tests that need a real Postgres.
 *
 * `pnpm test` (scripts/test.mjs) starts a throwaway local server and hands it to the tests as
 * STORYTREE_TEST_PG_URL; set that variable yourself to test against another server. A Postgres
 * test must never skip silently, so asking for the server when there is none throws.
 *
 * Some tests (capability 8's) also create roles and connect as the login ones without a password,
 * so the server must let them: the local test server trusts every local connection.
 */
import { randomBytes } from "node:crypto";

import pg from "pg";
import type { Client } from "pg";

/**
 * What uniqueProjectName() puts in every name; the only databases dropTestDatabases() and the only
 * roles dropTestRoles() will drop.
 */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** Something SQL can be run on: a pg Client or Pool. */
export interface Queryable {
  query(text: string): Promise<unknown>;
}

/** The server the tests run against. Throws when there is none. */
export function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres, " +
        "or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on.",
    );
  }
  return url;
}

/** A project name no other test, and no earlier run, is using: `t-` and 8 random hex digits. */
export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/**
 * Run `fn` with a client connected to `database` on the test server (to the server URL's own
 * database when omitted). The connection is independent of the code under test.
 */
export async function withTestClient<T>(
  fn: (client: Client) => Promise<T>,
  database?: string,
): Promise<T> {
  return withClient(undefined, fn, database);
}

/**
 * Run `fn` with a client signed in to the test server as `role`, connected to `database` (to the
 * server URL's own database when omitted). The connection is independent of the code under test,
 * and needs no password: the test server trusts local connections.
 */
export async function withTestClientAs<T>(
  role: string,
  fn: (client: Client) => Promise<T>,
  database?: string,
): Promise<T> {
  return withClient(role, fn, database);
}

async function withClient<T>(
  role: string | undefined,
  fn: (client: Client) => Promise<T>,
  database: string | undefined,
): Promise<T> {
  const url = new URL(testServerUrl());
  if (role !== undefined) url.username = role;
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drop a test's databases, ending any connection still open to them. Missing ones are skipped.
 * Only names carrying a uniqueProjectName() token are accepted, so a mistake in a test can never
 * drop somebody's real database on a shared server.
 *
 * They are dropped on the test server, or through `server` when given: a connection to another
 * server's own database (a Cloud SQL instance's, say).
 *
 * Through `server` signed in as a user that may not create databases, a project database that user
 * made by borrowing a role that may (capability 8) is the borrowed role's, and is dropped all the
 * same, as the user: DROP DATABASE takes a member holding its owner's rights by inheritance, as a
 * role granted with the default INHERIT does. It is deliberately not dropped AS that role (SET
 * ROLE): WITH (FORCE) could then not end the user's own sessions still open on it.
 */
export async function dropTestDatabases(databases: Iterable<string>, server?: Queryable): Promise<void> {
  const names = [...databases];
  for (const name of names) assertTestName("drop", "database", name);
  if (names.length === 0) return;
  const drop = async (client: Queryable): Promise<void> => {
    for (const name of names) {
      const sql = `DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`;
      try {
        await client.query(`${sql} WITH (FORCE)`);
      } catch (error) {
        if (typeof error !== "object" || error === null ||
          !("code" in error) || error.code !== "42501" ||
          !("routine" in error) || error.routine !== "TerminateOtherDBBackends") throw error;
        // FORCE can refuse an autovacuum worker (which has no login role). Plain DROP ends
        // autovacuum itself and waits for departing backends. Still fail if it cannot drop it.
        await client.query(sql);
      }
    }
  };
  if (server !== undefined) {
    await drop(server);
  } else {
    await withTestClient(drop);
  }
}

/**
 * Create a role on the test server, made by its superuser: a login role, for a test to connect as,
 * unless `login` is false. It may create databases only when `createdb` is set, and roles only when
 * `createrole` is, without being a superuser (as a Cloud SQL instance's `postgres` user may). It has
 * no password: the test server trusts local connections. Its name must carry a uniqueProjectName()
 * token, like every role dropTestRoles() will drop.
 */
export async function createTestRole(
  name: string,
  options: { readonly createdb: boolean; readonly login?: boolean; readonly createrole?: boolean },
): Promise<void> {
  assertTestName("create", "role", name);
  const attributes = [
    options.login === false ? "NOLOGIN" : "LOGIN",
    options.createdb ? "CREATEDB" : "NOCREATEDB",
    options.createrole === true ? "CREATEROLE" : "NOCREATEROLE",
  ];
  await withTestClient(async (client) => {
    await client.query(`CREATE ROLE ${quoteIdentifier(name)} ${attributes.join(" ")}`);
  });
}

/**
 * Drop a test's roles, in the order given. Missing ones are skipped. A role that still owns a
 * database cannot be dropped, so drop the test's databases first; nor can one that granted a
 * membership still standing, so give a role's members and the role before whoever granted it.
 * Only names carrying a uniqueProjectName() token are accepted, so a mistake in a test can never
 * drop somebody's real role on a shared server.
 */
export async function dropTestRoles(roles: Iterable<string>): Promise<void> {
  const names = [...roles];
  for (const name of names) assertTestName("drop", "role", name);
  if (names.length === 0) return;
  await withTestClient(async (client) => {
    for (const name of names) await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(name)}`);
  });
}

function assertTestName(action: "create" | "drop", what: "database" | "role", name: string): void {
  if (!TEST_TOKEN.test(name)) {
    throw new Error(`refusing to ${action} ${what} ${JSON.stringify(name)}: test ${what}s are named with uniqueProjectName()`);
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
