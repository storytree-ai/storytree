/**
 * Capability 15 · Connection by address, ADR-0943 D1: a library at a remote address gets its
 * password only after the server proves who it is with a certificate storytree checks. Each test
 * dials a disposable peer that speaks just enough of Postgres's wire protocol to ask for the
 * password in plain text, and records every byte it is sent. The address names `library.test`,
 * which is not a local address, and the socket is pointed at the peer on this machine; the
 * certificate is still checked against `library.test`. The certificates in ../testing/tls are
 * synthetic, made for these tests alone (trusted-ca.crt signed library.crt and elsewhere.crt;
 * impostor.crt is signed by a CA nobody trusts).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";

import { saveKey } from "@storytree/keys";

import { addressServer } from "./address.js";
import { ConnectionError } from "./connection-error.js";

const TLS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "testing", "tls");
const SECRET = "synthetic-remote-secret";
const SSL_REQUEST = 80877103;

type Certificate = "library" | "elsewhere" | "impostor";

/** How the peer answers: with no TLS at all, or over TLS with `certificate`, then asking for the password in plain text or letting the client in. */
interface Peer {
  readonly tls?: Certificate;
  readonly then: "cleartext" | "let-in";
}

/** A peer listening on this machine, and every byte any client sent it, decrypted. */
async function peer(behaviour: Peer): Promise<{ port: number; received: () => string; close: () => Promise<void> }> {
  const chunks: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((raw) => {
    sockets.add(raw);
    raw.on("error", () => {});
    raw.once("data", (first) => {
      chunks.push(first);
      if (first.length >= 8 && first.readInt32BE(4) === SSL_REQUEST) {
        if (behaviour.tls === undefined) {
          raw.write("N");
          raw.once("data", (startup) => { chunks.push(startup); answer(raw); });
          return;
        }
        raw.write("S");
        const secure = new TLSSocket(raw, {
          isServer: true,
          cert: readFileSync(path.join(TLS, `${behaviour.tls}.crt`)),
          key: readFileSync(path.join(TLS, `${behaviour.tls}.key`)),
        });
        secure.on("error", () => {});
        secure.once("data", (startup) => { chunks.push(startup); answer(secure); });
        return;
      }
      // No SSLRequest: this was the startup message, sent in the clear.
      answer(raw);
    });
  });
  function answer(socket: Socket): void {
    socket.on("data", (chunk) => chunks.push(chunk));
    if (behaviour.then === "cleartext") {
      socket.write(message("R", int32(3)));
    } else {
      socket.write(Buffer.concat([message("R", int32(0)), message("Z", Buffer.from("I"))]));
    }
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    port,
    received: () => Buffer.concat(chunks).toString("latin1"),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function message(type: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
}

/** A throwaway storytree home holding the synthetic password as the `postgres` key. */
function home(): string {
  const made = mkdtempSync(path.join(tmpdir(), "storytree-address-tls-"));
  process.env.STORYTREE_HOME = made;
  delete process.env.PGPASSWORD;
  saveKey("postgres", SECRET, { home: made });
  return made;
}

const PINNED = `sslrootcert=${encodeURIComponent(path.join(TLS, "trusted-ca.crt"))}`;

/** Connect the admin pool, then a project's, to the peer behaving as `behaviour`, at an address naming library.test. */
async function connectBoth(behaviour: Peer, query = PINNED): Promise<{ admin: unknown; project: unknown; received: string }> {
  const keys = home();
  const listening = await peer(behaviour);
  const address = `postgres://someone@library.test:5432/postgres${query === "" ? "" : `?${query}`}`;
  const server = addressServer(address, 5_000, {}, { host: "127.0.0.1", port: listening.port });
  const attempt = async (pool: { connect(): Promise<{ release(): void }> }) => {
    try {
      (await pool.connect()).release();
      return "connected";
    } catch (error) {
      return server.explain(error);
    }
  };
  try {
    const admin = await attempt(server.admin);
    const project = await attempt(server.pool("storytree_project"));
    return { admin, project, received: listening.received() };
  } finally {
    await Promise.allSettled([server.admin.end()]);
    server.close();
    await listening.close();
    rmSync(keys, { recursive: true, force: true });
  }
}

function assertRefused(outcome: unknown, problem: string, pattern: RegExp): void {
  assert.ok(outcome instanceof ConnectionError, `expected a refusal, got ${String(outcome)}`);
  assert.equal(outcome.problem, problem);
  assert.match(outcome.message, pattern);
  assert.ok(!outcome.message.includes(SECRET), outcome.message);
}

test("15.4 a remote address that answers without TLS is refused before the password is sent, on the admin and project pools", async () => {
  const { admin, project, received } = await connectBoth({ then: "cleartext" }, "");
  assert.ok(!received.includes(SECRET), "the peer received the password");
  assertRefused(admin, "untrusted-server", /TLS/);
  assertRefused(project, "untrusted-server", /TLS/);
});

test("15.4 a remote address whose certificate no trusted authority signed is refused before the password is sent", async () => {
  const { admin, project, received } = await connectBoth({ tls: "impostor", then: "cleartext" });
  assert.ok(!received.includes(SECRET), "the peer received the password");
  assertRefused(admin, "untrusted-server", /certificate/);
  assertRefused(project, "untrusted-server", /certificate/);
});

test("15.4 a remote address whose trusted certificate names another host is refused before the password is sent", async () => {
  const { admin, project, received } = await connectBoth({ tls: "elsewhere", then: "cleartext" });
  assert.ok(!received.includes(SECRET), "the peer received the password");
  assertRefused(admin, "untrusted-server", /library\.test/);
  assertRefused(project, "untrusted-server", /library\.test/);
});

test("15.4 a remote address presenting the pinned certificate for its name connects, on the admin and project pools", async () => {
  const { admin, project } = await connectBoth({ tls: "library", then: "let-in" });
  assert.equal(admin, "connected");
  assert.equal(project, "connected");
});

test("15.4 a remote address that proves itself but asks for the password in plain text is refused before the password is sent", async () => {
  const { admin, project, received } = await connectBoth({ tls: "library", then: "cleartext" });
  assert.ok(!received.includes(SECRET), "the peer received the password");
  assertRefused(admin, "untrusted-server", /plain text/);
  assertRefused(project, "untrusted-server", /plain text/);
});

test("15.4 an address asking for a weaker check, or overriding the host it dials, is refused before reaching any server", () => {
  const keys = home();
  try {
    for (const query of ["sslmode=disable", "sslmode=require", "sslmode=no-verify", "ssl=true", "sslcert=client.crt", "host=elsewhere.test", "port=6543"]) {
      assert.throws(
        () => addressServer(`postgres://someone@library.test:5432/postgres?${query}`),
        (error: unknown) => {
          assert.ok(error instanceof ConnectionError, String(error));
          assert.equal(error.problem, "config", query);
          return true;
        },
        query,
      );
    }
  } finally {
    rmSync(keys, { recursive: true, force: true });
  }
});
