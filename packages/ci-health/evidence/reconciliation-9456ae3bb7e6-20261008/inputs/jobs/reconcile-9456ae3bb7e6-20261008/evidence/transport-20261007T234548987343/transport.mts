import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { addressServer } from "/repo/packages/library/src/project/address.ts";

// All sockets are confined to the runner's private network namespace. No real credentials.
process.env.PGPASSWORD = "synthetic-reconciliation-password";
delete process.env.PGSSLMODE;
for (const tls of [false, true]) {
  let sslRequested = false, passwordMatched = false;
  const sockets = new Set();
  const listener = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0), started = false;
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!started && buffered.length >= 8) {
        if (buffered.readInt32BE(4) === 80877103) {
          sslRequested = true; socket.end("N"); return;
        }
        const length = buffered.readInt32BE(0);
        if (buffered.length < length) return;
        buffered = buffered.subarray(length); started = true;
        const request = Buffer.alloc(9); request[0] = 82;
        request.writeInt32BE(8, 1); request.writeInt32BE(3, 5);
        socket.write(request);
      }
      if (started && buffered.length >= 5 && buffered[0] === 112) {
        const length = buffered.readInt32BE(1);
        if (buffered.length < length + 1) return;
        passwordMatched = buffered.subarray(5, length).toString() === process.env.PGPASSWORD;
        socket.end();
      }
    });
  });
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  const access = addressServer(`postgres://synthetic@127.0.0.1:${port}/synthetic${tls ? "?sslmode=verify-full" : ""}`, 1000);
  try { await assert.rejects(access.admin.query("SELECT 1")); }
  finally { await access.admin.end(); access.close(); for (const s of sockets) s.destroy(); await new Promise(r => listener.close(r)); }
  assert.equal(sslRequested, tls); assert.equal(passwordMatched, !tls);
  console.log(JSON.stringify({case: tls ? "verified-tls-refusal-control" : "default-address-handshake", sslRequested, syntheticPasswordReceivedBeforeServerAuthentication: passwordMatched}));
}
