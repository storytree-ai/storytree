import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { bundleRuntime, checkedCounts, checkedManifest, checkedPrefix, dumpCommand, restoreCommand, restorer, timerUnits } from './host.mjs';

test('a backup is refused when a restore loses rows, adds tables, or omits tables', () => {
  const source = { 'public.record': '17', 'public.record_event': '43' };
  assert.doesNotThrow(() => checkedCounts(source, { ...source }));
  for (const restored of [{ ...source, 'public.record': '16' }, { ...source, extra: '0' }, { 'public.record': '17' }]) {
    assert.throws(() => checkedCounts(source, restored), /row counts/);
  }
});

test('a restore accepts only a complete manifest with safe dump names and hashes', () => {
  const databases = ['storytree_storytree', 'storytree-activity', 'storytree-trunks'];
  const good = { format: 1, databases: databases.map(name => ({ name, file: `${name}.dump`, sha256: 'a'.repeat(64), bytes: 123, rows: { 'public.record': '1' } })) };
  assert.doesNotThrow(() => checkedManifest(good));
  // The lag runner's history (storytree-lag) is backed up beside them; a backup from before it joined still restores.
  const lag = { ...good.databases[0], name: 'storytree-lag', file: 'storytree-lag.dump' };
  assert.doesNotThrow(() => checkedManifest({ ...good, databases: [...good.databases, lag] }));
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases.slice(1), lag] }), /manifest/);
  // So is the QA ledger (storytree-quality), whose review history cannot be re-run.
  const quality = { ...good.databases[0], name: 'storytree-quality', file: 'storytree-quality.dump' };
  assert.doesNotThrow(() => checkedManifest({ ...good, databases: [...good.databases, lag, quality] }));
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases, quality] }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.slice(1) }), /manifest/);
  // 0.2's frozen store was archived once, never backed up from Mint.
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases, { ...good.databases[0], name: 'storytree', file: 'storytree.dump' }] }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, file: '../outside.dump' })) }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, sha256: 'wrong' })) }), /manifest/);
});

test('a restore runs PostgreSQL 16 pg_restore as storytree_library over 127.0.0.1, never as the superuser', () => {
  const server = restorer('secret');
  assert.deepEqual({ host: server.host, port: server.port, user: server.user }, { host: '127.0.0.1', port: 5432, user: 'storytree_library' });
  const { command, args, env } = restoreCommand(server, 'st_verify_1', '/backups/x/storytree-lag.dump');
  assert.equal(command, '/usr/lib/postgresql/16/bin/pg_restore');
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGUSER, 'storytree_library');
  assert.equal(env.PGPASSWORD, 'secret');
  assert.ok(!args.some(arg => arg.includes('secret')), 'the password is never on the command line');
});

test('a backup dumps with PostgreSQL 16 pg_dump by its absolute path', () => {
  const { command } = dumpCommand({ host: '/var/run/postgresql', port: 5432, user: 'mickh' }, 'storytree-lag', 'snap', 'storytree_library', '/d/storytree-lag.dump');
  assert.equal(command, '/usr/lib/postgresql/16/bin/pg_dump');
});

test('a restore refuses a backup the off-box check never verified, one stamped in the future, or one whose objects were not made when its name says', () => {
  const prefix = 'gs://storytree-498613-library-backups/backups/20261023T180036163Z-9995f059';
  const hash = 'b'.repeat(64);
  const objects = [
    { name: 'backups/20261023T180036163Z-9995f059/storytree-lag.dump', creation_time: '2026-10-23T18:04:07+0000' },
    { name: 'backups/20261023T180036163Z-9995f059/manifest.json', creation_time: '2026-10-23T18:08:11+0000' },
  ];
  const good = { prefix, manifestHash: hash, verified: `# verified off the box\n${hash} ${prefix} 2026-10-23\n`, objects, now: new Date('2026-10-24T00:00:00Z') };
  assert.doesNotThrow(() => checkedPrefix(good));
  assert.throws(() => checkedPrefix({ ...good, verified: `${'c'.repeat(64)}\n` }), /not verified/);
  assert.throws(() => checkedPrefix({ ...good, verified: `# ${hash}\n` }), /not verified/);
  assert.throws(() => checkedPrefix({ ...good, now: new Date('2026-10-23T17:00:00Z') }), /future/);
  // An object made long after the name's time, or before it, does not belong to that run.
  assert.throws(() => checkedPrefix({ ...good, objects: [...objects, { name: 'backups/20261023T180036163Z-9995f059/x', creation_time: '2026-10-24T02:00:00+0000' }] }), /creation/);
  assert.throws(() => checkedPrefix({ ...good, objects: [...objects, { name: 'backups/20261023T180036163Z-9995f059/x', creation_time: '2026-10-23T17:59:00+0000' }] }), /creation/);
  assert.throws(() => checkedPrefix({ ...good, objects: [] }), /creation/);
  assert.throws(() => checkedPrefix({ ...good, prefix: 'gs://storytree-498613-library-backups/backups/latest' }), /timestamp/);
});

test('the backup timer runs on a PATH of /usr/bin and /bin alone, from a runtime that needs no node_modules', async () => {
  const { service } = timerUnits('/home/u/.storytree/library-host/runtime-x', '/home/u/code/storytree03', '/opt/node/bin/node');
  assert.match(service, /^Environment=PATH=\/usr\/bin:\/bin$/m);
  assert.match(service, /^ExecStart=\/opt\/node\/bin\/node \/home\/u\/\.storytree\/library-host\/runtime-x\/host\.mjs backup$/m);
  const runtime = await mkdtemp(path.join(tmpdir(), 'library-host-runtime-'));
  try {
    await bundleRuntime(runtime);
    assert.deepEqual(await readdir(runtime), ['host.mjs']);
    const env = { PATH: '/usr/bin:/bin', HOME: runtime };
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(runtime, 'host.mjs'), 'backup', '--dry-run'], { cwd: runtime, env });
    assert.match(stdout, /DRY RUN backup/);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});
