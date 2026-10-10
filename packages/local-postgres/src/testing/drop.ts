/**
 * Dropping a throwaway test database: the one place every package's tests do it (capability 3).
 *
 * The test server is the one `pnpm test` starts (packages/dev-loop/src/test.mjs), or the one
 * STORYTREE_TEST_PG_URL names. Databases are dropped as the harness's superuser,
 * STORYTREE_TEST_PG_ADMIN_URL, when it is set: the ordinary role cannot end a backend another role
 * holds on the database, and FORCE then refuses. Keep this module small: most packages' tests
 * depend on it, so a change here scopes almost the whole test run (ADR-0649 D4).
 */
import pg from "pg";

/** What every test database's name carries: `t-` and 8 hex digits, as a uniqueProjectName() gives. */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** How many more times a drop is tried while the database is still being accessed. */
const DEPARTED_RETRIES = 5;

/** Something SQL can be run on: a pg Client or Pool. */
export interface Queryable {
  query(text: string): Promise<unknown>;
}

/**
 * Drop these databases, ending any connection still open to them. Missing ones are skipped. Only
 * names carrying a test token are accepted, so a mistake in a test can never drop somebody's real
 * database on a shared server; any other name is refused before anything is sent.
 *
 * They are dropped on the test server as its superuser, or through `server` when given: a
 * connection to another server's own database (a Cloud SQL instance's, say).
 */
export async function dropTestDatabases(databases: Iterable<string>, server?: Queryable): Promise<void> {
  const names = [...databases];
  for (const name of names) {
    if (!TEST_TOKEN.test(name)) {
      throw new Error(`refusing to drop database ${JSON.stringify(name)}: test databases are named with uniqueProjectName()`);
    }
  }
  if (names.length === 0) return;
  if (server !== undefined) {
    for (const name of names) await drop(server, name);
    return;
  }
  const client = new pg.Client({ connectionString: testAdminUrl() });
  await client.connect();
  try {
    for (const name of names) await drop(client, name);
  } finally {
    await client.end();
  }
}

async function drop(client: Queryable, name: string): Promise<void> {
  const sql = `DROP DATABASE IF EXISTS "${name.replaceAll('"', '""')}"`;
  let statement = `${sql} WITH (FORCE)`;
  let retries = 0;
  for (;;) {
    try {
      await client.query(statement);
      return;
    } catch (error) {
      if (statement !== sql && isError(error, "42501", "TerminateOtherDBBackends")) {
        // FORCE can refuse an autovacuum worker (which has no login role). Plain DROP ends
        // autovacuum itself and waits for departing backends. Still fail if it cannot drop it.
        statement = sql;
      } else if (isError(error, "55006", "dropdb") && retries++ < DEPARTED_RETRIES) {
        // A backend still leaving after DROP's own 5-second wait (a terminated one on Windows
        // has been seen to): try again, a bounded number of times, then fail.
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        throw error;
      }
    }
  }
}

/** The test server signed in as its superuser, or as its client when no superuser was given. */
function testAdminUrl(): string {
  const url = process.env["STORYTREE_TEST_PG_ADMIN_URL"] || process.env["STORYTREE_TEST_PG_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres, " +
        "or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on.",
    );
  }
  return url;
}

function isError(error: unknown, code: string, routine: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === code && "routine" in error && error.routine === routine;
}
