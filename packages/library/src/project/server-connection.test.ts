/**
 * Capability 28 · Shared server, in the library story: how a project's database is made by a
 * server user that may not create databases (28.14, 28.15), and the deadline on a stalled local
 * handshake (28.9, 28.11).
 *
 * A managed server's user often may not create databases, and on Postgres 16 and later only a role
 * holding ADMIN OPTION on that user may let it. What a role that may create roles can do is make
 * one that may create databases and grant it to the user, which then borrows that role (SET ROLE)
 * to make each project's database. These prove the refusal and the borrowing on the local test
 * Postgres, in the same privilege shape: a user the superuser made, with no CREATEDB. The messages
 * are restated here from the brief, not taken from the code. Every role and database a test makes
 * is named with uniqueProjectName() and dropped at the end, pass or fail.
 */
import assert from "node:assert/strict";
import { createServer, connect as openSocket, type AddressInfo, type Socket } from "node:net";
import { after, before, describe, mock, test } from "node:test";

import { waitUntil } from "@storytree/test-waits";

import {
  createTestRole,
  dropTestDatabases,
  dropTestRoles,
  testRoleUrl,
  testServerUrl,
  uniqueProjectName,
  withTestClient,
} from "../testing/pg.js";
import { transactionsBehaviourSuite } from "../transactions/behaviour-suite.js";
import { PgTransactions } from "../transactions/index.js";
import { ConnectionError, connect, type ConnectionProblem, type Project, type Storytree } from "./index.js";

test("28.14 opening a new project as a server user that may not create databases, with no role to borrow, is refused with the two lines that let it", async () => {
  const run = uniqueProjectName();
  const role = `${run}-user`;
  const creator = `${run}-creator`;
  const reader = `${run}-reader`;
  let storytree: Storytree | undefined;
  let readOnly: Storytree | undefined;
  try {
    await createTestRole(role, { createdb: false });
    storytree = await connect({ url: testRoleUrl(role) });

    const refused = await refusalOf(storytree.openProject(run), "create-database");
    assert.equal(
      refused.message,
      "Your Postgres user cannot create databases, and storytree keeps one database per project. Run these two lines " +
        "once, as a superuser (such as `postgres`), to give it a role that can: `CREATE ROLE storytree_creator NOLOGIN CREATEDB;` " +
        `\`GRANT storytree_creator TO "${role}";\` Storytree then borrows that role to create each project's database.`,
    );
    assert.equal(codeOf(refused.cause), "42501", "the server's own refusal is its cause");
    assert.deepEqual(await databasesContaining(run), [], "no database was made");

    for (const line of linesIn(refused.message)) await withTestClient((client) => client.query(renamed(line, creator)));
    const project = await storytree.openProject(run);
    assert.equal(project.name, run, "once the two lines are run as written, the project opens");
    await assertBorrowed(project, role, creator);
    assert.deepEqual(await databasesContaining(run), [`storytree_${run}`]);

    // Only that refusal is taken for a missing grant. A user who may create databases, on a server
    // where CREATE DATABASE fails for another reason (a read-only one, as a read replica is), is
    // told the server's own reason: a grant would fix nothing.
    await createTestRole(reader, { createdb: true });
    await withTestClient((client) => client.query(`ALTER ROLE "${reader}" SET default_transaction_read_only = on`));
    readOnly = await connect({ url: testRoleUrl(reader) });
    await assert.rejects(readOnly.openProject(`${run}-replica`), (error: unknown) => {
      assert.ok(!(error instanceof ConnectionError), `not a ConnectionError: ${String(error)}`);
      assert.equal(codeOf(error), "25006", "Postgres's own read-only refusal");
      return true;
    });
    assert.deepEqual(await databasesContaining(run), [`storytree_${run}`], "no database was made");
  } finally {
    await storytree?.close();
    await readOnly?.close();
    await dropTestDatabases([`storytree_${run}`, `storytree_${run}-replica`]);
    await dropTestRoles([role, creator, reader]);
  }
});


