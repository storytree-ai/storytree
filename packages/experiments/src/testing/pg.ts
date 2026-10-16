/**
 * Helpers for the Experiments story's tests that need a library: a fresh project on the real Postgres `pnpm test` starts
 * (packages/dev-loop/src/test.mjs hands it over as STORYTREE_TEST_PG_URL). A Postgres test must never skip silently, so
 * asking for the server when there is none throws. Restated from quality assurance's, as each story keeps its own.
 */
import { randomBytes } from "node:crypto";

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
