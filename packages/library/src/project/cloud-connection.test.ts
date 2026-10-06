/**
 * Capability 8 · Cloud connection (GCP), contract 8.2 in the library story: a missing or bad
 * Google sign-in, and every other way reaching a Cloud SQL instance can fail, is refused with a
 * message saying what to fix, never a hang. (8.1, the live proof, is in
 * src/transactions/cloud-sql.test.ts.)
 *
 * Also here, the robustness checks behind 8.1, run offline and named "8.1 robustness, offline": a
 * Cloud SQL IAM database user may not create databases, and the instance's `postgres` user cannot
 * let it (on Postgres 16 and later only a role holding ADMIN OPTION on a role may alter it, and on
 * Cloud SQL that is Google's cloudsqladmin alone). What `postgres` can do is make a role that may
 * create databases and grant it to the user, and the user then borrows that role (SET ROLE) to
 * make each project's database. These prove the borrowing on the local Postgres, in the same
 * privilege shape: a user the superuser made, as cloudsqladmin makes an IAM user, and, where it
 * matters, a `postgres` that may create roles and databases but is no superuser.
 *
 * Nothing here reaches Google or a real Cloud SQL instance. The cloud path is handed a fake
 * connector through connect()'s seam: one that fails the way Google's does (no sign-in found, a
 * sign-in expired or revoked, an instance that is missing or not allowed, no answer at all), or one
 * that signs in as nobody and hands back a plain socket to the local test Postgres, which then
 * answers as the Cloud SQL server would for the user connect() was given (an account that is not a
 * database user, a user that may not create databases). The same refusal of CREATE DATABASE on the
 * local path is proved on the local server itself. The messages are restated here from the brief,
 * not taken from the code. Every role and database a test makes is named with uniqueProjectName()
 * and dropped at the end, pass or fail.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, connect as openSocket, type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { after, before, describe, mock, test, type TestContext } from "node:test";

import {
  createTestRole,
  dropTestDatabases,
  dropTestRoles,
  testServerUrl,
  uniqueProjectName,
  withTestClient,
  withTestClientAs,
} from "../testing/pg.js";
import { transactionsBehaviourSuite } from "../transactions/behaviour-suite.js";
import { PgTransactions } from "../transactions/pg.js";
import {
  cloudSqlServer,
  ConnectionError,
  connect,
  type CloudSqlConnector,
  type ConnectionProblem,
  type Project,
  type Storytree,
} from "./index.js";

/** A connection name in the right form that names no real instance. The fake connectors never look it up. */
const INSTANCE = "storytree-offline:nowhere1:no-such-instance";
/** A Google account, for the tests that never reach a database. */
const USER = "you@example.com";
/** google-auth-library's own words when it finds no Application Default Credentials anywhere. */
const NO_SIGN_IN =
  "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.";

