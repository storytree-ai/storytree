import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { gpgEncrypt, pullOffline } from './pull-offline.mjs';

const DBS = ['storytree_storytree', 'storytree-activity', 'storytree-trunks', 'storytree-lag', 'storytree-quality'];
const sha = text => createHash('sha256').update(text).digest('hex');

// A fake bucket: object name -> { body, created }, listed the way gcloudBucket lists the real one.
function fakeBucket(objects) {
  const downloads = [];
  return {
    downloads,
    async list(pattern) {
      const folder = pattern.split('/').at(-2);
      return Object.entries(objects).filter(([name]) => name.startsWith(folder + '/'))
        .map(([name, o]) => ({ name, bytes: Buffer.byteLength(o.body), created: o.created }));
    },
    async download(name, file) { downloads.push(name); await writeFile(file, objects[name].body); },
  };
}
function backup(objects, prefix, created, { manifest, dump = name => `${prefix} ${name}` } = {}) {
  const databases = DBS.map(name => ({ name, file: `${name}.dump`, sha256: sha(`${prefix} ${name}`), bytes: Buffer.byteLength(`${prefix} ${name}`), rows: { 'public.record': '1' } }));
  for (const d of databases) objects[`backups/${prefix}/${d.file}`] = { body: dump(d.name), created };
  objects[`backups/${prefix}/manifest.json`] = { body: manifest ?? JSON.stringify({ format: 1, databases }), created: created + 1 };
}
// Stands in for tar and gpg: keeps the staged files so the test can read what would be encrypted.
function fakeEncrypt(seen) {
  return async (folder, file, recipient) => {
    seen.files = (await readdir(folder, { recursive: true, withFileTypes: true })).filter(e => e.isFile())
      .map(e => path.relative(folder, path.join(e.parentPath, e.name)).split(path.sep).join('/')).sort();
    seen.dump = await readFile(path.join(folder, 'backups/b-older-name/storytree-lag.dump'), 'utf8').catch(() => null);
    seen.folder = folder;
    seen.recipient = recipient;
    await writeFile(file, 'ciphertext');
  };
}

test('pull-offline encrypts the newest backup by creation time whose manifest checks out, with the archive', async () => {
  const objects = { 'archive/storytree-pg-0.2.sql.gz': { body: 'frozen 0.2', created: 1 } };
  backup(objects, 'z-oldest-name', 100);
  backup(objects, 'b-older-name', 300); // the newest complete backup, though its name sorts first
  backup(objects, 'a-newest', 500, { manifest: '{"format":1,"databases":[]}' }); // its manifest does not check out
  backup(objects, 'c-half-uploaded', 400, { dump: () => 'short' }); // its dumps are not the manifest's sizes
  const bucket = fakeBucket(objects);
  const out = await mkdtemp(path.join(tmpdir(), 'offline-disk-'));
  const seen = {};
  const lines = [];
  const { target } = await pullOffline({ out, bucket, encrypt: fakeEncrypt(seen), log: line => lines.push(line), recipient: 'owner@example.com' });

  assert.deepEqual(seen.files, ['archive/storytree-pg-0.2.sql.gz', 'backups/b-older-name/manifest.json', ...DBS.map(d => `backups/b-older-name/${d}.dump`).sort()]);
  assert.equal(seen.dump, 'b-older-name storytree-lag');
  assert.equal(seen.recipient, 'owner@example.com');
  assert.equal(target, path.join(out, 'storytree-library-b-older-name.tar.gpg'));
  assert.deepEqual(await readdir(out), ['storytree-library-b-older-name.tar.gpg']);
  assert.match(lines.join('\n'), new RegExp(`Wrote ${target.replaceAll('\\', '\\\\')} \\(10 bytes, sha256 ${sha('ciphertext')}\\)`));
  assert.ok(!bucket.downloads.some(name => name.startsWith('backups/z-oldest-name/')), 'an older backup is never fetched');
  await assert.rejects(readdir(seen.folder), /ENOENT/, 'the unencrypted staging folder is removed');

  // A second pull of the same backup overwrites nothing.
  await assert.rejects(pullOffline({ out, bucket, encrypt: fakeEncrypt({}), log: () => {} }), /already exists/);
});

test('pull-offline stops, leaving nothing unencrypted, when a dump does not match its manifest hash', async () => {
  const objects = { 'archive/a.sql.gz': { body: 'frozen', created: 1 } };
  backup(objects, 'only', 100, { dump: name => `ONLY ${name}` }); // right sizes, wrong bytes
  const out = await mkdtemp(path.join(tmpdir(), 'offline-disk-'));
  let staged;
  const bucket = fakeBucket(objects);
  const download = bucket.download;
  bucket.download = async (name, file) => { staged ??= path.dirname(file); return download(name, file); };
  await assert.rejects(pullOffline({ out, bucket, encrypt: fakeEncrypt({}), log: () => {} }), /does not match its manifest/);
  assert.deepEqual(await readdir(out), []);
  await assert.rejects(readdir(staged), /ENOENT/);
});

test('the encrypted file opens, with the owner\'s key, to exactly the staged files', async (t) => {
  if (spawnSync('gpg', ['--version']).status !== 0 || spawnSync('tar', ['--version']).status !== 0) return t.skip('no gpg or tar on this machine');
  const home = await mkdtemp(path.join(tmpdir(), 'gnupg-'));
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = home;
  t.after(() => { spawnSync('gpgconf', ['--kill', 'gpg-agent']); if (previous === undefined) delete process.env.GNUPGHOME; else process.env.GNUPGHOME = previous; });
  assert.equal(spawnSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-gen-key', 'offline-test@example.invalid', 'default', 'default', 'never']).status, 0);
  const folder = await mkdtemp(path.join(tmpdir(), 'staged-'));
  await mkdir(path.join(folder, 'archive'));
  await writeFile(path.join(folder, 'archive/a.sql.gz'), 'frozen');
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'offline-disk-')), 'copy.tar.gpg');
  await gpgEncrypt(folder, file, 'offline-test@example.invalid');
  assert.ok(!(await readFile(file)).includes('frozen'), 'the file is not plaintext');
  const opened = spawnSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--quiet', '--decrypt', file]);
  assert.equal(opened.status, 0, String(opened.stderr));
  const listed = spawnSync('tar', ['-tf', '-'], { input: opened.stdout, encoding: 'utf8' });
  assert.deepEqual(listed.stdout.split('\n').filter(Boolean).map(n => n.replace(/^\.\//, '')).filter(n => n && n !== '.' && !n.endsWith('/')), ['archive/a.sql.gz']);
});