test("28.15 a user that may not create databases opens a new project by borrowing a role that may, and hands the role back", async () => {
  const run = uniqueProjectName();
  // A database user that may not create databases, and a role that may, granted to it: what the
  // two lines of the refusal above make.
  const user = `${run}@storytree.test`;
  const creator = `${run}-creator`;
  const [first, raced, later] = ["first", "raced", "later"].map((part) => `${run}-${part}`) as [string, string, string];
  const opened: Storytree[] = [];
  try {
    await createTestRole(user, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${user}"`));
    const one = await connect({ url: testRoleUrl(user) });
    opened.push(one);
    const two = await connect({ url: testRoleUrl(user) });
    opened.push(two);

    await assertBorrowed(await one.openProject(first), user, creator);

    // Two first opens of one project racing each other, on two connections, are as safe as ever:
    // both succeed, and there is one database, set up once.
    const both = await Promise.all([one.openProject(raced), two.openProject(raced)]);
    assert.deepEqual(both.map((project) => project.name), [raced, raced]);
    assert.deepEqual(await databasesContaining(raced), [`storytree_${raced}`]);
    for (const project of both) await assertBorrowed(project, user, creator);

    // The role was taken on for the CREATE DATABASE alone and handed back: once the grant is
    // withdrawn, the same connections are refused a new project again, as the user itself.
    await withTestClient((client) => client.query(`REVOKE "${creator}" FROM "${user}"`));
    for (const storytree of opened) await refusalOf(storytree.openProject(later), "create-database");
    assert.deepEqual(await databasesContaining(later), [], "no database was made");
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([first, raced, later].map((name) => `storytree_${name}`));
    await dropTestRoles([user, creator]);
  }
});

test("28.15 of the roles a user may take on that may create databases, it borrows the first by name, reached directly or through another role, and never one it may not SET ROLE to", async () => {
  const run = uniqueProjectName();
  const user = `${run}@storytree.test`;
  // Three roles that may create databases, made and granted in the opposite order to their names,
  // so that neither order can pass for the other. `-creator-0` comes first by name, but is granted
  // WITH SET FALSE, so the user may not take it on; `-creator-a` is reached through `-group`.
  const [notSettable, throughGroup, direct] = ["0", "a", "b"].map((suffix) => `${run}-creator-${suffix}`) as [
    string,
    string,
    string,
  ];
  const group = `${run}-group`;
  let storytree: Storytree | undefined;
  try {
    await createTestRole(user, { createdb: false });
    await createTestRole(group, { createdb: false, login: false });
    for (const creator of [direct, throughGroup, notSettable]) await createTestRole(creator, { createdb: true, login: false });
    await withTestClient(async (client) => {
      await client.query(`GRANT "${direct}" TO "${user}"`);
      await client.query(`GRANT "${throughGroup}" TO "${group}"`);
      await client.query(`GRANT "${group}" TO "${user}"`);
      await client.query(`GRANT "${notSettable}" TO "${user}" WITH SET FALSE`);
    });
    storytree = await connect({ url: testRoleUrl(user) });

    // The same role every time.
    for (const part of ["one", "two"]) await assertBorrowed(await storytree.openProject(`${run}-${part}`), user, throughGroup);
  } finally {
    await storytree?.close();
    await dropTestDatabases([`storytree_${run}-one`, `storytree_${run}-two`]);
    await dropTestRoles([user, group, notSettable, throughGroup, direct]);
  }
});

describe("28.15 capability 2's behaviour suite, unchanged, in projects a user that may not create databases opened by borrowing a role that may", () => {
  const run = uniqueProjectName();
  const user = `${run}@storytree.test`;
  const creator = `${run}-creator`;
  const made: string[] = [];
  before(async () => {
    await createTestRole(user, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${user}"`));
  });
  after(async () => {
    await dropTestDatabases(made); // each test's own cleanup dropped its database; this catches any it could not
    await dropTestRoles([user, creator]);
  });
  transactionsBehaviourSuite("a borrowed creator role", async () => {
    const name = `${run}-${made.length + 1}`;
    const database = `storytree_${name}`;
    made.push(database);
    const storytree = await connect({ url: testRoleUrl(user) });
    const dispose = async (): Promise<void> => {
      try {
        await storytree.close();
      } finally {
        await dropTestDatabases([database]);
      }
    };
    try {
      const project = await storytree.openProject(name);
      return { store: new PgTransactions(project.pool), cleanup: dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  });
});

test("28.9 a stalled local handshake is refused at ten seconds by default, or at the deadline the caller gives, on both admin and project pools, saying the computer may be busy, and the next call recovers", async () => {
  await refusedAtDeadline({}, 10_000);
  await refusedAtDeadline({ connectTimeoutMs: 4_000 }, 4_000);
});

test("28.11 a local url naming a connect_timeout longer than the given deadline is given it, as a test run's throwaway server is; one naming a shorter one keeps the given deadline", async () => {
  await refusedAtDeadline({ connectTimeout: "12" }, 12_000);
  await refusedAtDeadline({ connectTimeout: "5" }, 10_000);
});

/** The real clock, kept for waiting on the network while a test runs on a mocked one. */
const realSetTimeout = setTimeout;
const networkClock = { now: () => performance.now(), sleep: (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms)) };

/**
 * Open a project through a server that stalls each fresh handshake, on the admin pool and then the
 * project's, connecting with `connectTimeoutMs` (the default when undefined) and the test server's
 * url carrying `connectTimeout` as its connect_timeout (none when undefined): each is still waiting
 * just short of `deadlineMs` and refused at it, saying so, and the next call recovers. The deadline
 * runs on a mocked clock, so the test does not wait for it.
 */
async function refusedAtDeadline(
  { connectTimeout, connectTimeoutMs }: { readonly connectTimeout?: string; readonly connectTimeoutMs?: number },
  deadlineMs: number,
): Promise<void> {
  const upstream = new URL(testServerUrl());
  upstream.searchParams.delete("connect_timeout");
  const held = new Set<Socket>();
  let stalled = true;
  let stalls = 0;
  const silent = createServer((socket) => {
    held.add(socket);
    socket.on("error", () => {});
    if (stalled) {
      stalls++;
      socket.resume();
    } else {
      const target = openSocket(Number(upstream.port), upstream.hostname);
      held.add(target);
      target.on("error", () => socket.destroy());
      socket.on("close", () => target.destroy());
      socket.pipe(target).pipe(socket);
    }
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const url = new URL(upstream);
  url.port = String((silent.address() as AddressInfo).port);
  if (connectTimeout !== undefined) url.searchParams.set("connect_timeout", connectTimeout);
  const storytree = await connect({ url: url.href, ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }) });
  const name = uniqueProjectName();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // The first attempt stalls on the admin pool. Once that pool is connected, opening
    // the project again must also bound the separate handshake to the project's database.
    for (const pool of ["admin", "project"]) {
      stalled = true;
      const before = stalls;
      let outcome: unknown = "waiting";
      const opening = storytree.openProject(name).then(
        () => {
          outcome = "opened";
        },
        (error: unknown) => {
          outcome = error;
        },
      );
      await waitUntil(() => stalls > before, 5_000, `the ${pool} handshake to reach the silent server`, { clock: networkClock });
      mock.timers.tick(deadlineMs - 1);
      await turns(20);
      assert.equal(outcome, "waiting", `${pool}: still waiting just short of ${deadlineMs / 1000} seconds`);
      mock.timers.tick(1);
      await waitUntil(() => outcome !== "waiting", 5_000, `the ${pool} handshake to be refused at ${deadlineMs / 1000} seconds`, { clock: networkClock });
      await opening;
      const refused = refusal(outcome, "timeout");
      assert.equal(
        refused.message,
        `storytree isn't reachable: its database took longer than ${deadlineMs / 1000} seconds to answer, and this computer may be busy. ` +
          "Check that the storytree app is responding, then try again.",
        pool,
      );
      stalled = false;
      const recovered = await storytree.openProject(name);
      assert.equal(recovered.name, name);
      await recovered.close();
    }
  } finally {
    mock.timers.reset();
    for (const socket of held) socket.destroy();
    await storytree.close();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
    await dropTestDatabases([name]);
  }
}

/** Assert that `error` is a ConnectionError refusing for `problem`, and return it. */
function refusal(error: unknown, problem: ConnectionProblem): ConnectionError {
  assert.ok(error instanceof ConnectionError, `a ConnectionError, not ${String(error)}`);
  assert.equal(error.problem, problem, error.message);
  return error;
}

/** The ConnectionError `promise` rejects with, refusing for `problem`. */
async function refusalOf(promise: Promise<unknown>, problem: ConnectionProblem): Promise<ConnectionError> {
  try {
    await promise;
  } catch (error) {
    return refusal(error, problem);
  }
  assert.fail(`expected a refusal (${problem}), but the call succeeded`);
}

/** The SQLSTATE of a Postgres error, as pg reports it. */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** The SQL lines a refusal's message gives the owner to run: each `…;` in it, in order. */
function linesIn(message: string): string[] {
  const lines = [...message.matchAll(/`([^`]+;)`/g)].map((match) => match[1] ?? assert.fail(`no line in ${match[0]}`));
  return lines.length > 0 ? lines : assert.fail(`no lines to run in: ${message}`);
}

/** `line` with its role, storytree_creator, renamed to `role`: a test server is shared by other runs. */
function renamed(line: string, role: string): string {
  return line.replaceAll("storytree_creator", `"${role}"`);
}

/**
 * Assert that `project` was opened by borrowing `creator`: its database is the borrowed role's; the
 * project is signed in as `user` itself, the role handed back; it has its tables, every one made by
 * the user, holding the project's name (capability 1); and it saves and reads a record (capability 2).
 */
async function assertBorrowed(project: Project, user: string, creator: string): Promise<void> {
  const database = `storytree_${project.name}`;
  const owners = await withTestClient(async (client) => {
    const { rows } = await client.query<{ owner: string }>(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
      [database],
    );
    return rows.map((row) => row.owner);
  });
  assert.deepEqual(owners, [creator], "the project's database is the borrowed role's");

  const { rows: signedIn } = await project.pool.query<{ current: string; session: string; db: string }>(
    "SELECT current_user AS current, session_user AS session, current_database() AS db",
  );
  // Signed in as the user itself, acting as the role that owns the database (contract 28.1), so a
  // second account sharing that role reaches the same tables.
  assert.deepEqual(signedIn, [{ current: creator, session: user, db: database }], "signed in as the user, acting as the owning role");

  const { tables, meta } = await withTestClient(async (client) => {
    const listed = await client.query<{ name: string; owner: string }>(
      `SELECT tablename AS name, tableowner AS owner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename COLLATE "C"`,
    );
    const kept = await client.query<{ key: string; value: string }>("SELECT key, value FROM library_meta");
    return { tables: listed.rows, meta: Object.fromEntries(kept.rows.map((row) => [row.key, row.value])) };
  }, database);
  assert.ok(tables.length > 0, "the project has its tables");
  assert.deepEqual(tables.filter((table) => table.owner !== creator), [], "every one of them the owning role's");
  assert.equal(meta.project, project.name, "holding the project's name");

  const store = new PgTransactions(project.pool);
  const saved = await store.save({ id: "probe", type: "note", fields: { text: "written in a database a borrowed role made" } });
  assert.deepEqual(await store.get("probe"), saved);
}

/** The databases on the test server whose names contain `token`, in byte order. */
async function databasesContaining(token: string): Promise<string[]> {
  return withTestClient(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE strpos(datname, $1) > 0 ORDER BY datname COLLATE "C"`,
      [token],
    );
    return rows.map((row) => row.datname);
  });
}

/** Let the event loop turn `count` times. */
async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn++) await new Promise((resolve) => setImmediate(resolve));
}