test("8.2 a cloudSql setting that is not an instance's connection name and a Google account email is refused before any network call, saying what to fix", async () => {
  const google = fakeGoogle(() => assert.fail("a refused setting reaches no connector"));
  const settings = (instance: unknown, user: unknown): unknown => ({ cloudSql: { instance, user } });
  const badInstance = (instance: unknown) =>
    `The Cloud SQL instance ${String(JSON.stringify(instance))} is not written as project:region:instance. ` +
    "Copy its connection name from the instance's page in the Cloud Console (for example my-project:australia-southeast1:my-instance).";
  const badUser = (user: unknown) =>
    `The Cloud SQL user ${String(JSON.stringify(user))} is not a Google account email. ` +
    "Give the email of the Google account you sign in with (for example you@example.com).";
  const notSettings =
    "The Cloud SQL settings are { instance, user }: the instance's connection name (project:region:instance) " +
    "and the email of the Google account to sign in as.";

  const refused: [options: unknown, message: string][] = [
    // The instance, written any way but project:region:instance.
    ...[
      "",
      "storytree-pg", // the instance's name alone
      "my-project:storytree-pg", // no region
      "my-project::storytree-pg", // an empty region
      "my-project/australia-southeast1/storytree-pg",
      "projects/my-project/instances/storytree-pg", // the Admin API's path
      "my-project:australia-southeast1:storytree-pg:extra",
      " my-project:australia-southeast1:storytree-pg",
      "my-project:australia-southeast1:storytree-pg\n",
      "My-Project:australia-southeast1:storytree-pg", // project ids are lower-case
      undefined,
      42,
    ].map((instance): [unknown, string] => [settings(instance, USER), badInstance(instance)]),
    // The user, anything but an email address.
    ...[
      "",
      "you",
      "you@",
      "@example.com",
      "you @example.com",
      "you@example.com\n",
      "you\u0000@example.com",
      "you@home@example.com",
      undefined,
      7,
    ].map((user): [unknown, string] => [settings(INSTANCE, user), badUser(user)]),
    // Settings that are not an instance and a user at all, or a url given as well.
    [{ cloudSql: null }, notSettings],
    [{ cloudSql: INSTANCE }, notSettings],
    [{ cloudSql: [INSTANCE, USER] }, notSettings],
    [
      { cloudSql: { instance: INSTANCE, user: USER }, url: "postgres://postgres@127.0.0.1:5432/postgres" },
      "Give connect() one of a url, a cloudSql instance or an address, not more.",
    ],
  ];
  for (const [options, message] of refused) {
    await assert.rejects(
      connect(untyped(options), { connector: google.make }),
      (error: unknown) => {
        assert.equal(refusal(error, "config").message, message);
        return true;
      },
      JSON.stringify(options),
    );
  }
  assert.equal(google.made, 0, "no connector was made, so nothing reached the network");
  assert.deepEqual(googleCodeLoaded(), [], "no Google code was even loaded");

  // Control: settings in the right form are accepted, and reach the connector, which signs in by
  // IAM (no password) over the instance's public IP. A project in a domain keeps its domain, and a
  // service account's database user is its email without .gserviceaccount.com. Nothing is opened
  // on the server until a call needs it, and close() closes the connector too, once.
  for (const [instance, user] of [
    ["my-project:australia-southeast1:my-instance", USER],
    ["example.com:my-project:us-central1:db-1", "storytree-ci@my-project.iam"],
  ] as const) {
    const accepted = fakeGoogle(toTestServer);
    const storytree = await connect({ cloudSql: { instance, user } }, { connector: accepted.make });
    assert.equal(accepted.made, 1);
    assert.deepEqual(accepted.calls, [{ instanceConnectionName: instance, authType: "IAM", ipType: "PUBLIC" }]);
    assert.equal(accepted.closed, 0);
    await storytree.close();
    await storytree.close();
    assert.equal(accepted.closed, 1, "close() closes the connector, once");
  }
});

test("8.2 no Google sign-in found is refused with the command that signs in, never a hang", async () => {
  const noSignIn = new Error(NO_SIGN_IN);
  const google = fakeGoogle(async () => {
    throw noSignIn;
  });

  const refused = await refusalOf(connect({ cloudSql: { instance: INSTANCE, user: USER } }, { connector: google.make }), "sign-in");

  assert.equal(
    refused.message,
    "Storytree could not find your Google sign-in. Run `gcloud auth application-default login`, then try again.",
  );
  assert.equal(refused.cause, noSignIn, "the failure it explains is kept as its cause");
  assert.equal(google.calls.length, 1, "it was the sign-in that failed");
  assertNotClosed(google);
});

