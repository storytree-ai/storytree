import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { saveKey } from '/repo/packages/keys/src/keys.ts';
import { addressServer } from '/repo/packages/library/src/project/address.ts';

// Only disposable synthetic credentials and a protocol stand-in inside the broker sandbox.
const syntheticPassword = 'synthetic-transport-only-42';
const testHome = '/work/transport-home';

async function trial(label: string, query: string) {
  let sslRequested = false;
  let passwordReceived = false;
  let passwordMatched = false;
  let connections = 0;
  const sockets = new Set<Socket>();
  const listener = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(1500, () => socket.destroy());
    let stage = 'startup';
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 4096) { socket.destroy(); return; }
      if (stage === 'startup') {
        if (pending.length < 8) return;
        const length = pending.readInt32BE(0);
        if (length < 8 || length > 4096) { socket.destroy(); return; }
        if (pending.length < length) return;
        if (length === 8 && pending.readInt32BE(4) === 80877103) {
          sslRequested = true;
          stage = 'done';
          socket.end('N');
          return;
        }
        assert.equal(pending.readInt32BE(4), 196608);
        pending = pending.subarray(length);
        stage = 'password';
        const auth = Buffer.alloc(9);
        auth[0] = 0x52;
        auth.writeInt32BE(8, 1);
        auth.writeInt32BE(3, 5); // AuthenticationCleartextPassword
        socket.write(auth);
      }
      if (stage === 'password') {
        if (pending.length < 5) return;
        const length = pending.readInt32BE(1);
        if (length < 4 || length > 4096) { socket.destroy(); return; }
        if (pending.length < length + 1) return;
        passwordReceived = pending[0] === 0x70;
        passwordMatched = passwordReceived && pending.subarray(5, length).toString() === syntheticPassword;
        stage = 'done';
        const fields = Buffer.from('SFATAL\0C28P01\0Msynthetic refusal\0\0');
        const refusal = Buffer.alloc(fields.length + 5);
        refusal[0] = 0x45;
        refusal.writeInt32BE(fields.length + 4, 1);
        fields.copy(refusal, 5);
        socket.end(refusal);
      }
    });
  });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  const access = addressServer(`postgres://synthetic_user@127.0.0.1:${port}/synthetic_db${query}`, 1000, { waitMs: 50 });
  let connectionRejected = false;
  try {
    await access.admin.connect().then(client => client.release(), () => { connectionRejected = true; });
  } finally {
    await access.admin.end();
    access.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
  assert.equal(connections, 1);
  assert.equal(connectionRejected, true);
  return { label, sslRequested, passwordReceived, passwordMatched, connectionRejected };
}

async function main() {
  mkdirSync(testHome, { mode: 0o700 });
  process.env.STORYTREE_HOME = testHome;
  delete process.env.PGSSLMODE;
  delete process.env.PGPASSWORD;
  saveKey('postgres', syntheticPassword, { home: testHome });
  const plain = await trial('no-ssl-options', '');
  assert.equal(plain.sslRequested, false);
  assert.equal(plain.passwordMatched, true);
  console.log(JSON.stringify(plain));
  const tls = await trial('verify-full-refused-by-peer', '?sslmode=verify-full');
  assert.equal(tls.sslRequested, true);
  assert.equal(tls.passwordReceived, false);
  console.log(JSON.stringify(tls));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
