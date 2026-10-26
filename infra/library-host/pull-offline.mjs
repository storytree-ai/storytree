#!/usr/bin/env node
// The owner's offline copy of the library backups, run on the laptop with his own gcloud login:
// the newest verified backup and the archive/, in one gpg-encrypted file on the disk he names.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedManifest } from './host.mjs';

const WINDOWS = process.platform === 'win32';
// Windows reaches gcloud.cmd only through a shell, so every word it is given must need no quoting.
const PLAIN = /^[A-Za-z0-9_.:/\\*@=+-]+$/;

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function run(command, args, { input, shell = false } = {}) {
  if (shell && args.some(arg => !PLAIN.test(arg))) throw new Error(`${command}: an argument needs quoting; use a folder path without spaces`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'], shell });
    input?.pipe(child.stdin);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})`)));
  });
}

// The real bucket, through the laptop's own gcloud login: the cloud project's backups bucket, the project given
// with --project or else the login's own (gcloud config get-value project). Patterns and names are the bucket's own.
export function gcloudBucket({ project, gcloud = WINDOWS ? 'gcloud.cmd' : 'gcloud' } = {}) {
  const tool = args => run(gcloud, ['--quiet', ...args], { shell: WINDOWS });
  let bucket;
  const named = async () => {
    if (bucket) return bucket;
    const id = project || (await tool(['config', 'get-value', 'project'])).trim();
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) throw new Error('No cloud project: give --project <id>, or set the gcloud login\'s project');
    return (bucket = `gs://${id}-library-backups`);
  };
  const storage = args => tool(['storage', ...args]);
  return {
    async list(pattern) {
      return JSON.parse(await storage(['objects', 'list', `${await named()}/${pattern}`, '--format=json']) || '[]')
        .map(o => ({ name: o.name, bytes: Number(o.size), created: Date.parse(o.creation_time) }));
    },
    download: async (name, file) => storage(['cp', `${await named()}/${name}`, file]),
  };
}

// tar the staged folder into gpg: to a public key when one is named, else to a passphrase gpg asks for itself.
export async function gpgEncrypt(folder, file, recipient) {
  const mode = recipient ? ['--encrypt', '--recipient', recipient] : ['--symmetric', '--cipher-algo', 'AES256'];
  const tar = spawn('tar', ['-cf', '-', '-C', folder, '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const tarDone = new Promise((resolve, reject) => {
    tar.on('error', reject);
    tar.on('close', code => code === 0 ? resolve() : reject(new Error(`tar failed (${code})`)));
  });
  await Promise.all([run('gpg', [...mode, '--output', file], { input: tar.stdout }), tarDone]);
}

// The newest backup whose manifest checks out and whose every dump is in the bucket at its recorded size,
// newest by when its manifest was written (uploaded last, so it marks a complete backup), not by name.
export async function newestVerified(bucket, folder) {
  const objects = await bucket.list('backups/**');
  const sizes = new Map(objects.map(o => [o.name, o.bytes]));
  const manifests = objects.filter(o => /^backups\/[A-Za-z0-9-]+\/manifest\.json$/.test(o.name)).sort((a, b) => b.created - a.created);
  for (const object of manifests) {
    const prefix = path.posix.dirname(object.name);
    const file = path.join(folder, 'manifest.json');
    await rm(file, { force: true });
    await bucket.download(object.name, file);
    let manifest;
    try { manifest = checkedManifest(JSON.parse(await readFile(file, 'utf8'))); } catch { continue; }
    if (manifest.databases.every(d => sizes.get(`${prefix}/${d.file}`) === d.bytes)) return { prefix, manifest };
  }
  throw new Error('No backup in the bucket has a manifest that checks out');
}

export async function pullOffline({ out, recipient, project, bucket = gcloudBucket({ project }), encrypt = gpgEncrypt, log = console.log }) {
  if (!out || !existsSync(out)) throw new Error('Give --out <folder>, the offline disk to write to');
  const staging = await mkdtemp(path.join(tmpdir(), 'storytree-offline-'));
  try {
    const { prefix, manifest } = await newestVerified(bucket, staging);
    const backup = path.join(staging, prefix);
    await mkdir(backup, { recursive: true });
    await bucket.download(`${prefix}/manifest.json`, path.join(backup, 'manifest.json'));
    await rm(path.join(staging, 'manifest.json'));
    for (const entry of manifest.databases) {
      const file = path.join(backup, entry.file);
      await bucket.download(`${prefix}/${entry.file}`, file);
      if ((await stat(file)).size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`${prefix}/${entry.file} does not match its manifest's size and hash`);
    }
    const archive = (await bucket.list('archive/**')).filter(o => /^archive\/[A-Za-z0-9._-]+$/.test(o.name));
    if (archive.length === 0) throw new Error('The bucket has no archive/ object');
    await mkdir(path.join(staging, 'archive'));
    for (const object of archive) {
      const file = path.join(staging, object.name);
      await bucket.download(object.name, file);
      if ((await stat(file)).size !== object.bytes) throw new Error(`${object.name} did not download whole`);
    }
    const target = path.join(out, `storytree-library-${path.posix.basename(prefix)}.tar.gpg`);
    if (existsSync(target)) throw new Error(`${target} already exists; nothing was overwritten`);
    await encrypt(staging, target, recipient);
    log(`Encrypted ${prefix} (${manifest.databases.map(d => d.name).join(', ')}) and ${archive.map(o => o.name).join(', ')}`);
    log(`Wrote ${target} (${(await stat(target)).size} bytes, sha256 ${await sha256(target)})`);
    return { prefix, target };
  } finally {
    // Nothing unencrypted stays behind, even after a failure.
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  pullOffline({ out: value('--out'), recipient: value('--recipient'), project: value('--project') })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
