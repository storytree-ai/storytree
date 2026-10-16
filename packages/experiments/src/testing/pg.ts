/**
 * Helpers for the Experiments story's tests, which run against the real Postgres `pnpm test` starts (packages/dev-loop/
 * src/test.mjs hands it over as STORYTREE_TEST_PG_URL, its superuser as STORYTREE_TEST_PG_ADMIN_URL when that differs).
 * A Postgres test must never skip silently, so asking for the server when there is none throws. Restated from the
 * library's, as the library keeps its own helpers inside its package.
 */
import pg from "pg";

/** The test server signed in as its superuser, the cluster's admin here. Throws when there is none. */
export function testAdminUrl(): string {
  const admin = process.env.STORYTREE_TEST_PG_ADMIN_URL;
  if (admin !== undefined && admin !== "") return admin;
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

/** Run `fn` with a client signed in as the admin, on `database` (the admin URL's own when omitted), closed afterwards. */
export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>, database?: string): Promise<T> {
  const url = new URL(testAdminUrl());
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
