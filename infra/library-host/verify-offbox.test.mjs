import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chainOf, checkedPrefix, nextDigest } from './host.mjs';
import { localRestore, verifyOffbox } from './verify-offbox.mjs';

const DBS = ['storytree_storytree', 'storytree-activity', 'storytree-trunks', 'storytree-lag', 'storytree-quality'];
const sha = text => createHash('sha256').update(text).digest('hex');
const DAY = 24 * 60 * 60 * 1000;
// A backup's name is the UTC time it began, as host.mjs stamps it.
const nameAt = (ms, tag) => new Date(ms).toISOString().replaceAll(/[-:.]/g, '') + '-' + tag;
const T0 = Date.UTC(2026, 9, 20, 0, 0, 0);

// A fake bucket: object name -> { body, created (ms) }, listed the way gcloudBucket lists the real one, in an order
// unrelated to names or times, so that nothing leans on the listing's order.
function fakeBucket(objects) {
  const downloads = [];
  return {
    downloads,
    async list(pattern) {
      const folder = pattern.split('/')[0];
      return Object.entries(objects).filter(([name]) => name.startsWith(folder + '/'))
        .map(([name, o]) => ({ name, bytes: Buffer.byteLength(o.body), created: o.created })).sort((a, b) => sha(a.name).localeCompare(sha(b.name)));
    },
    async download(name, file) { downloads.push(name); await writeFile(file, objects[name].body); },
  };
}
// One backup made by the box: five dumps, then the manifest, then its digest chained from `last`.
function backup(objects, last, at, tag, { size = 100, digest = true, alter = d => d, dbs = DBS } = {}) {
  const prefix = nameAt(at, tag);
  const databases = dbs.map(name => {
    const body = `${prefix} ${name} `.padEnd(size, '.');
    objects[`backups/${prefix}/${name}.dump`] = { body, created: at + 60_000 };
    return { name, file: `${name}.dump`, sha256: sha(body), bytes: Buffer.byteLength(body), rows: { 'public.record': '1' } };
  });
  const manifest = JSON.stringify({ format: 1, databases }, null, 2);
  objects[`backups/${prefix}/manifest.json`] = { body: manifest, created: at + 120_000 };
  const next = nextDigest(last, prefix, sha(manifest));
  if (digest) objects[`backups/${prefix}/digest.json`] = { body: JSON.stringify(alter(next)), created: at + 121_000 };
  return { prefix, digest: next, manifestHash: sha(manifest) };
}
async function stateDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-offbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const noRestore = async () => { throw new Error('no restore was due'); };

test('the newest backup is verified off the box: its digest is the chain\'s tip, its manifest hash is recorded in the list a restore takes, and the chain anchors the next run', async (t) => {
  const objects = {};
  const a = backup(objects, undefined, T0, 'aaaaaaaa');
  const b = backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
  const c = backup(objects, b.digest, T0 + DAY / 2, 'cccccccc');
  const state = await stateDir(t);
  const lines = [];
  const now = new Date(T0 + DAY);
  const result = await verifyOffbox({ bucket: fakeBucket(objects), state, now, restore: async () => ({}), log: line => lines.push(line) });
  assert.equal(result.prefix, c.prefix);
  const verified = await readFile(path.join(state, 'verified.txt'), 'utf8');
  assert.match(verified, new RegExp(`^${c.manifestHash} ${c.prefix} `, 'm'));
  // The list it writes is the one host.mjs restore-backup takes.
  assert.doesNotThrow(() => checkedPrefix({ prefix: `gs://p-library-backups/backups/${c.prefix}`, manifestHash: c.manifestHash, verified, now,
    objects: Object.entries(objects).filter(([n]) => n.startsWith(`backups/${c.prefix}/`)).map(([name, o]) => ({ name, creation_time: new Date(o.created).toISOString() })) }));

  // The next run starts from that tip: it reads no digest older than it, and accepts a chain that continues it.
  const d = backup(objects, c.digest, T0 + DAY * 0.75, 'dddddddd');
  const bucket = fakeBucket(objects);
  await verifyOffbox({ bucket, state, now: new Date(T0 + DAY * 1.25), restore: noRestore, log: () => {} });
  assert.ok(!bucket.downloads.some(n => n === `backups/${a.prefix}/digest.json` || n === `backups/${b.prefix}/digest.json`), bucket.downloads.join(', '));
  assert.match(await readFile(path.join(state, 'verified.txt'), 'utf8'), new RegExp(`^${d.manifestHash} ${d.prefix} `, 'm'));
  assert.equal(JSON.parse(await readFile(path.join(state, 'state.json'), 'utf8')).anchor.seq, 4);
});

