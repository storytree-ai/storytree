// Capability 3: dropping a throwaway test database, against the server `pnpm test` starts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { test } from "node:test";

import pg from "pg";

import { dropTestDatabases } from "./drop.js";

const testName = (): string => `t-${randomBytes(4).toString("hex")}`;

function adminUrl(database?: string): string {
  const url = new URL(process.env["STORYTREE_TEST_PG_ADMIN_URL"] || process.env["STORYTREE_TEST_PG_URL"] || "");
  if (database !== undefined) url.pathname = `/${database}`;
  return url.href;
}

test("3.1 only a database named with a test token is dropped; any other name is refused before anything is sent to the server", async () => {
  let sent = 0;
  const server = { query: async () => { sent++; } };
  await assert.rejects(dropTestDatabases([testName(), "storytree_storytree"], server), /refusing to drop database "storytree_storytree"/);
  assert.equal(sent, 0);
  await dropTestDatabases([`storytree_${testName()}`], server);
  assert.equal(sent, 1);
});

test("3.2 a drop ends the connections still open to the database, and a missing one is skipped", async () => {
  const name = testName();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const open = new pg.Client({ connectionString: adminUrl(name) });
    open.on("error", () => {});
    await open.connect();
    await dropTestDatabases([name, testName()]);
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    assert.equal(rows.length, 0);
    await open.end().catch(() => {});
  } finally {
    await admin.end();
  }
});

test("3.2 a drop falls back to a plain DROP when Postgres refuses to end another backend, and propagates a database still in use after a bounded number of tries", async () => {
  const termination = Object.assign(new Error("permission denied to terminate process"), {
    code: "42501", routine: "TerminateOtherDBBackends",
  });
  const occupied = Object.assign(new Error("database is being accessed by other users"), { code: "55006", routine: "dropdb" });
  const statements: string[] = [];
  await assert.rejects(dropTestDatabases([testName()], {
    query: async (text: string) => { statements.push(text); throw statements.length === 1 ? termination : occupied; },
  }), (caught: unknown) => caught === occupied);
  assert.equal(statements.length, 7, "FORCE, then plain DROP and its five retries");
  assert.match(statements[0]!, /WITH \(FORCE\)$/);
  assert.doesNotMatch(statements[1]!, /FORCE/);
});

test("3.2 a drop propagates every other error at once", async () => {
  for (const error of [
    Object.assign(new Error("must be owner of database"), { code: "42501", routine: "dropdb" }),
    Object.assign(new Error("database has prepared transactions"), { code: "55006", routine: "TerminateOtherDBBackends" }),
  ]) {
    let attempts = 0;
    await assert.rejects(dropTestDatabases([testName()], {
      query: async () => { attempts++; throw error; },
    }), (caught: unknown) => caught === error);
    assert.equal(attempts, 1);
  }
});

/** What a stand-in server does with one connection, once the client has sent its startup packet. */
type Answer = "reset" | "full" | "through";

/** A Postgres ErrorResponse refusing the connection for want of a slot, as the server sends it. */
function tooManyClients(): Buffer {
  const fields = Buffer.concat([
    ...[["S", "FATAL"], ["V", "FATAL"], ["C", "53300"], ["M", "sorry, too many clients already"]]
      .map(([kind, value]) => Buffer.from(`${kind}${value}\0`)),
    Buffer.from([0]),
  ]);
  const length = Buffer.alloc(4);
  length.writeInt32BE(fields.length + 4);
  return Buffer.concat([Buffer.from("E"), length, fields]);
}

/**
 * A stand-in for the test server on 127.0.0.1: the nth connection (from 1) is answered as
 * `answer(n)` says, and one let through is piped to the real test server. While `run` runs, the
 * drop's superuser url names the stand-in; it is restored afterwards.
 */
async function throughStandIn(answer: (n: number) => Answer, run: () => Promise<void>): Promise<number> {
  const real = new URL(adminUrl());
  const sockets = new Set<net.Socket>();
  let connections = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    const what = answer(++connections);
    if (what === "through") {
      const upstream = net.connect(Number(real.port || 5432), real.hostname);
      sockets.add(upstream);
      upstream.on("error", () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
      return;
    }
    socket.once("data", () => {
      if (what === "reset") socket.resetAndDestroy();
      else socket.end(tooManyClients());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const standIn = new URL(real.href);
  standIn.hostname = "127.0.0.1";
  standIn.port = String((server.address() as net.AddressInfo).port);
  const before = process.env["STORYTREE_TEST_PG_ADMIN_URL"];
  process.env["STORYTREE_TEST_PG_ADMIN_URL"] = standIn.href;
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env["STORYTREE_TEST_PG_ADMIN_URL"];
    else process.env["STORYTREE_TEST_PG_ADMIN_URL"] = before;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  return connections;
}

/** Make a database on the real test server for `run`, which is handed its name and a way to ask whether it still exists. */
async function withDatabase(run: (name: string, exists: () => Promise<boolean>) => Promise<void>): Promise<void> {
  const name = testName();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  const exists = async (): Promise<boolean> =>
    (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rows.length > 0;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await run(name, exists);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

for (const [refusal, answer] of [
  ["resets its connection while it opens", "reset"],
  ["refuses its connection for want of a slot (53300)", "full"],
] as const) {
  test(`3.3 a drop asks again when the server ${refusal}, and drops the database through the connection that gets in`, async () => {
    await withDatabase(async (name, exists) => {
      const connections = await throughStandIn((n) => (n <= 2 ? answer : "through"), () => dropTestDatabases([name]));
      assert.equal(await exists(), false, "the database is gone");
      assert.equal(connections, 3, "two refused connections, then the one that got in");
    });
  });

  test(`3.3 a drop propagates a server that ${refusal} every time, after a bounded number of asks`, { timeout: 15_000 }, async () => {
    let caught: unknown;
    const connections = await throughStandIn(() => answer, async () => {
      await dropTestDatabases([testName()]).catch((error: unknown) => { caught = error; });
    });
    assert.ok(caught instanceof Error, "the drop fails");
    if (answer === "reset") assert.equal((caught as { code?: unknown }).code, "ECONNRESET");
    else assert.equal((caught as { code?: unknown }).code, "53300");
    assert.ok(connections > 1, `it asked again (${connections} connection(s))`);
    assert.ok(connections <= 10, `a bounded number of times (${connections} connections)`);
  });
}
