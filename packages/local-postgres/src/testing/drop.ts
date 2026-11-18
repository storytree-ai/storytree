// Capability 3 · Dropping a throwaway test database
import pg from "pg";

const TEST_TOKEN = /t-[0-9a-f]{8}/;

const DEPARTED_RETRIES = 5;

const CONNECT_TRIES = 5;

export interface Queryable {
  query(text: string): Promise<unknown>;
}

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
  const client = await connect(testAdminUrl());
  try {
    for (const name of names) await drop(client, name);
  } finally {
    await client.end();
  }
}

async function connect(url: string): Promise<pg.Client> {
  for (let tries = 1, pause = 50; ; tries++, pause *= 2) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
      if ((code !== "ECONNRESET" && code !== "53300") || tries >= CONNECT_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
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
        statement = sql;
      } else if (isError(error, "55006", "dropdb") && retries++ < DEPARTED_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        throw error;
      }
    }
  }
}

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