test("8.2 an expired or revoked Google sign-in is refused with the command that signs in again", async () => {
  const bad = [
    // The refresh token behind Application Default Credentials has expired or been revoked.
    googleHttpError(400, "invalid_grant", { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    // The organisation wants the account to sign in again (google-auth-library puts the whole reply in the message).
    googleHttpError(
      400,
      JSON.stringify({ error: "invalid_grant", error_description: "reauth related error (invalid_rapt)", error_subtype: "invalid_rapt" }),
      { error: "invalid_grant", error_description: "reauth related error (invalid_rapt)", error_subtype: "invalid_rapt" },
    ),
    // Google turned down the credentials themselves.
    googleHttpError(401, "Request had invalid authentication credentials.", {
      error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" },
    }),
  ];
  for (const failure of bad) {
    const google = fakeGoogle(async () => {
      throw failure;
    });
    const refused = await refusalOf(connect({ cloudSql: { instance: INSTANCE, user: USER } }, { connector: google.make }), "sign-in");
    assert.equal(
      refused.message,
      "Your Google sign-in was not accepted: it has expired or been revoked. Run `gcloud auth application-default login`, then try again.",
      failure.message,
    );
    assert.equal(refused.cause, failure);
    assertNotClosed(google);
  }
});

test("8.2 an instance that does not exist, or that the account may not use, is refused naming the instance and the Cloud SQL Client role", async () => {
  const bad = [
    googleHttpError(404, "The Cloud SQL instance does not exist.", {
      error: { code: 404, message: "The Cloud SQL instance does not exist.", errors: [{ reason: "instanceDoesNotExist" }] },
    }),
    googleHttpError(403, "The client is not authorized to make this request.", {
      error: { code: 403, message: "The client is not authorized to make this request.", errors: [{ reason: "notAuthorized" }] },
    }),
  ];
  for (const failure of bad) {
    const google = fakeGoogle(async () => {
      throw failure;
    });
    const refused = await refusalOf(connect({ cloudSql: { instance: INSTANCE, user: USER } }, { connector: google.make }), "instance");
    assert.equal(
      refused.message,
      `Storytree could not open the Cloud SQL instance "${INSTANCE}" as ${USER}: it does not exist, or the account ` +
        `is not allowed to use it. Check the instance's name, and that ${USER} has the Cloud SQL Client role on it. ` +
        `(Google said: ${failure.message})`,
    );
    assert.equal(refused.cause, failure);
    assertNotClosed(google);
  }
});

test("8.2 a stopped Cloud SQL instance is refused saying the shared library is unreachable because its instance is not running, and not to work around it", async () => {
  // The Admin API's reply when the instance is stopped: a 400 whose reason is invalidState.
  const stopped = googleHttpError(400, "The instance or operation is not in an appropriate state to handle the request.", {
    error: {
      code: 400,
      message: "The instance or operation is not in an appropriate state to handle the request.",
      errors: [{ reason: "invalidState" }],
    },
  });
  const google = fakeGoogle(async () => {
    throw stopped;
  });

  const refused = await refusalOf(connect({ cloudSql: { instance: INSTANCE, user: USER } }, { connector: google.make }), "stopped");

  assert.equal(
    refused.message,
    `The shared library is unreachable: its Cloud SQL instance "${INSTANCE}" is not running. Do not work around it ` +
      "(no other library, no local copy); whoever runs the instance must start it again, then try again.",
  );
  assert.equal(refused.cause, stopped, "Google's own refusal is kept as its cause");
  assertNotClosed(google);
});

test("8.2 a Google account that is not a database user on the instance is refused, saying to add it as a Cloud SQL IAM user", async (t) => {
  const run = uniqueProjectName();
  // No role of this name on the server: an account never added to the instance as a database user.
  const user = `${run}@storytree.test`;
  let storytree: Storytree | undefined;
  try {
    storytree = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });
    const opened = storytree;
    for (const [call, attempt] of [
      ["listProjects", () => opened.listProjects()],
      ["openProject", () => opened.openProject(run)],
    ] as const) {
      const refused = await loginRefusalOf(t, call, attempt, "database-user");
      assert.equal(
        refused.message,
        `Cloud SQL did not let ${user} in as a database user on "${INSTANCE}". Add the account to the instance as a ` +
          `Cloud SQL IAM user (gcloud sql users create ${user} --instance=no-such-instance --project=storytree-offline ` +
          "--type=cloud_iam_user) with the Cloud SQL Instance User role, and check it is the account you signed in with.",
        call,
      );
      assert.equal(codeOf(refused.cause), "28000", `${call}: the server's own refusal is its cause`);
    }
    assert.deepEqual(await databasesContaining(run), [], "nothing was made on the server");

    // Control: once the account is a database user (a role of its name, which adding it to the
    // instance makes), the same connection lets it in.
    await createTestRole(user, { createdb: false });
    assert.ok(Array.isArray(await opened.listProjects()));
  } finally {
    await storytree?.close();
    await dropTestDatabases([`storytree_${run}`]);
    await dropTestRoles([user]);
  }
});

