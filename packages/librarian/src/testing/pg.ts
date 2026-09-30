/**
 * Helpers for the librarian's tests, which run against the real Postgres `pnpm test` starts
 * (packages/dev-loop/src/test.mjs hands it over as STORYTREE_TEST_PG_URL). A Postgres test must never skip
 * silently, so asking for the server when there is none throws. The library keeps its own helpers
 * inside its package, so the few needed here are restated, as the agent link's are.
 */
import { randomBytes } from "node:crypto";

import { connect, type Library } from "@storytree/library";
import pg from "pg";

/** What uniqueProjectName() puts in every name; the only databases the helpers will drop. */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** The server the tests run against. Throws when there is none. */
export function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

/** Run `body` with a fresh project's library, dropped afterwards, pass or fail. */
export async function withLibrary(body: (library: Library) => Promise<void>): Promise<void> {
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    try {
      await body(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProject(project);
  }
}

async function dropTestProject(name: string): Promise<void> {
  if (!TEST_TOKEN.test(name)) throw new Error(`refusing to drop project ${JSON.stringify(name)}: it is not a test project`);
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
