/**
 * Helpers for the friction tests, which run against the real Postgres `pnpm test` starts
 * (packages/repo-checks/src/test.mjs hands it over as STORYTREE_TEST_PG_URL). A Postgres test must never skip
 * silently, so asking for the server when there is none throws. Restated from the library's, as each story
 * keeps its own helpers inside its package.
 */
import { randomBytes } from "node:crypto";

import { connect, type Library } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

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
    await dropTestDatabases([`storytree_${project}`]);
  }
}

/**
 * Run `body` with a fresh product project's library, opened after it named a fresh factory (ADR-1040), and the
 * factory's; both dropped afterwards, pass or fail.
 */
export async function withProduct(body: (product: Library, factory: Library) => Promise<void>): Promise<void> {
  const [factoryName, productName] = [`t-${randomBytes(4).toString("hex")}`, `t-${randomBytes(4).toString("hex")}`];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const factory = await storytree.openProject(factoryName);
    try {
      await factory.markFactory();
      const naming = await storytree.openProject(productName);
      await naming.recordFactory(factoryName);
      await naming.close();
      const product = await storytree.openProject(productName);
      try {
        await body(product, factory);
      } finally {
        await product.close();
      }
    } finally {
      await factory.close();
    }
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${factoryName}`, `storytree_${productName}`]);
  }
}