const refusals = [
  ['a digest that does not link to the one before it', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    const previous = 'f'.repeat(64);
    backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb', { alter: d => ({ ...d, previous, chain: chainOf(previous, d.seq, d.prefix, d.manifest) }) });
  }, /chain/],
  ['a missing sequence number', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    backup(objects, { ...a.digest, seq: 2 }, T0 + DAY / 4, 'bbbbbbbb', { alter: d => ({ ...d, previous: a.digest.chain }) });
  }, /chain/],
  ['two digests with one sequence number', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
    backup(objects, a.digest, T0 + DAY / 2, 'cccccccc');
  }, /chain/],
  ['a digest naming another backup', objects => {
    backup(objects, undefined, T0, 'aaaaaaaa', { alter: d => ({ ...d, prefix: 'elsewhere' }) });
  }, /digest/],
  ['a newest backup with no digest', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb', { digest: false });
  }, /digest/],
  ['a newest backup whose manifest is not the one its digest names', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    const b = backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
    objects[`backups/${b.prefix}/manifest.json`].body += ' ';
  }, /manifest/],
  ['a newest backup missing a dump', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    const b = backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
    delete objects[`backups/${b.prefix}/storytree-lag.dump`];
  }, /dump/],
  ['a newest backup of fewer than all five databases', objects => {
    backup(objects, undefined, T0, 'aaaaaaaa', { dbs: DBS.slice(0, 3) });
  }, /five/],
  ['a dump that is not its manifest\'s size', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    const b = backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
    objects[`backups/${b.prefix}/storytree-trunks.dump`].body += 'x';
  }, /dump/],
  ['a dump far smaller than the previous run\'s', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa', { size: 1000 });
    backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb', { size: 300 });
  }, /previous/],
  ['a newest backup whose objects were not made when its name says', objects => {
    const a = backup(objects, undefined, T0, 'aaaaaaaa');
    const b = backup(objects, a.digest, T0 + DAY / 4, 'bbbbbbbb');
    objects[`backups/${b.prefix}/storytree-lag.dump`].created = T0 + DAY / 4 + 3 * 60 * 60 * 1000;
  }, /creation/],
];
for (const [what, make, error] of refusals) {
  test(`verification refuses ${what}, and records nothing`, async (t) => {
    const objects = {};
    make(objects);
    const state = await stateDir(t);
    await assert.rejects(verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + DAY), restore: async () => ({}), log: () => {} }), error);
    assert.deepEqual(await readdir(state), []);
  });
}

test('verification refuses a chain that no longer passes through the digest the last run verified', async (t) => {
  const objects = {};
  const a = backup(objects, undefined, T0, 'aaaaaaaa');
  const state = await stateDir(t);
  await verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + DAY), restore: async () => ({}), log: () => {} });
  // The bucket is rewritten from scratch: a different first digest, and one after it.
  delete objects[`backups/${a.prefix}/digest.json`];
  const forged = backup(objects, undefined, T0 + 1000, 'ffffffff');
  backup(objects, forged.digest, T0 + DAY / 4, 'bbbbbbbb');
  const before = await readFile(path.join(state, 'verified.txt'), 'utf8');
  await assert.rejects(verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + DAY), restore: noRestore, log: () => {} }), /last verified/);
  assert.equal(await readFile(path.join(state, 'verified.txt'), 'utf8'), before);
});

