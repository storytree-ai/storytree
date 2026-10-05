/**
 * A stand-in for the store's network, for the tests that pin how much a reader takes from it: every
 * connection is passed on to the test Postgres, and the bytes the server sends back are counted, as
 * Cloud SQL bills them (its egress).
 */
import { readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { testServerDataDir } from "./pg.js";

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
