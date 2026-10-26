#!/usr/bin/env node
// The off-box check of the library backups, run on the laptop with the owner's own gcloud login by the session
// manager's process "Verifying the library backups from off the box": it checks the box's digest chain, checks the
// newest backup, records its manifest's hash in the verified list `host.mjs restore-backup --verified` takes, and
// once a week restores that backup into a throwaway local server. Run with `node --import tsx` (the weekly restore
// starts its server through @storytree/local-postgres, which is TypeScript).
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chainOf, checkedCounts, checkedCreation, checkedManifest, operator } from './host.mjs';
import { gcloudBucket } from './pull-offline.mjs';

// The box backs up all five databases (host.mjs BACKED); a newest backup of fewer is refused.
const DATABASES = 5;
// A dump this much smaller, or larger, than the same database's in the backup before is refused: data lost, or junk added.
const SHRINK = 0.8, GROWTH = 2;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HEX = /^[a-f0-9]{64}$/;
const FOLDER = /^backups\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

const { sha256 } = operator;
async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

function checkedDigest(digest, folder) {
  if (digest?.format !== 1 || !Number.isSafeInteger(digest.seq) || digest.seq < 1 || digest.prefix !== folder ||
      ![digest.manifest, digest.previous, digest.chain].every(h => HEX.test(h ?? '')) ||
      chainOf(digest.previous, digest.seq, digest.prefix, digest.manifest) !== digest.chain) {
    throw new Error(`backups/${folder}/digest.json is not a sound digest of its own backup`);
  }
  return digest;
}

/** The chain's tip, once every digest links to the one before it, from the last verified digest (or the first there is). */
export function checkedChain(digests, anchor) {
  const sorted = [...digests].sort((a, b) => a.seq - b.seq);
  if (!sorted.length) throw new Error('No backup carries a digest');
  if (anchor && (sorted[0].seq !== anchor.seq || sorted[0].chain !== anchor.chain)) {
    throw new Error(`The digest chain no longer passes through the last verified digest (seq ${anchor.seq}, ${anchor.prefix})`);
  }
  if (sorted[0].seq === 1 && sorted[0].previous !== '0'.repeat(64)) throw new Error('The digest chain\'s first digest does not start it');
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].seq !== sorted[i - 1].seq + 1 || sorted[i].previous !== sorted[i - 1].chain) {
      throw new Error(`The digest chain breaks between seq ${sorted[i - 1].seq} (${sorted[i - 1].prefix}) and seq ${sorted[i].seq} (${sorted[i].prefix})`);
    }
  }
  return sorted.at(-1);
}

