/**
 * Helpers for tests that need a real Postgres.
 *
 * `pnpm test` (packages/dev-loop/src/test.mjs) starts a throwaway local server and hands it to the tests as
 * STORYTREE_TEST_PG_URL; set that variable yourself to test against another server. A Postgres
 * test must never skip silently, so asking for the server when there is none throws.
 *
 * Two kinds of sign-in reach it, and a test never mixes them up:
 * - The harness's authority: STORYTREE_TEST_PG_URL itself, a superuser, carrying its password when
 *   the server asks for one. Only these helpers use it, to create and drop test databases and roles,
 *   grant memberships and read the server's state (withTestClient). Nothing is reached as that user
 *   by the code under test except where a test says the admin's own sign-in is its subject.
 * - Ordinary test roles: createTestRole() gives each login role a fresh synthetic password, and a
 *   test reaches one only through testRoleUrl() or withTestClientAs(), or, on the Cloud SQL path,
 *   through a socket from cloudSqlStandIn(), never by writing a role's name into a URL itself.
 * A role named with uniqueProjectName() must give its password whatever the server's other rules
 * say: createTestRole() puts a scram-sha-256 line for those names at the top of the server's
 * pg_hba.conf, so these paths run against an authenticated server on every platform, and no test
 * leans on the server trusting a passwordless login.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect as connectSocket, createServer, type AddressInfo, type Socket } from "node:net";

import { connect, type Project } from "../project/index.js";

import pg from "pg";
import type { Client } from "pg";

/**
 * What uniqueProjectName() puts in every name; the only databases dropTestDatabases() and the only
 * roles dropTestRoles() will drop.
 */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** Something SQL can be run on: a pg Client or Pool. */
export interface Queryable {
  query(text: string): Promise<unknown>;
}

/** The server the tests run against. Throws when there is none. */
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

/** A project name no other test, and no earlier run, is using: `t-` and 8 random hex digits. */
export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/**
 * Run `fn` with a client connected to `database` on the test server (to the server URL's own
 * database when omitted). The connection is independent of the code under test.
 */
export async function withTestClient<T>(
  fn: (client: Client) => Promise<T>,
  database?: string,
): Promise<T> {
  return withClient(undefined, fn, database);
}

/**
 * Run `fn` with a client signed in to the test server as `role` with the password createTestRole()
 * gave it, connected to `database` (to the server URL's own database when omitted). The connection
 * is independent of the code under test.
 */
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
  const url = new URL(role === undefined ? testServerUrl() : testRoleUrl(role));
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drop a test's databases, ending any connection still open to them. Missing ones are skipped.
 * Only names carrying a uniqueProjectName() token are accepted, so a mistake in a test can never
 * drop somebody's real database on a shared server.
 *
 * They are dropped on the test server, or through `server` when given: a connection to another
 * server's own database (a Cloud SQL instance's, say).
 *
 * Through `server` signed in as a user that may not create databases, a project database that user
 * made by borrowing a role that may (capability 8) is the borrowed role's, and is dropped all the
 * same, as the user: DROP DATABASE takes a member holding its owner's rights by inheritance, as a
 * role granted with the default INHERIT does. It is deliberately not dropped AS that role (SET
 * ROLE): WITH (FORCE) could then not end the user's own sessions still open on it.
 */
