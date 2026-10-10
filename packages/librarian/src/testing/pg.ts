/**
 * Helpers for the librarian's tests, which run against the real Postgres `pnpm test` starts
 * (packages/dev-loop/src/test.mjs hands it over as STORYTREE_TEST_PG_URL). A Postgres test must never skip
 * silently, so asking for the server when there is none throws. The library keeps its own helpers
 * inside its package, so the few needed here are restated, as the agent link's are.
 */
import { randomBytes } from "node:crypto";
import { connect as connectSocket, createServer, type AddressInfo, type Socket } from "node:net";

import { connect, type Library } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import pg from "pg";

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
    await dropTestProject(project);
  }
}

/** What withCountedLibrary hands its body: the library, read through a stand-in that counts what the server sends. */
export interface CountedLibrary {
  readonly library: Library;
  readonly project: string;
  /** The bytes the server has sent the library so far, as a cloud database bills them (its egress). */
  received(): number;
}

/**
 * Run `body` with a fresh project's library whose every connection goes through a stand-in for the
 * network in front of the test server, counting the bytes the server sends back. Restated from the
 * agent link's countingStore, as the rest of these helpers are.
 */
export async function withCountedLibrary(body: (counted: CountedLibrary) => Promise<void>): Promise<void> {
  const upstream = new URL(testServerUrl());
  let received = 0;
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    const server = connectSocket(Number(upstream.port || 5432), upstream.hostname);
    for (const socket of [client, server]) sockets.add(socket);
    server.on("data", (chunk: Buffer) => {
      received += chunk.length;
    });
    client.pipe(server).pipe(client);
    const done = () => {
      for (const socket of [client, server]) {
        socket.destroy();
        sockets.delete(socket);
      }
    };
    for (const socket of [client, server]) socket.on("close", done).on("error", done);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const counted = new URL(upstream.href);
  counted.hostname = "127.0.0.1";
  counted.port = String((proxy.address() as AddressInfo).port);
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url: counted.href });
  try {
    const library = await storytree.openProject(project);
    try {
      await body({ library, project, received: () => received });
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await dropTestProject(project);
  }
}

/**
 * Write `entries` health changes into `project`'s history, straight into the table as weeks of CI
 * runs leave them (each about half a kilobyte), from `at` on, a second apart, and none into its
 * records. Not through the counted connection. Returns how many bytes the history now holds.
 */
export async function healthHistory(project: string, entries: number, at: Date): Promise<number> {
  const url = new URL(testServerUrl());
  url.pathname = `/storytree_${project}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO record_event (record_id, type, action, record, actor, at)
       SELECT 'health_contract_' || (g % 1000) || '_verified', 'health', 'updated',
         jsonb_build_object('id', 'health_contract_' || (g % 1000) || '_verified', 'type', 'health', 'version', 1,
           'fields', jsonb_build_object('contract', 'contract_' || (g % 1000), 'column', 'verified', 'state', 'passing', 'by', 'project CI',
             'note', 'passed in CI ' || repeat('x', 300)),
           'createdAt', $2::timestamptz, 'updatedAt', $2::timestamptz + g * interval '1 second'),
         'storytree test run on CI', $2::timestamptz + g * interval '1 second'
       FROM generate_series(1, $1::int) AS g`,
      [entries, at.toISOString()],
    );
    const { rows } = await client.query<{ bytes: string }>("SELECT coalesce(sum(pg_column_size(record_event.*)), 0) AS bytes FROM record_event");
    return Number(rows[0]!.bytes);
  } finally {
    await client.end();
  }
}

async function dropTestProject(name: string): Promise<void> {
  await dropTestDatabases([`storytree_${name}`]);
}
