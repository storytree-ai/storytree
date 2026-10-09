/** Capability 1 · Local connections must not disclose credentials to a substituted listener. */
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";

import { ConnectionError } from "./connection-error.js";
import { localServer } from "./server.js";

// Synthetic only; punctuation exercises the same URL encoding as authenticated discovery.
const password = "synthetic-local-password-:@/#?% with spaces";

for (const method of ["cleartext", "MD5"] as const) {
  test(`1.14 local admin and project pools reject ${method} authentication without sending credentials`, async () => {
    const sockets = new Set<Socket>();
    const closed: Promise<void>[] = [];
    const received: Buffer[] = [];
    const databases: string[] = [];
    const peer = createServer((socket) => {
      sockets.add(socket);
      closed.push(new Promise<void>((resolve) => socket.once("close", () => resolve())));
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let startup = Buffer.alloc(0);
      let asked = false;
      socket.on("data", (chunk: Buffer) => {
        if (asked) {
          received.push(chunk);
          socket.end();
          return;
        }
        startup = Buffer.concat([startup, chunk]);
        if (startup.length < 4 || startup.length < startup.readInt32BE(0)) return;
        const fields = startup.subarray(8).toString().split("\0");
        databases.push(fields[fields.indexOf("database") + 1]!);
        asked = true;
        // PostgreSQL AuthenticationCleartextPassword (3) / AuthenticationMD5Password (5).
        const request = Buffer.alloc(method === "cleartext" ? 9 : 13);
        request[0] = 0x52;
        request.writeInt32BE(request.length - 1, 1);
        request.writeInt32BE(method === "cleartext" ? 3 : 5, 5);
        if (method === "MD5") request.writeUInt32BE(0x12345678, 9);
        socket.write(request);
      });
    });
    await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
    const port = (peer.address() as { port: number }).port;
    const server = localServer(new URL(`postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`));
    const project = server.pool("storytree_synthetic");
    try {
      // Repeated attempts also pin newly created pooled connections after a refusal.
      for (const pool of [server.admin, project, server.admin, project]) {
        const error = await pool.query("SELECT 42").then(() => undefined, (error: unknown) => error);
        await Promise.all(closed);
        assert.equal(Buffer.concat(received).length, 0, `${method}: the peer must receive no credential response`);
        assert.ok(error instanceof ConnectionError);
        assert.equal(error.problem, "config");
        assert.match(error.message, /local database.*SCRAM/i);
        assert.equal(error.message.includes(password), false);
      }
      assert.deepEqual(databases, ["postgres", "storytree_synthetic", "postgres", "storytree_synthetic"]);
    } finally {
      await Promise.all([server.admin.end(), project.end()]);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  });
}

test("1.14 a local password URL refuses a listener that skips authentication, sending it no query", async () => {
  const sockets = new Set<Socket>();
  const received: Buffer[] = [];
  const peer = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let startup = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (chunk: Buffer) => {
      if (answered) {
        received.push(chunk);
        socket.end();
        return;
      }
      startup = Buffer.concat([startup, chunk]);
      if (startup.length < 4 || startup.length < startup.readInt32BE(0)) return;
      answered = true;
      // PostgreSQL AuthenticationOk (R, 0) then ReadyForQuery (Z, idle): no authentication at all.
      socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
    });
  });
  await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
  const port = (peer.address() as { port: number }).port;
  const withPassword = localServer(new URL(`postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`));
  const project = withPassword.pool("storytree_synthetic");
  const passwordless = localServer(new URL(`postgres://postgres@127.0.0.1:${port}/postgres`));
  try {
    for (const pool of [withPassword.admin, project]) {
      const error = await pool.query("SELECT 42").then(() => undefined, (error: unknown) => error);
      assert.ok(error instanceof ConnectionError, String(error));
      assert.equal(error.problem, "config");
      assert.match(error.message, /local database.*without.*SCRAM/i);
      assert.equal(error.message.includes(password), false);
    }
    assert.equal(Buffer.concat(received).toString().includes("SELECT 42"), false, "the impostor must receive no query");
    // With no password configured there is nothing to protect: the passwordless test harness still connects.
    // pg falls back to PGPASSWORD (GitHub's Windows image sets one), which would be a password to protect.
    const pgPassword = process.env.PGPASSWORD;
    delete process.env.PGPASSWORD;
    try {
      const client = await passwordless.admin.connect();
      client.release();
    } finally {
      if (pgPassword !== undefined) process.env.PGPASSWORD = pgPassword;
    }
  } finally {
    await Promise.all([withPassword.admin.end(), project.end(), passwordless.admin.end()]);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});