function pgEnv(url, database) {
  const u = new URL(url);
  return { PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: database };
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...env } });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${code}): ${errors.slice(-2000)}`)));
  });
}
async function tableCounts(url, database) {
  const u = new URL(url);
  u.pathname = '/' + database;
  const client = new pg.Client({ connectionString: u.href });
  await client.connect();
  try { return await operator.counts(client); } finally { await client.end(); }
}

/**
 * Restores each dump the manifest names into its own database on a throwaway local server (packages/local-postgres),
 * checks its row counts against the manifest's, and stops the server. Returns each database's counts.
 */
export async function localRestore(directory, manifest, { pgRestore = 'pg_restore' } = {}) {
  const { start } = await import('@storytree/local-postgres');
  const work = await mkdtemp(path.join(tmpdir(), 'storytree-restore-proof-'));
  const server = await start({ dataDir: path.join(work, 'data'), signIn: 'superuser', owner: 'verify-offbox restore proof',
    settings: { fsync: 'off', synchronous_commit: 'off', full_page_writes: 'off' } });
  try {
    const counts = {};
    for (const [i, entry] of manifest.databases.entries()) {
      const database = `restore_${i}`;
      const admin = new pg.Client({ connectionString: server.url });
      await admin.connect();
      try { await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`); } finally { await admin.end(); }
      await run(pgRestore, ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-d', database,
        path.join(directory, entry.file)], pgEnv(server.url, database));
      const restored = await tableCounts(server.url, database);
      checkedCounts(entry.rows, restored);
      counts[entry.name] = restored;
    }
    return counts;
  } finally {
    await server.stop();
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * The off-box check. `state` is the laptop's folder holding the verified list (verified.txt), the chain's last
 * verified digest (state.json) and each restore proof (restore-<backup>.json). Nothing is recorded unless every check,
 * and a due restore, passes.
 */
export async function verifyOffbox({ bucket, state, now = new Date(), restore = localRestore, restoreDue, log = console.log }) {
  const saved = await readJson(path.join(state, 'state.json')).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  const objects = await bucket.list('backups/**');
  const byFolder = new Map();
  for (const object of objects) {
    const match = FOLDER.exec(object.name);
    if (!match) continue;
    if (!byFolder.has(match[1])) byFolder.set(match[1], new Map());
    byFolder.get(match[1]).set(match[2], object);
  }
  const staging = await mkdtemp(path.join(tmpdir(), 'storytree-verify-'));
  try {
    // Only digests from the last verified one on: older ones were checked by an earlier run.
    const digests = [];
    for (const [folder, files] of byFolder) {
      const object = files.get('digest.json');
      if (!object || (saved.anchor && object.created < saved.anchor.created)) continue;
      const file = path.join(staging, `${folder}.digest.json`);
      await bucket.download(object.name, file);
      let digest;
      try { digest = JSON.parse(await readFile(file, 'utf8')); } catch { digest = undefined; }
      digests.push({ ...checkedDigest(digest, folder), created: object.created });
    }
    const tip = checkedChain(digests, saved.anchor);

    // The newest backup by when its manifest was written (uploaded last), not by its name.
    const complete = [...byFolder].filter(([, files]) => files.has('manifest.json'))
      .sort(([, a], [, b]) => b.get('manifest.json').created - a.get('manifest.json').created);
    if (!complete.length) throw new Error('The bucket holds no backup with a manifest');
    const [newest, files] = complete[0];
    if (tip.prefix !== newest) throw new Error(`The newest backup, ${newest}, carries no digest at the chain's tip (seq ${tip.seq} is ${tip.prefix})`);
    const backup = path.join(staging, newest);
    await mkdir(backup);
    await bucket.download(`backups/${newest}/manifest.json`, path.join(backup, 'manifest.json'));
    const manifestHash = await sha256(path.join(backup, 'manifest.json'));
    if (manifestHash !== tip.manifest) throw new Error(`${newest}'s manifest is not the one its digest names`);
    const manifest = checkedManifest(await readJson(path.join(backup, 'manifest.json')));
    if (manifest.databases.length !== DATABASES) throw new Error(`${newest} backs up ${manifest.databases.length} databases, not all five`);
    for (const entry of manifest.databases) {
      if (files.get(entry.file)?.bytes !== entry.bytes) throw new Error(`${newest}/${entry.file}: the dump is missing or not its manifest's size`);
    }
    checkedCreation({ prefix: newest, objects: [...files.values()].map(o => ({ creation_time: new Date(o.created).toISOString() })), now });

    // Sizes close to the backup before it (the newest earlier one whose manifest checks out).
    for (const [folder] of complete.slice(1)) {
      const file = path.join(staging, `${folder}.manifest.json`);
      await bucket.download(`backups/${folder}/manifest.json`, file);
      let previous;
      try { previous = checkedManifest(await readJson(file)); } catch { continue; }
      for (const entry of manifest.databases) {
        const before = previous.databases.find(d => d.name === entry.name);
        if (before && (entry.bytes < before.bytes * SHRINK || entry.bytes > before.bytes * GROWTH)) {
          throw new Error(`${newest}/${entry.file} is ${entry.bytes} bytes, against ${before.bytes} in the previous backup (${folder})`);
        }
      }
      break;
    }

    // Weekly, the newest backup restores into a throwaway local server before it is recorded as verified.
    let proof;
    const due = restoreDue ?? (!saved.restoredAt || now.getTime() - Date.parse(saved.restoredAt) >= WEEK_MS);
    if (due) {
      for (const entry of manifest.databases) {
        const file = path.join(backup, entry.file);
        await bucket.download(`backups/${newest}/${entry.file}`, file);
        if ((await stat(file)).size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`${newest}/${entry.file} does not match its manifest's size and hash`);
      }
      proof = { prefix: newest, manifest: manifestHash, at: now.toISOString(), databases: await restore(backup, manifest) };
    }

    await mkdir(state, { recursive: true, mode: 0o700 });
    const listFile = path.join(state, 'verified.txt');
    const listed = await readFile(listFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (!listed.split('\n').some(line => line.split(/\s+/)[0] === manifestHash)) {
      await appendFile(listFile, `${manifestHash} ${newest} ${now.toISOString()}\n`, { mode: 0o600 });
    }
    if (proof) await writeFile(path.join(state, `restore-${newest}.json`), JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
    const anchor = { seq: tip.seq, chain: tip.chain, prefix: tip.prefix, created: tip.created };
    await writeFile(path.join(state, 'state.json'), JSON.stringify({ anchor, restoredAt: proof ? proof.at : saved.restoredAt }, null, 2), { mode: 0o600 });
    log(`Verified ${newest}: digest seq ${tip.seq}, manifest sha256 ${manifestHash}, recorded in ${listFile}`);
    if (proof) log(`Restore proof: ${path.join(state, `restore-${newest}.json`)}`);
    return { prefix: newest, manifest: manifestHash, seq: tip.seq, restored: Boolean(proof) };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const pgRestore = value('--pg-restore');
  verifyOffbox({
    bucket: gcloudBucket({ project: value('--project') }),
    state: value('--state') ?? path.join(homedir(), '.storytree', '0.3', 'library-backups'),
    restore: (directory, manifest) => localRestore(directory, manifest, pgRestore ? { pgRestore } : {}),
    restoreDue: args.includes('--restore') ? true : undefined,
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