export async function dropTestDatabases(databases: Iterable<string>, server?: Queryable): Promise<void> {
  const names = [...databases];
  for (const name of names) assertTestName("drop", "database", name);
  if (names.length === 0) return;
  const drop = async (client: Queryable): Promise<void> => {
    for (const name of names) {
      const sql = `DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`;
      let statement = `${sql} WITH (FORCE)`;
      let retries = 0;
      for (;;) {
        try {
          await client.query(statement);
          break;
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
  };
  if (server !== undefined) {
    await drop(server);
  } else {
    await withTestClient(drop);
  }
}

/** The password createTestRole() gave each login role it made, by role. */
const rolePasswords = new Map<string, string>();

/**
 * The test server's URL signed in as `role`, a login role createTestRole() made, with its password,
 * connected to `database` (to the server URL's own database when omitted).
 */
export function testRoleUrl(role: string, database?: string): string {
  const password = rolePasswords.get(role);
  if (password === undefined) throw new Error(`no test role ${JSON.stringify(role)} signs in: make it with createTestRole()`);
  const url = new URL(testServerUrl());
  url.username = role;
  url.password = password;
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}

/**
 * Create a role on the test server, made by its superuser: a login role, for a test to connect as,
 * unless `login` is false. It may create databases only when `createdb` is set, and roles only when
 * `createrole` is, without being a superuser (as a Cloud SQL instance's `postgres` user may). A
 * login role has `password`, or a fresh synthetic one, and the server asks for it (see the top of
 * this file). Its name must carry a uniqueProjectName() token, like every role dropTestRoles() will
 * drop.
 */
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

/** The pg_hba.conf line that makes every role named with uniqueProjectName() give its password. */
export const TEST_ROLE_PASSWORD_LINE = `host all "/^t-[0-9a-f]{8}" all scram-sha-256`;

let passwordsRequired: Promise<void> | undefined;

/** The test server's pg_hba.conf, once a process has read where it is. */
let hbaFile: string | undefined;

/**
 * Put TEST_ROLE_PASSWORD_LINE at the top of the test server's pg_hba.conf and wait until the server
 * has taken it up. Every test file's process writes the same text, but another file's test may
 * prepend a line of its own from a copy read before this one was written (capability 15's does),
 * so each call looks again, and the line is put back on each try until the server asks.
 */
async function requireTestRolePasswords(): Promise<void> {
  if (hbaFile !== undefined && passwordsRequired === undefined &&
    readFileSync(hbaFile, "utf8").split(/\r?\n/).includes(TEST_ROLE_PASSWORD_LINE)) return;
  passwordsRequired ??= (async () => {
    const file = hbaFile ??= await withTestClient(async (client) => (await client.query<{ hba_file: string }>("SHOW hba_file")).rows[0]!.hba_file);
    // One that does not exist, with a wrong password: a server that asks refuses it outright
    // (28P01), one that still trusts says it does not exist (28000).
    const probe = new URL(testServerUrl());
    probe.username = `${uniqueProjectName()}-probe`;
    probe.password = "not-the-password";
    for (const until = Date.now() + 10_000; ;) {
      const rules = readFileSync(file, "utf8");
      if (!rules.split(/\r?\n/).includes(TEST_ROLE_PASSWORD_LINE)) {
        // Written beside it and renamed over it: on Windows every new backend reads pg_hba.conf afresh,
        // so a connection from another test file opened mid-write would fail on a truncated file.
        const next = `${file}.${process.pid}.next`;
        writeFileSync(next, `${TEST_ROLE_PASSWORD_LINE}\n${rules}`);
        await replace(next, file);
        await withTestClient((client) => client.query("SELECT pg_reload_conf()"));
      }
      // The reload is a signal: wait until the server asks a test role for its password.
      const client = new pg.Client({ connectionString: probe.href });
      const asked = await client.connect().then(() => false, (error: unknown) => (error as { code?: unknown }).code === "28P01");
      await client.end().catch(() => {});
      if (asked) return;
      if (Date.now() > until) throw new Error(`the test server did not take up ${TEST_ROLE_PASSWORD_LINE}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })().finally(() => { passwordsRequired = undefined; });
  return passwordsRequired;
}

/** Rename `from` over `to`, retrying while Windows refuses because a backend has `to` open. */
async function replace(from: string, to: string): Promise<void> {
  for (const until = Date.now() + 10_000; ;) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/**
 * Drop a test's roles, in the order given. Missing ones are skipped. A role that still owns a
 * database cannot be dropped, so drop the test's databases first; nor can one that granted a
 * membership still standing, so give a role's members and the role before whoever granted it.
 * Only names carrying a uniqueProjectName() token are accepted, so a mistake in a test can never
 * drop somebody's real role on a shared server.
 */
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

/** How many more times a drop is tried while the database is still being accessed. */
const DEPARTED_RETRIES = 5;

function isError(error: unknown, code: string, routine: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === code && "routine" in error && error.routine === routine;
}

function assertTestName(action: "create" | "drop", what: "database" | "role", name: string): void {
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

/** Count bytes on every project connection, as the shared server bills its egress. */
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

/** pg's own SCRAM-SHA-256 client steps, which the Cloud SQL stand-in signs in with. */
interface ScramSession { readonly response: string }
const sasl = createRequire(import.meta.url)("pg/lib/crypto/sasl") as {
  startSession(mechanisms: string[]): ScramSession & { readonly mechanism: string };
  continueSession(session: ScramSession, password: string, serverData: string): Promise<void>;
  finalizeSession(session: ScramSession, serverData: string): void;
};

let standIn: Promise<{ readonly host: string; readonly port: number }> | undefined;

/**
 * Where a test's fake Cloud SQL connector opens its sockets: a stand-in, on this machine, for the
 * socket Google's connector hands pg. That socket is already signed in as the IAM user (Cloud SQL
 * checks the account's token itself), so pg sends no password over it. The stand-in does the same
 * for the test server: it reads the startup message pg sends, passes it on, answers the server's
 * SCRAM challenge with the password createTestRole() gave that user, and from the server's
 * AuthenticationOk on passes bytes both ways untouched. A user createTestRole() did not make is
 * refused as Cloud SQL refuses an account that is not a database user (28000), without asking the
 * server. Against a server that lets the role in without a password it only passes bytes on.
 * One stand-in serves the whole process, and does not keep it alive.
 */
export function cloudSqlStandIn(): Promise<{ readonly host: string; readonly port: number }> {
  standIn ??= new Promise((resolve, reject) => {
    const server = createServer((client) => void signIn(client));
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ host: "127.0.0.1", port: (server.address() as AddressInfo).port }));
  });
  return standIn;
}

/** Startup codes, in a startup packet's first four bytes after its length. */
const PROTOCOL_3 = 196608;
const SSL_REQUEST = 80877103;
const GSS_REQUEST = 80877104;

async function signIn(client: Socket): Promise<void> {
  const upstream = new URL(testServerUrl());
  const server = connectSocket(Number(upstream.port || 5432), upstream.hostname);
  const sockets = [client, server];
  const done = () => { for (const socket of sockets) socket.destroy(); };
  for (const socket of sockets) socket.on("error", done).on("close", done);
  const fromClient = new Frames(client);
  const fromServer = new Frames(server);
  const splice = () => {
    const [early, later] = [fromClient.release(), fromServer.release()];
    if (early.length > 0) server.write(early);
    if (later.length > 0) client.write(later);
    client.pipe(server).pipe(client);
  };
  try {
    let startup: Buffer;
    for (;;) {
      const length = (await fromClient.take(4)).readInt32BE(0);
      startup = Buffer.concat([int32(length), await fromClient.take(length - 4)]);
      const code = startup.readInt32BE(4);
      if (code !== SSL_REQUEST && code !== GSS_REQUEST) break;
      client.write("N"); // No encryption: the stand-in is a socket on this machine.
    }
    server.write(startup);
    if (startup.readInt32BE(4) !== PROTOCOL_3) return splice(); // A cancel request: nothing to sign in.
    const fields = startup.subarray(8).toString("utf8").split("\0");
    const user = fields[fields.indexOf("user") + 1] ?? "";
    let session: ScramSession | undefined;
    for (;;) {
      const type = (await fromServer.take(1)).toString("latin1");
      const length = (await fromServer.take(4)).readInt32BE(0);
      const body = await fromServer.take(length - 4);
      const frame = Buffer.concat([Buffer.from(type, "latin1"), int32(length), body]);
      if (type !== "R") {
        client.write(frame); // An ErrorResponse ends the connection: the server closes it after.
        continue;
      }
      const step = body.readInt32BE(0);
      const data = body.subarray(4).toString("utf8");
      if (step === 0) {
        client.write(frame);
        return splice();
      }
      const password = rolePasswords.get(user);
      if (step === 10 && password === undefined) {
        client.end(errorResponse("28000", `Cloud SQL IAM user authentication failed for user "${user}"`));
        server.destroy();
        return;
      }
      if (step === 10) {
        const started = sasl.startSession(data.split("\0").filter((mechanism) => mechanism !== ""));
        session = started;
        const response = Buffer.from(started.response, "utf8");
        server.write(message("p", Buffer.concat([Buffer.from(`${started.mechanism}\0`, "utf8"), int32(response.length), response])));
      } else if (step === 11 && session !== undefined && password !== undefined) {
        await sasl.continueSession(session, password, data);
        server.write(message("p", Buffer.from(session.response, "utf8")));
      } else if (step === 12 && session !== undefined) {
        sasl.finalizeSession(session, data);
      } else {
        throw new Error(`the test server asked for a sign-in the Cloud SQL stand-in does not give (${step})`);
      }
    }
  } catch {
    done();
  }
}

/** Bytes as they arrive on a socket, taken a known length at a time until released. */
class Frames {
  #buffer = Buffer.alloc(0);
  #ended = false;
  #wake: (() => void) | undefined;
  readonly #socket: Socket;
  readonly #onData = (chunk: Buffer) => { this.#buffer = Buffer.concat([this.#buffer, chunk]); this.#wake?.(); };
  readonly #onClose = () => { this.#ended = true; this.#wake?.(); };

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", this.#onData).on("close", this.#onClose);
  }

  async take(length: number): Promise<Buffer> {
    while (this.#buffer.length < length) {
      if (this.#ended) throw new Error("the socket closed");
      await new Promise<void>((resolve) => { this.#wake = resolve; });
    }
    const taken = this.#buffer.subarray(0, length);
    this.#buffer = this.#buffer.subarray(length);
    return taken;
  }

  /** Stop taking: what arrived but was not taken. */
  release(): Buffer {
    this.#socket.off("data", this.#onData).off("close", this.#onClose);
    return this.#buffer;
  }
}

function int32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value, 0);
  return bytes;
}

function message(type: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);
}

function errorResponse(code: string, text: string): Buffer {
  const fields = [["S", "FATAL"], ["V", "FATAL"], ["C", code], ["M", text]].map(([key, value]) => `${key}${value}\0`).join("");
  return message("E", Buffer.from(`${fields}\0`, "utf8"));
}