test("8.2 opening a new project on Cloud SQL as a user that may not create databases, with no role to borrow, is refused with the two lines that let it", async () => {
  const run = uniqueProjectName();
  // A database user without the right to create databases, as a Cloud SQL IAM user is by default,
  // made by the server's superuser as Google's cloudsqladmin makes one: so `postgres` below holds no
  // ADMIN OPTION on it.
  const user = `${run}@storytree.test`;
  // The instance's `postgres` user as Cloud SQL makes it: it may create roles and databases, and it
  // is no superuser.
  const postgres = `${run}-postgres`;
  // The message's storytree_creator, renamed so that runs sharing a test server never collide.
  const creator = `${run}-creator`;
  const site = `${run}-site`;
  let storytree: Storytree | undefined;
  try {
    await createTestRole(user, { createdb: false });
    await createTestRole(postgres, { createdb: true, createrole: true });
    storytree = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });

    const refused = await refusalOf(storytree.openProject(site), "create-database");
    assert.equal(
      refused.message,
      "Your Cloud SQL user cannot create databases, and storytree keeps one database per project. Run these two lines " +
        "once, as the instance's `postgres` user, to give it a role that can: `CREATE ROLE storytree_creator NOLOGIN CREATEDB;` " +
        `\`GRANT storytree_creator TO "${user}";\` Storytree then borrows that role to create each project's database.`,
    );
    assert.equal(codeOf(refused.cause), "42501", "the server's own refusal is its cause");
    assert.deepEqual(await databasesContaining(run), [], "no database was made");

    // This server has Cloud SQL's rule, which is why the message gives these two lines: its
    // `postgres` may neither give the user CREATEDB (the old advice) nor make a database the user
    // owns, since both need rights over the user that only the role which made it holds.
    for (const oldAdvice of [`ALTER ROLE "${user}" CREATEDB`, `CREATE DATABASE "storytree_${site}" OWNER "${user}"`]) {
      await assert.rejects(withTestClientAs(postgres, (client) => client.query(oldAdvice)), (error: unknown) => {
        assert.equal(codeOf(error), "42501", `${oldAdvice}: ${String(error)}`);
        return true;
      });
    }
    // Once the two lines are run as the message writes them, by that `postgres`, the same
    // connection opens the project, borrowing the role.
    for (const line of linesIn(refused.message)) {
      await withTestClientAs(postgres, (client) => client.query(renamed(line, creator)));
    }
    await assertBorrowed(await storytree.openProject(site), user, creator);
    assert.deepEqual(await databasesContaining(run), [`storytree_${site}`]);
  } finally {
    await storytree?.close();
    await dropTestDatabases([`storytree_${site}`]);
    await dropTestRoles([user, creator, postgres]);
  }
});

