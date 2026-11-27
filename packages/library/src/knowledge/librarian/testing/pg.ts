import { randomBytes } from "node:crypto";
import { connect as connectSocket, createServer, type AddressInfo, type Socket } from "node:net";

import { connect, type Library } from "../../../index.js";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import pg from "pg";

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
    await dropTestProject(project);
  }
}

export interface CountedLibrary {
  readonly library: Library;
  readonly project: string;
  received(): number;
}

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
