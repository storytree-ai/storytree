#!/usr/bin/env node
// Exercise dump/restore against unique local fixtures without reading Cloud SQL.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { operator as o } from './host.mjs';

if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Usage: verify-local.mjs [--dry-run]');
if (process.argv.includes('--dry-run')) {
  console.log('DRY RUN: create two unique, marked local fixture databases; dump/restore/check schemas, indexes, sequence state and counts; reject a bad hash; drop only those fixtures. No changes.');
} else {
  process.umask(0o077);
  const lock = await o.operationLock();
  const id = randomBytes(8).toString('hex');
  const source = `st_fixture_${id}`, target = `st_restored_${id}`;
  const directory = path.join(o.LOGS, 'fixture-' + o.stamp());
  const created = [];
  try {
    await mkdir(directory, { mode: 0o700 });
    for (const name of [source, target]) {
      await o.newDatabase(o.LOCAL, name, o.OWNER);
      created.push(name);
    }
    await o.query(o.LOCAL, source, `SET ROLE ${o.q(o.OWNER)};
      CREATE SCHEMA backup_smoke;
      CREATE TABLE backup_smoke.entry (id bigserial PRIMARY KEY, value text NOT NULL);
      CREATE INDEX entry_value ON backup_smoke.entry(value);
      INSERT INTO backup_smoke.entry(value) VALUES ('first'), ('second');`);
    const entry = await o.dump(o.LOCAL, source, directory);
    assert.deepEqual(entry.rows, { 'backup_smoke.entry': '2' });
    await assert.rejects(o.restore(o.LOCAL, target, o.OWNER, directory, { ...entry, sha256: '0'.repeat(64) }), /checksum mismatch/);
    await o.restore(o.LOCAL, target, o.OWNER, directory, entry);
    const added = await o.query(o.LOCAL, target, "INSERT INTO backup_smoke.entry(value) VALUES ('third') RETURNING id::text");
    assert.equal(added[0].id, '3');
    assert.equal((await o.query(o.LOCAL, target, "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='backup_smoke'")).pop().n, 2);
    await o.exclusive(path.join(directory, 'passed.json'), JSON.stringify({ source, target, rows: entry.rows, sequence: '3', indexes: 2 }));
    console.log('PASS: real local dump/restore, same-snapshot counts, schema, indexes, sequence state and bad-hash refusal.');
  } finally {
    try { for (const name of created.reverse()) await o.dropCreated(o.LOCAL, name); }
    finally { await lock.end(); }
  }
}