test("8.2 on the local path too, opening a new project as a server user that may not create databases, with no role to borrow, is refused with the two lines that let it", async () => {
  const run = uniqueProjectName();
  const role = `${run}-user`;
  const creator = `${run}-creator`;
  const reader = `${run}-reader`;
  let storytree: Storytree | undefined;
  let readOnly: Storytree | undefined;
  try {
    await createTestRole(role, { createdb: false });
    const url = new URL(testServerUrl());
    url.username = role;
    storytree = await connect({ url: url.href });

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
    assert.deepEqual(googleCodeLoaded(), [], "and the local path never loaded Google's code");

    // Only that refusal is taken for a missing grant. A user who may create databases, on a server
    // where CREATE DATABASE fails for another reason (a read-only one, as a read replica is), is
    // told the server's own reason: a grant would fix nothing.
    await createTestRole(reader, { createdb: true });
    await withTestClient((client) => client.query(`ALTER ROLE "${reader}" SET default_transaction_read_only = on`));
    url.username = reader;
    readOnly = await connect({ url: url.href });
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

test("8.2 a Cloud SQL instance that does not answer is refused after a bounded wait, never a hang", async () => {
  // A sign-in that never finishes is refused at 20 seconds, the bound when none is given (on a
  // mocked clock, so the test does not wait for it).
  let finishSignIn: ((options: { stream: () => Duplex }) => void) | undefined;
  const google = fakeGoogle(
    () =>
      new Promise((resolve) => {
        finishSignIn = resolve;
      }),
  );
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let outcome: unknown = "waiting";
    const connecting = connect({ cloudSql: { instance: INSTANCE, user: USER } }, { connector: google.make }).then(
      (storytree) => {
        outcome = storytree;
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await turnsUntil(() => google.calls.length === 1, "connect() asks the connector to sign in");
    mock.timers.tick(19_999);
    await turns(20);
    assert.equal(outcome, "waiting", "still waiting just short of 20 seconds");
    mock.timers.tick(1);
    // Not `await connecting`: were there no bound, that would wait forever. This fails instead.
    await turnsUntil(() => outcome !== "waiting", "connect() is refused once 20 seconds have passed");
    await connecting;
    assert.equal(
      refusal(outcome, "timeout").message,
      `Storytree could not reach the Cloud SQL instance "${INSTANCE}" within 20 seconds. Check that the instance is ` +
        "running and has a public IP address, and that this network can reach Google Cloud, then try again.",
    );
    // A sign-in that finishes after the refusal is not left running: its connector is closed then.
    assert.equal(google.closed, 0);
    finishSignIn?.({ stream: () => assert.fail("no socket is opened after the refusal") });
    await turns(20);
    assert.equal(google.closed, 1, "the late sign-in's connector is closed");
  } finally {
    mock.timers.reset();
  }

  // An instance that takes the connection and then says nothing is refused at the same bound (here
  // a quarter of a second), by every call that needs it, rather than waiting on the socket. (The
  // silent server hangs up after 10 seconds, so that were there no bound the test would fail on
  // the time taken, not hang.)
  const held = new Set<Socket>();
  const silent = createServer((socket) => {
    held.add(socket);
    setTimeout(() => socket.destroy(), 10_000).unref();
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  let storytree: Storytree | undefined;
  try {
    storytree = await connect(
      { cloudSql: { instance: INSTANCE, user: USER } },
      { connector: fakeGoogle(async () => ({ stream: () => connectingSocket(port, "127.0.0.1") })).make, timeoutMs: 250 },
    );
    const opened = storytree;
    for (const [call, attempt] of [
      ["listProjects", () => opened.listProjects()],
      ["openProject", () => opened.openProject(uniqueProjectName())],
    ] as const) {
      const started = performance.now();
      const refused = await refusalOf(attempt(), "timeout");
      const waited = performance.now() - started;
      assert.equal(
        refused.message,
        `Storytree could not reach the Cloud SQL instance "${INSTANCE}" within 0.25 seconds. Check that the instance is ` +
          "running and has a public IP address, and that this network can reach Google Cloud, then try again.",
        call,
      );
      assert.ok(waited >= 200 && waited < 5_000, `${call} was refused at the bound, not before it or long after: ${waited.toFixed(0)} ms`);
    }
    assert.ok(held.size >= 2, "each call did reach the silent server");
  } finally {
    await storytree?.close();
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});

test("1.9 a stalled local handshake is refused within three seconds, on both admin and project pools, and the next call recovers", async (t) => {
  const upstream = new URL(testServerUrl());
  const held = new Set<Socket>();
  let stalled = true;
  const silent = createServer((socket) => {
    held.add(socket);
    socket.on("error", () => {});
    if (stalled) {
      socket.resume();
      setTimeout(() => socket.destroy(), 10_000).unref();
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
  const storytree = await connect({ url: url.href });
  const name = uniqueProjectName();
  try {
    // The first attempt stalls on the admin pool. Once that pool is connected, opening
    // the project again must also bound the separate handshake to the project's database.
    for (const pool of ["admin", "project"]) {
      stalled = true;
      const started = performance.now();
      const error = await storytree.openProject(name).then(() => assert.fail("the silent server cannot open a project"), (error: unknown) => error);
      const waited = performance.now() - started;
      t.diagnostic(`${pool} handshake refused after ${waited.toFixed(0)} ms`);
      assert.ok(waited >= 2_500 && waited < 4_000, `${pool}: the 3 s deadline plus scheduling allowance, got ${waited.toFixed(0)} ms`);
      const refused = refusal(error, "timeout");
      assert.match(refused.message, /storytree isn't reachable/i);
      assert.match(refused.message, /check.*app.*try again/i);
      stalled = false;
      const recovered = await storytree.openProject(name);
      assert.equal(recovered.name, name);
      await recovered.close();
    }
  } finally {
    for (const socket of held) socket.destroy();
    await storytree.close();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
    await dropTestDatabases([name]);
  }
});

test("8.1 robustness, offline: on either path, a user that may not create databases opens a new project by borrowing a role that may, and hands the role back", async () => {
  const run = uniqueProjectName();
  // A database user that may not create databases, as a Cloud SQL IAM user is, and a role that
  // may, granted to it: what the two lines of the refusal above make.
  const user = `${run}@storytree.test`;
  const creator = `${run}-creator`;
  const [onCloud, onLocal, raced, later] = ["cloud", "local", "raced", "later"].map((part) => `${run}-${part}`) as [
    string,
    string,
    string,
    string,
  ];
  const opened: Storytree[] = [];
  try {
    await createTestRole(user, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${user}"`));
    const cloud = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });
    opened.push(cloud);
    const url = new URL(testServerUrl());
    url.username = user;
    const local = await connect({ url: url.href });
    opened.push(local);

    await assertBorrowed(await cloud.openProject(onCloud), user, creator);
    await assertBorrowed(await local.openProject(onLocal), user, creator);

    // Two first opens of one project racing each other, one on each path, are as safe as ever:
    // both succeed, and there is one database, set up once.
    const both = await Promise.all([cloud.openProject(raced), local.openProject(raced)]);
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
    await dropTestDatabases([onCloud, onLocal, raced, later].map((name) => `storytree_${name}`));
    await dropTestRoles([user, creator]);
  }
});

test("8.1 robustness, offline: of the roles a user may take on that may create databases, it borrows the first by name, reached directly or through another role, and never one it may not SET ROLE to", async () => {
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
    storytree = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });

    // The same role every time.
    for (const part of ["one", "two"]) await assertBorrowed(await storytree.openProject(`${run}-${part}`), user, throughGroup);
  } finally {
    await storytree?.close();
    await dropTestDatabases([`storytree_${run}-one`, `storytree_${run}-two`]);
    await dropTestRoles([user, group, notSettable, throughGroup, direct]);
  }
});

describe("8.1 robustness, offline: capability 2's behaviour suite, unchanged, in projects a user that may not create databases opened on the cloud path by borrowing a role that may", () => {
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
  transactionsBehaviourSuite("cloud-sql path, borrowing a creator role", async () => {
    const name = `${run}-${made.length + 1}`;
    const database = `storytree_${name}`;
    made.push(database);
    const storytree = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });
    const dispose = async (): Promise<void> => {
      try {
        await storytree.close();
      } finally {
        await dropAsUser(user, [database]);
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

test("8.1 robustness, offline: the live proof's cleanup drops a project database the borrowed role owns, over the user's own connection, even while the project is still open", async () => {
  const run = uniqueProjectName();
  const user = `${run}@storytree.test`;
  const creator = `${run}-creator`;
  const database = `storytree_${run}`;
  let storytree: Storytree | undefined;
  try {
    await createTestRole(user, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${user}"`));
    storytree = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });
    await assertBorrowed(await storytree.openProject(run), user, creator);
    assert.ok((await sessionsOn(database, user)) > 0, "precondition: the open project holds a session of the user's on its database");

    await dropAsUser(user, [database]);

    assert.deepEqual(await databasesContaining(run), [], "the database is gone");
  } finally {
    await storytree?.close();
    await dropTestDatabases([database]);
    await dropTestRoles([user, creator]);
  }
});

test("8.1 robustness, offline: cleanup still drops the database when a backend the user cannot terminate disconnects", async () => {
  const run = uniqueProjectName();
  const user = `${run}-owner`;
  const other = `${run}-other`;
  const database = `storytree_${run}`;
  try {
    await createTestRole(user, { createdb: true });
    await createTestRole(other, { createdb: false });
    await withTestClientAs(user, (client) => client.query(`CREATE DATABASE "${database}"`));
    await withTestClientAs(other, async (backend) => {
      await withTestClientAs(user, async (owner) => {
        let refusals = 0;
        await dropTestDatabases([database], {
          query: async (sql) => {
            try {
              return await owner.query(sql);
            } catch (error) {
              assert.equal(codeOf(error), "42501");
              assert.equal((error as { routine: string }).routine, "TerminateOtherDBBackends");
              refusals++;
              // Hold the otherwise timing-dependent backend until Postgres has refused to end it.
              await backend.end();
              throw error;
            }
          },
        });
        assert.equal(refusals, 1, "the server refused to terminate the other role's backend");
      });
    }, database);
    assert.deepEqual(await databasesContaining(run), [], "cleanup really dropped the database");
  } finally {
    await dropTestDatabases([database]);
    await dropTestRoles([user, other]);
  }
});

test("8.1 robustness, offline: cleanup still drops the database when a departing backend outlasts the server's own wait for it", async () => {
  const run = uniqueProjectName();
  const user = `${run}-owner`;
  const other = `${run}-other`;
  const database = `storytree_${run}`;
  try {
    await createTestRole(user, { createdb: true });
    await createTestRole(other, { createdb: false });
    await withTestClientAs(user, (client) => client.query(`CREATE DATABASE "${database}"`));
    await withTestClientAs(other, async (backend) => {
      await withTestClientAs(user, async (owner) => {
        let leaving: Promise<void> | undefined;
        await dropTestDatabases([database], {
          query: async (sql) => {
            try {
              return await owner.query(sql);
            } catch (error) {
              // The backend leaves, but only after DROP DATABASE has waited its 5 seconds for it,
              // as a terminated backend on Windows has been seen to (merge-group run 36827816565).
              leaving ??= new Promise((resolve) => setTimeout(resolve, 6_000)).then(() => backend.end());
              throw error;
            }
          },
        });
        await leaving;
      });
    }, database);
    assert.deepEqual(await databasesContaining(run), [], "cleanup really dropped the database");
  } finally {
    await dropTestDatabases([database]);
    await dropTestRoles([user, other]);
  }
});

/** A fake connector, and what it was asked. */
interface FakeGoogle {
  /** Makes the connector: what connect() is handed as its seam. */
  readonly make: () => Promise<CloudSqlConnector>;
  /** How many connectors were made. */
  made: number;
  /** What getOptions was asked, call by call. */
  readonly calls: unknown[];
  /** How many times a connector was closed. */
  closed: number;
}

/** A connector whose sign-in (getOptions) is `signIn`. It reaches nothing of its own. */
test("8.5 on a shared Cloud SQL instance, a project's pool holds at most three of the instance's connection slots, and busier work queues for them", async () => {
  const run = uniqueProjectName();
  const user = `${run}@storytree.test`;
  const project = `${run}-busy`;
  const opened: Storytree[] = [];
  try {
    await createTestRole(user, { createdb: true });
    const cloud = await connect({ cloudSql: { instance: INSTANCE, user } }, { connector: fakeGoogle(toTestServer).make });
    opened.push(cloud);
    const library = await cloud.openProject(project);

    const reads = Array.from({ length: 8 }, () => library.pool.query("SELECT pg_sleep(0.3)"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const held = await sessionsOn(`storytree_${project}`, user);
    await Promise.all(reads);

    assert.ok(held >= 1 && held <= 3, `the pool held ${held} connections at once`);
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([`storytree_${project}`]);
    await dropTestRoles([user]);
  }
});

function fakeGoogle(signIn: () => Promise<{ stream: () => Duplex }>): FakeGoogle {
  const google: FakeGoogle = {
    make: async () => {
      google.made += 1;
      return {
        getOptions: (options) => {
          google.calls.push({ ...options });
          return signIn();
        },
        close: () => {
          google.closed += 1;
        },
      };
    },
    made: 0,
    calls: [],
    closed: 0,
  };
  return google;
}

/**
 * A sign-in that succeeds as nobody, with the local test server in place of the instance: every
 * socket the stream opens goes there, and the server answers for the user connect() was given.
 */
async function toTestServer(): Promise<{ stream: () => Duplex }> {
  const server = new URL(testServerUrl());
  return { stream: () => connectingSocket(Number(server.port || 5432), server.hostname) };
}

/**
 * A socket already connecting to `host`:`port`, as the Cloud SQL connector hands pg one. pg calls
 * connect() on the stream it is given; like the connector's socket, this one ignores the call.
 */
function connectingSocket(port: number, host: string): Socket {
  const socket = openSocket(port, host);
  socket.connect = () => socket;
  return socket;
}

/**
 * Assert that a connector whose sign-in failed was not closed. It holds nothing to close, and
 * Google's close() would raise the failed lookup it keeps again, as an unhandled rejection: enough
 * to end a Node process.
 */
function assertNotClosed(google: FakeGoogle): void {
  assert.equal(google.closed, 0, "a connector whose sign-in failed is not closed");
}

/**
 * The Google libraries this process has loaded. The connector's own code is an ES module, but the
 * libraries it loads, google-auth-library and gaxios, are CommonJS and land in require's cache.
 */
function googleCodeLoaded(): string[] {
  return Object.keys(createRequire(import.meta.url).cache).filter((file) =>
    /[\\/]node_modules[\\/](?:google-auth-library|gaxios)[\\/]/.test(file),
  );
}

/** An HTTP failure as Google's client libraries throw one: a gaxios GaxiosError, with its status and the reply. */
function googleHttpError(status: number, message: string, data: unknown): Error {
  return Object.assign(new Error(message), { status, response: { status, data } });
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

/**
 * The ConnectionError `attempt` rejects with, refusing for `problem`, where the refusal is the
 * local test Postgres turning a login down, which it does by ending the connection. On Windows,
 * Postgres now and then resets that connection so that its refusal never reaches pg, which reports
 * only `read ECONNRESET` (on GitHub's Windows runners, 2026-09-26: 3 full runs of 21, always
 * here; never on Linux or macOS). Such an attempt shows nothing about storytree, so it is made
 * again, up to ten times, and each reset is reported. Ten, because resets can come in a row on a
 * busy machine: the development box once reset three attempts of five. The stand-in is what
 * resets, not a Cloud SQL instance, so this decides nothing about how storytree should treat a
 * reset from a real one.
 */
async function loginRefusalOf(
  t: TestContext,
  call: string,
  attempt: () => Promise<unknown>,
  problem: ConnectionProblem,
): Promise<ConnectionError> {
  for (let tries = 1; ; tries++) {
    try {
      await attempt();
    } catch (error) {
      if (codeOf(error) === "ECONNRESET" && tries < 10) {
        t.diagnostic(`${call}, try ${tries}: the test Postgres reset the connection before its refusal arrived; trying again`);
        continue;
      }
      return refusal(error, problem);
    }
    assert.fail(`expected a refusal (${problem}), but the call succeeded`);
  }
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
  // Signed in as the user itself, acting as the role that owns the database (contract 8.3), so a
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

/**
 * Drop `databases` as the live proof drops its own (dropOnInstance, src/transactions/cloud-sql.test.ts):
 * through the admin pool of a server reached on the cloud path as `user`, never as the superuser.
 */
async function dropAsUser(user: string, databases: readonly string[]): Promise<void> {
  const server = await cloudSqlServer({ instance: INSTANCE, user }, { connector: fakeGoogle(toTestServer).make });
  try {
    await dropTestDatabases(databases, server.admin);
  } finally {
    try {
      await server.admin.end();
    } finally {
      server.close();
    }
  }
}

/** How many sessions `user` has open on `database`. */
async function sessionsOn(database: string, user: string): Promise<number> {
  return withTestClient(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM pg_stat_activity WHERE datname = $1 AND usename = $2",
      [database, user],
    );
    return Number(rows[0]?.count ?? 0);
  });
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

/** Let the event loop turn until `condition` holds, failing the test if it never does. */
async function turnsUntil(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 200; turn++) {
    if (condition()) return;
    await turns(1);
  }
  assert.fail(`this never happened: ${what}`);
}

/** A value the compiler would refuse, sent the way a JavaScript caller could send it. */
function untyped(value: unknown): never {
  return value as never;
}
