/**
 * A stand-in for the store's network, for the tests that pin how much a reader takes from it: every
 * connection is passed on to the test Postgres, and the bytes the server sends back are counted, as
 * Cloud SQL bills them (its egress).
 */
import { readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import pg from "pg";

import { testServerDataDir, testServerUrl } from "./pg.js";

export interface CountingStore {
  /** The port to give a reader in place of the server's. */
  readonly port: number;
  /** The bytes the server has sent through it so far. */
  received(): number;
  /** Resolves once no connection has been open, and nothing sent, for `quietMs`: the readers it served are done. */
  settled(quietMs?: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Start a counting stand-in in front of the test Postgres. */
export async function countingStore(): Promise<CountingStore> {
  const { port: upstreamPort } = JSON.parse(readFileSync(`${testServerDataDir()}.owner.json`, "utf8")) as { port: number };
  let received = 0;
  let open = 0;
  let lastActivity = Date.now();
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    open += 1;
    lastActivity = Date.now();
    sockets.add(client);
    const upstream = connect(upstreamPort, "127.0.0.1");
    sockets.add(upstream);
    upstream.on("data", (chunk: Buffer) => {
      received += chunk.length;
      lastActivity = Date.now();
    });
    client.pipe(upstream).pipe(client);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      open -= 1;
      lastActivity = Date.now();
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("close", done).on("error", done);
    upstream.on("close", done).on("error", done);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received: () => received,
    async settled(quietMs = 1_000, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && (open > 0 || Date.now() - lastActivity < quietMs)) await sleep(50);
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Fill `project`'s log with a long history from three days ago: `sessions` old sessions, each with
 * fat shell commands (a kilobyte each, as heredocs make them), file edits and tool calls. Written
 * straight into the table, as a log that has grown for weeks would hold them. Returns how many bytes
 * the project's lines take in the table.
 */
export async function longHistory(project: string, folder: string, sessions: number, machine: string): Promise<number> {
  const url = new URL(testServerUrl());
  url.pathname = "/storytree-activity";
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    const perSession = 60;
    await client.query(
      `INSERT INTO activity (project, at, session, harness, source, kind, folder, detail)
       SELECT $1, now() - interval '3 days' + g * interval '1 second', 'old-' || (g / $4::int), 'claude-code', 'hook',
         (ARRAY['command-started', 'command-run', 'command-started', 'command-run', 'file-edited', 'tool-called'])[g % 6 + 1], $2,
         CASE g % 6
           WHEN 4 THEN jsonb_build_object('files', jsonb_build_array($2::text || '/src/file-' || g || '.ts'), 'machine', $3::text)
           WHEN 5 THEN jsonb_build_object('tool', 'open', 'machine', $3::text)
           ELSE jsonb_build_object('command', 'cat <<EOF ' || repeat('x', 1000) || ' EOF', 'call', 'call-' || (g / 2), 'machine', $3::text)
         END
       FROM generate_series(1, $5::int) AS g`,
      [project, folder, machine, perSession, sessions * perSession],
    );
    const { rows } = await client.query<{ bytes: string }>("SELECT coalesce(sum(pg_column_size(activity.*)), 0) AS bytes FROM activity WHERE project = $1", [project]);
    return Number(rows[0]!.bytes);
  } finally {
    await client.end();
  }
}