test('a restore proof is due weekly: it restores every dump checked against its manifest, records the proof, and is not repeated within the week', async (t) => {
  const objects = {};
  const a = backup(objects, undefined, T0, 'aaaaaaaa');
  const state = await stateDir(t);
  const restored = [];
  const restore = async (directory, manifest) => {
    for (const entry of manifest.databases) restored.push(sha(await readFile(path.join(directory, entry.file))) === entry.sha256 && entry.name);
    return Object.fromEntries(manifest.databases.map(d => [d.name, d.rows]));
  };
  await verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + DAY), restore, log: () => {} });
  assert.deepEqual(restored, DBS);
  const proofs = (await readdir(state)).filter(f => f.startsWith('restore-'));
  assert.equal(proofs.length, 1);
  const proof = JSON.parse(await readFile(path.join(state, proofs[0]), 'utf8'));
  assert.equal(proof.prefix, a.prefix);
  assert.equal(proof.manifest, a.manifestHash);
  assert.deepEqual(Object.keys(proof.databases), DBS);

  const b = backup(objects, a.digest, T0 + 2 * DAY, 'bbbbbbbb');
  await verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + 3 * DAY), restore: noRestore, log: () => {} });
  const c = backup(objects, b.digest, T0 + 8 * DAY, 'cccccccc');
  restored.length = 0;
  await verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + 8 * DAY + 60 * 60 * 1000), restore, log: () => {} });
  assert.deepEqual(restored, DBS, 'a week after the last proof, the next one runs');
  assert.ok((await readdir(state)).includes(`restore-${c.prefix}.json`));

  // A restore that fails records neither the proof nor the hash.
  const d = backup(objects, c.digest, T0 + 16 * DAY, 'dddddddd');
  await assert.rejects(verifyOffbox({ bucket: fakeBucket(objects), state, now: new Date(T0 + 16 * DAY + 60 * 60 * 1000), restore: async () => { throw new Error('row counts differ'); }, log: () => {} }), /row counts/);
  assert.ok(!(await readFile(path.join(state, 'verified.txt'), 'utf8')).includes(d.manifestHash));
});

// The real restore needs a PostgreSQL install with a server and pg_dump to make the dump it restores (pg_config names it).
const pgBin = (() => {
  try {
    const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    return ['initdb', 'pg_ctl', 'postgres', 'pg_dump', 'pg_restore'].every(tool => existsSync(path.join(bin, tool + (process.platform === 'win32' ? '.exe' : '')))) ? bin : undefined;
  } catch { return undefined; }
})();

test('the weekly restore puts each dump into a throwaway local server and checks its row counts against the manifest', { skip: process.platform === 'win32' ? 'platform:linux: the source server\'s socket option takes no Windows path' : !pgBin && 'other: no PostgreSQL install with a server and pg_dump on this machine' }, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'verify-offbox-restore-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  // A source server of the install's own version stands in for the box's, its socket in the work folder.
  const tool = name => path.join(pgBin, name);
  const data = path.join(work, 'source');
  assert.equal(spawnSync(tool('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres']).status, 0);
  const port = await new Promise(resolve => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  const started = spawnSync(tool('pg_ctl'), ['-D', data, '-l', path.join(work, 'source.log'), '-w', 'start', '-o', `-p ${port} -k ${work} -c listen_addresses=127.0.0.1`]);
  assert.equal(started.status, 0, String(started.stderr));
  t.after(() => spawnSync(tool('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']));
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await client.connect();
  await client.query('CREATE TABLE record (id int)');
  await client.query('INSERT INTO record SELECT generate_series(1, 7)');
  await client.end();
  const dumped = spawnSync(tool('pg_dump'), ['-Fc', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-f', path.join(work, 'storytree-lag.dump'), 'postgres']);
  assert.equal(dumped.status, 0, String(dumped.stderr));
  const entry = { name: 'storytree-lag', file: 'storytree-lag.dump', rows: { 'public.record': '7' } };
  const pgRestore = path.join(pgBin, 'pg_restore');
  assert.deepEqual(await localRestore(work, { databases: [entry] }, { pgRestore }), { 'storytree-lag': { 'public.record': '7' } });
  await assert.rejects(localRestore(work, { databases: [{ ...entry, rows: { 'public.record': '8' } }] }, { pgRestore }), /row counts/);
});

// A stand-in gcloud on the PATH that writes each call's words to a log and lists an empty bucket.
test('run from the command line, it reads the cloud project and the state folder it is given, and records nothing from an empty bucket', { skip: process.platform === 'win32' && 'platform:linux: the stand-in gcloud is a shell script' }, async (t) => {
  const folder = await stateDir(t);
  const calls = path.join(folder, 'calls');
  await writeFile(path.join(folder, 'gcloud'), `#!/bin/sh\necho "$*" >> '${calls}'\necho '[]'\n`);
  await chmod(path.join(folder, 'gcloud'), 0o755);
  const state = path.join(folder, 'state');
  const script = fileURLToPath(new URL('./verify-offbox.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--import', 'tsx', script, '--project', 'named-project', '--state', state],
    { encoding: 'utf8', env: { ...process.env, PATH: `${folder}${path.delimiter}${process.env.PATH}` } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /No backup carries a digest/);
  assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), ['--quiet storage objects list gs://named-project-library-backups/backups/** --format=json']);
  assert.ok(!existsSync(state), 'nothing is recorded');
});
