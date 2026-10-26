/**
 * Capability 15 · Connection by address, ADR-1093 D2: a library at a wss:// address is reached over
 * HTTPS, through Cloudflare Access and the session's HTTPS_PROXY, by Neon's WebSocket driver. Each
 * test stands up what sits between a cloud session and the library on this machine: a CONNECT proxy
 * with an allow list (the agent proxy), and a gate that checks the Access headers over TLS, then
 * carries the WebSocket to Postgres as wsproxy does (Access, cloudflared and wsproxy in one). The
 * address names `library.test`, which only the proxy resolves; the gate presents the synthetic
 * certificate for that name in ../testing/tls, trusted here through addressServer's test-only `ca`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect as dial, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { saveKey } from "@storytree/keys";
import { WebSocketServer } from "ws";

import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { addressServer, connectionString } from "./address.js";
import { ConnectionError } from "./connection-error.js";
import { vectorServerIdentity } from "./embeddings.js";

const TLS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "testing", "tls");
const CA = readFileSync(path.join(TLS, "trusted-ca.crt"), "utf8");
const [TOKEN_ID, TOKEN_SECRET] = ["synthetic-id.access", "synthetic-access-secret"];

/** What the gate was asked: each upgrade's path and headers. */
interface Upgrade {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

/**
 * The gate: TLS for library.test, a 403 to any upgrade without the token, and every other upgrade's
 * WebSocket carried to `backend` (the test server, unless a test gives a peer of its own).
 */
async function gate(backend: { host: string; port: number }): Promise<{ port: number; upgrades: Upgrade[]; close: () => Promise<void> }> {
  const upgrades: Upgrade[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpsServer({ cert: readFileSync(path.join(TLS, "library.crt")), key: readFileSync(path.join(TLS, "library.key")) }, (_request, response) => {
    response.writeHead(426).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("connection", (socket: Socket) => { sockets.add(socket); socket.on("error", () => {}); });
  server.on("upgrade", (request, socket: Socket, head) => {
    upgrades.push({ url: request.url ?? "", headers: request.headers });
    if (request.headers["cf-access-client-id"] !== TOKEN_ID || request.headers["cf-access-client-secret"] !== TOKEN_SECRET) {
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const pg = dial(backend.port, backend.host);
      pg.on("error", () => ws.terminate());
      ws.on("error", () => pg.destroy());
      pg.on("data", (data) => ws.send(data));
      pg.on("close", () => ws.close());
      ws.on("message", (data) => pg.write(data as Buffer));
      ws.on("close", () => pg.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    upgrades,
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); wss.close(); server.close(() => resolve()); }),
  };
}

/** The agent proxy: CONNECT only, to library.test alone unless `allow` says otherwise, which it reaches at 127.0.0.1. */
async function proxy(allow = ["library.test"]): Promise<{ url: string; connects: string[]; close: () => Promise<void> }> {
  const connects: string[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpServer((_request, response) => response.writeHead(405).end());
  server.on("connection", (socket: Socket) => { sockets.add(socket); socket.on("error", () => {}); });
  server.on("connect", (request, socket: Socket, head) => {
    connects.push(request.url ?? "");
    const [host, port] = (request.url ?? "").split(":");
    if (!allow.includes(host!)) {
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    const upstream = dial(Number(port), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    connects,
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

/** A throwaway storytree home for the keys, with none of the variables they fall back on. */
function home(): string {
  const made = mkdtempSync(path.join(tmpdir(), "storytree-wss-"));
  process.env.STORYTREE_HOME = made;
  for (const name of ["PGPASSWORD", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET", "HTTPS_PROXY", "https_proxy"]) delete process.env[name];
  return made;
}

function saveToken(keys: string): void {
  saveKey("cf-access-client-id", TOKEN_ID, { home: keys });
  saveKey("cf-access-client-secret", TOKEN_SECRET, { home: keys });
}

function testServer(): { host: string; port: number } {
  const url = new URL(testServerUrl());
  return { host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(url.port || 5432) };
}

test("15.6 a wss:// address is reached through HTTPS_PROXY and the gate with the Access token, at wsproxy's /v1 for 127.0.0.1:5432, signing in by SCRAM with the postgres key", async () => {
  const run = uniqueProjectName();
  const [role, project, keys] = [`${run}-wss`, `storytree_${run}-wss`, home()];
  const [front, agent] = [await gate(testServer()), await proxy()];
  const server = { current: undefined as ReturnType<typeof addressServer> | undefined };
  try {
    await createTestRole(role, { createdb: true });
    saveKey("postgres", new URL(testRoleUrl(role)).password, { home: keys });
    saveToken(keys);
    process.env.HTTPS_PROXY = agent.url;
    // TLS, the proxy, the WebSocket and SCRAM before the first answer: a loaded Windows runner took
    // longer than 10 s (CI run 39974004167), so the connection gets 30 s.
    server.current = addressServer(`wss://${role}@library.test:${front.port}/postgres`, 30_000, {}, undefined, CA);
    const { admin } = server.current;
    assert.deepEqual((await admin.query<{ who: string }>("SELECT current_user AS who")).rows[0], { who: role });
    await admin.query(`CREATE DATABASE "${project}"`);
    const own = server.current.pool(project);
    assert.deepEqual((await own.query<{ db: string }>("SELECT current_database() AS db")).rows[0], { db: project });
    await own.end();
    assert.match(vectorServerIdentity(admin), /^[0-9a-f]{64}$/);

    assert.ok(agent.connects.length > 0 && agent.connects.every((target) => target === `library.test:${front.port}`), agent.connects.join());
    assert.ok(front.upgrades.length > 0);
    for (const upgrade of front.upgrades) {
      assert.equal(upgrade.url, "/v1?address=127.0.0.1:5432");
      assert.equal(upgrade.headers["cf-access-client-id"], TOKEN_ID);
      assert.equal(upgrade.headers["cf-access-client-secret"], TOKEN_SECRET);
    }
  } finally {
    await server.current?.admin.end().catch(() => {});
    await Promise.all([front.close(), agent.close()]);
    await dropTestDatabases([project]);
    await dropTestRoles([role]);
    await removeTemp(keys);
  }
});

test("15.6 a wss:// address with no Access token is refused before anything is dialled, naming the variable to set and no secret", async () => {
  const keys = home();
  try {
    saveKey("postgres", "synthetic-password", { home: keys });
    process.env.CF_ACCESS_CLIENT_SECRET = TOKEN_SECRET;
    assert.throws(() => addressServer("wss://someone@library.test/postgres"), (error: unknown) => {
      assert.ok(error instanceof ConnectionError, String(error));
      assert.equal(error.problem, "access");
      assert.match(error.message, /CF_ACCESS_CLIENT_ID/);
      assert.match(error.message, /storytree auth set cf-access-client-id/);
      assert.ok(!error.message.includes(TOKEN_SECRET) && !error.message.includes("synthetic-password"), error.message);
      return true;
    });
  } finally {
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    await removeTemp(keys);
  }
});

test("15.6 a wss:// address that sets sslmode or sslrootcert is refused, and has no connection string for psql", async () => {
  const keys = home();
  try {
    saveKey("postgres", "synthetic-password", { home: keys });
    saveToken(keys);
    for (const query of ["?sslmode=verify-full", "?sslrootcert=/tmp/library.crt"]) {
      assert.throws(() => addressServer(`wss://someone@library.test/postgres${query}`), (error: unknown) =>
        error instanceof ConnectionError && error.problem === "config" && /wss:\/\//.test(error.message) && /TLS/.test(error.message));
    }
    assert.throws(() => connectionString({ address: "wss://someone@library.test/postgres" }), (error: unknown) =>
      error instanceof ConnectionError && error.problem === "config" && /WebSocket/.test(error.message));
  } finally {
    await removeTemp(keys);
  }
});

test("15.6 an upgrade the agent proxy refuses and one the gate refuses each say which hop refused it, never showing a secret", async () => {
  const keys = home();
  const front = await gate(testServer());
  const agents = [await proxy([]), await proxy()];
  const opened: ReturnType<typeof addressServer>[] = [];
  try {
    saveKey("postgres", "synthetic-password", { home: keys });
    saveKey("cf-access-client-id", TOKEN_ID, { home: keys });
    saveKey("cf-access-client-secret", "not-the-access-secret", { home: keys });
    const address = `wss://someone@library.test:${front.port}/postgres`;

    process.env.HTTPS_PROXY = agents[0]!.url;
    opened.push(addressServer(address, 5_000, {}, undefined, CA));
    await assert.rejects(opened[0]!.admin.query("SELECT 1"), (error: unknown) => {
      const explained = opened[0]!.explain(error);
      assert.ok(explained instanceof ConnectionError, String(error));
      assert.equal(explained.problem, "unreachable");
      assert.match(explained.message, /HTTPS_PROXY/);
      assert.match(explained.message, /library\.test/);
      assert.ok(!explained.message.includes("not-the-access-secret"), explained.message);
      return true;
    });
    assert.equal(front.upgrades.length, 0);

    process.env.HTTPS_PROXY = agents[1]!.url;
    opened.push(addressServer(address, 5_000, {}, undefined, CA));
    await assert.rejects(opened[1]!.admin.query("SELECT 1"), (error: unknown) => {
      const explained = opened[1]!.explain(error);
      assert.ok(explained instanceof ConnectionError, String(error));
      assert.equal(explained.problem, "access");
      assert.match(explained.message, /Access/);
      assert.match(explained.message, /CF_ACCESS_CLIENT_ID/);
      assert.ok(!explained.message.includes("not-the-access-secret"), explained.message);
      return true;
    });
  } finally {
    await Promise.allSettled(opened.map((server) => server.admin.end()));
    await Promise.all([front.close(), ...agents.map((agent) => agent.close())]);
    await removeTemp(keys);
  }
});

test("15.6 a wss:// library that asks for the password in plain text is refused before the password is sent", async () => {
  const keys = home();
  const received: Buffer[] = [];
  const sockets = new Set<Socket>();
  let hungUp: () => void;
  const closed = new Promise<void>((resolve) => { hungUp = resolve; });
  // Asks for the password in plain text (AuthenticationCleartextPassword), then reads whatever comes until the client hangs up.
  const asker: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => hungUp());
    socket.on("error", () => {});
    socket.on("data", (data) => received.push(data));
    socket.once("data", () => socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3])));
  });
  await new Promise<void>((resolve) => asker.listen(0, "127.0.0.1", resolve));
  const front = await gate({ host: "127.0.0.1", port: (asker.address() as { port: number }).port });
  const agent = await proxy();
  let server: ReturnType<typeof addressServer> | undefined;
  try {
    saveKey("postgres", "synthetic-wss-password", { home: keys });
    saveToken(keys);
    process.env.HTTPS_PROXY = agent.url;
    server = addressServer(`wss://someone@library.test:${front.port}/postgres`, 5_000, {}, undefined, CA);
    await assert.rejects(server.admin.query("SELECT 1"), (error: unknown) => {
      const explained = server!.explain(error);
      assert.ok(explained instanceof ConnectionError, String(error));
      assert.equal(explained.problem, "untrusted-server");
      return true;
    });
    await closed;
    assert.ok(received.length > 0, "the peer heard nothing");
    assert.ok(!Buffer.concat(received).includes("synthetic-wss-password"), "the password was sent");
  } finally {
    await server?.admin.end().catch(() => {});
    for (const socket of sockets) socket.destroy();
    await Promise.all([front.close(), agent.close(), new Promise((resolve) => asker.close(resolve))]);
    await removeTemp(keys);
  }
});
