import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { addressServer } from '/repo/packages/library/src/project/address.ts';

// Only a synthetic credential and in-memory protocol bytes; no sockets or database.
const password = 'synthetic-B-transport-only';
mkdirSync('/work/keys', { mode: 0o700 });
process.env.STORYTREE_HOME = '/work/keys';
process.env.PGPASSWORD = password;
delete process.env.PGSSLMODE;

async function probe(query: string) {
  let sslRequested = false, passwordEmitted = false, startup = false;
  class Peer extends Duplex {
    _read() {}
    setNoDelay() {}
    setKeepAlive() {}
    connect() { queueMicrotask(() => this.emit('connect')); return this; }
    _write(bytes: Buffer, _encoding: string, done: () => void) {
      if (bytes.length === 8 && bytes.readUInt32BE(4) === 80877103) {
        sslRequested = true;
        queueMicrotask(() => this.push(Buffer.from('N')));
      } else if (!startup) {
        startup = true;
        const challenge = Buffer.alloc(9);
        challenge[0] = 82; challenge.writeUInt32BE(8, 1); challenge.writeUInt32BE(3, 5);
        queueMicrotask(() => this.push(challenge));
      } else if (bytes[0] === 112) {
        passwordEmitted = bytes.subarray(5, -1).toString() === password;
        queueMicrotask(() => this.destroy());
      }
      done();
    }
    _final(done: () => void) { this.push(null); this.destroy(); done(); }
  }
  const server = addressServer(`postgres://synthetic@db.example.invalid/synthetic${query}`, 750);
  const pool = server.admin;
  pool.options.stream = () => new Peer();
  let outcome = '';
  try { await pool.connect(); } catch (error) { outcome = (error as Error).message; }
  await pool.end(); server.close();
  return { sslRequested, passwordEmitted, outcome };
}

async function main() {
  const plain = await probe('');
  assert.equal(plain.sslRequested, false); assert.equal(plain.passwordEmitted, true);
  const verified = await probe('?sslmode=verify-full');
  assert.equal(verified.sslRequested, true); assert.equal(verified.passwordEmitted, false);
  assert.match(verified.outcome, /does not support SSL/);
  console.log(JSON.stringify({ plain, verified, limit: 'In-memory handshake only; no on-path position, deployment settings, TLS certificate or live credential tested.' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
