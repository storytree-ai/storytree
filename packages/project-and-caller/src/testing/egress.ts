import { readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";

import { waitUntil } from "@storytree/test-waits";
import pg from "pg";

import { testServerDataDir, testServerUrl } from "./pg.js";

export interface CountingStore {
  readonly port: number;
  received(): number;
  settled(quietMs?: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

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
      await waitUntil(() => open === 0 && Date.now() - lastActivity >= quietMs, timeoutMs, `the library's connections to close and stay quiet for ${quietMs} ms`);
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

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
