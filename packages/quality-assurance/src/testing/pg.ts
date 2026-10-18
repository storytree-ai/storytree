/**
 * Helpers for quality assurance's tests, which run against the real Postgres `pnpm test` starts
 * (packages/dev-loop/src/test.mjs hands it over as STORYTREE_TEST_PG_URL). A Postgres test must never skip
 * silently, so asking for the server when there is none throws. Restated from the librarian's, as the
 * library keeps its own helpers inside its package.
 */
import { randomBytes } from "node:crypto";

import { connect, type Library, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

/** The server the tests run against. Throws when there is none. */
export function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

/** Run `body` with two connections to the test server, each closed afterwards, pass or fail. */
export async function withConnections(body: (first: Storytree, second: Storytree) => Promise<void>): Promise<void> {
  const first = await connect({ url: testServerUrl() });
  try {
    const second = await connect({ url: testServerUrl() });
    try {
      await body(first, second);
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
}

/** Run `body` with a fresh project's library and the connection it is opened on, dropped afterwards, pass or fail. */
export async function withLibrary(body: (library: Library, storytree: Storytree) => Promise<void>): Promise<void> {
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url: testServerUrl() });
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
