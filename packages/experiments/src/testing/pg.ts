/**
 * Helpers for the Experiments story's tests, which run against the real Postgres `pnpm test` starts (packages/repo-checks/
 * src/test.mjs hands it over as STORYTREE_TEST_PG_URL, its superuser as STORYTREE_TEST_PG_ADMIN_URL when that differs):
 * a fresh project's library, or the server signed in as its admin. A Postgres test must never skip silently, so asking
 * for the server when there is none throws. Restated from quality assurance's and the library's, as each story keeps its own.
 */
import { randomBytes } from "node:crypto";

import pg from "pg";

import { connect, type Library, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

/** Run `body` with a fresh project's library and the server it is on, the project dropped afterwards, pass or fail. */
export async function withLibrary(body: (library: Library, server: Storytree) => Promise<void>): Promise<void> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const library = await storytree.openProject(project);
    try {
      await body(library, storytree);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
  }
}

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
