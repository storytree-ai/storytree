import { randomBytes } from "node:crypto";

import { connect, type Library } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

export function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

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
