import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { connect as connectSocket, createServer, type AddressInfo, type Socket } from "node:net";

import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { waitUntil } from "@storytree/test-waits";

import { connect as connectLibrary, type Library } from "../index.js";
import { connect, type Project } from "../project/index.js";

import pg from "pg";
import type { Client } from "pg";

const TEST_TOKEN = /t-[0-9a-f]{8}/;

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

function testAdminUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_ADMIN_URL;
  return url === undefined || url === "" ? testServerUrl() : url;
}

export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

export async function withLibrary(body: (library: Library) => Promise<void>): Promise<void> {
  const name = uniqueProjectName();
  const storytree = await connectLibrary({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(name);
    try {
      await body(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${name}`]);
  }
}

export async function withTestClient<T>(
  fn: (client: Client) => Promise<T>,
  database?: string,
): Promise<T> {
  return withClient(undefined, fn, database);
}

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
  const url = new URL(role === undefined ? testAdminUrl() : testRoleUrl(role));
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: url.href });
  let lost: Error | undefined;
  client.on("error", (error) => {
    lost ??= error;
  });
  await client.connect();
  try {
    return await fn(client);
  } catch (error) {
    throw lost ?? error;
  } finally {
    await client.end();
  }
}

export { dropTestDatabases, type Queryable } from "@storytree/local-postgres/testing";

const rolePasswords = new Map<string, string>();

export function testRoleUrl(role: string, database?: string): string {
  const password = rolePasswords.get(role);
  if (password === undefined) throw new Error(`no test role ${JSON.stringify(role)} signs in: make it with createTestRole()`);
  const url = new URL(testServerUrl());
  url.username = role;
  url.password = password;
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}

export async function createTestRole(
  name: string,
  options: { readonly createdb: boolean; readonly login?: boolean; readonly createrole?: boolean; readonly password?: string },
): Promise<void> {
  assertTestName("create", "role", name);
  const login = options.login !== false;
  const password = options.password ?? randomBytes(16).toString("hex");
  const attributes = [
    login ? `LOGIN PASSWORD ${quoteLiteral(password)}` : "NOLOGIN",
    options.createdb ? "CREATEDB" : "NOCREATEDB",
    options.createrole === true ? "CREATEROLE" : "NOCREATEROLE",
  ];
  await requireTestRolePasswords();
  await withTestClient(async (client) => {
    await client.query(`CREATE ROLE ${quoteIdentifier(name)} ${attributes.join(" ")}`);
  });
  if (login) rolePasswords.set(name, password);
}

export const TEST_ROLE_PASSWORD_LINE = `host all "/^t-[0-9a-f]{8}" all scram-sha-256`;

let passwordsRequired: Promise<void> | undefined;

let hbaFile: string | undefined;

async function requireTestRolePasswords(): Promise<void> {
  if (hbaFile !== undefined && passwordsRequired === undefined &&
    readFileSync(hbaFile, "utf8").split(/\r?\n/).includes(TEST_ROLE_PASSWORD_LINE)) return;
  passwordsRequired ??= (async () => {
    const file = hbaFile ??= await withTestClient(async (client) => (await client.query<{ hba_file: string }>("SHOW hba_file")).rows[0]!.hba_file);
    const probe = new URL(testServerUrl());
    probe.username = `${uniqueProjectName()}-probe`;
    probe.password = "not-the-password";
    await waitUntil(async () => {
      const rules = readFileSync(file, "utf8");
      if (!rules.split(/\r?\n/).includes(TEST_ROLE_PASSWORD_LINE)) {
        const next = `${file}.${process.pid}.next`;
        writeFileSync(next, `${TEST_ROLE_PASSWORD_LINE}\n${rules}`);
        await replace(next, file);
        await withTestClient((client) => client.query("SELECT pg_reload_conf()"));
      }
      const client = new pg.Client({ connectionString: probe.href });
      const asked = await client.connect().then(() => false, (error: unknown) => (error as { code?: unknown }).code === "28P01");
      await client.end().catch(() => {});
      return asked;
    }, 10_000, `the test server to take up ${TEST_ROLE_PASSWORD_LINE}`);
  })().finally(() => { passwordsRequired = undefined; });
  return passwordsRequired;
}

async function replace(from: string, to: string): Promise<void> {
  await waitUntil(() => {
    try {
      renameSync(from, to);
      return true;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      return false;
    }
  }, 10_000, `${to} to be free to replace`);
}

export async function dropTestRoles(roles: Iterable<string>): Promise<void> {
  const names = [...roles];
  for (const name of names) assertTestName("drop", "role", name);
  if (names.length === 0) return;
  await withTestClient(async (client) => {
    for (const name of names) {
      await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(name)}`);
      rolePasswords.delete(name);
    }
  });
}

function assertTestName(action: "create" | "drop", what: "role", name: string): void {
  if (!TEST_TOKEN.test(name)) {
    throw new Error(`refusing to ${action} ${what} ${JSON.stringify(name)}: test ${what}s are named with uniqueProjectName()`);
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

export async function withCountedProject(body: (project: Project, received: () => number) => Promise<void>): Promise<void> {
  const upstream = new URL(testServerUrl());
  let received = 0;
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    const server = connectSocket(Number(upstream.port || 5432), upstream.hostname);
    for (const socket of [client, server]) sockets.add(socket);
    server.on("data", (chunk: Buffer) => { received += chunk.length; });
    client.pipe(server).pipe(client);
    const done = () => {
      for (const socket of [client, server]) { socket.destroy(); sockets.delete(socket); }
    };
    for (const socket of [client, server]) socket.on("close", done).on("error", done);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const url = new URL(upstream.href);
  url.hostname = "127.0.0.1";
  url.port = String((proxy.address() as AddressInfo).port);
  const name = uniqueProjectName();
  try {
    const storytree = await connect({ url: url.href });
    try { await body(await storytree.openProject(name), () => received); }
    finally { await storytree.close(); }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await dropTestDatabases([`storytree_${name}`]);
  }
}
