#!/usr/bin/env node
// ADR-0928: reviewed operator tools for this host, never imported by the product.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, readdir, copyFile, symlink, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.LIBRARY_HOST_REPO ?? path.resolve(HERE, '../..');
const ROOT = path.join(homedir(), '.storytree/library-host');
const LOGS = path.join(homedir(), 'storytree-lanes/library-backups');
const ADC = path.join(homedir(), '.config/gcloud/application_default_credentials.json');
const GCLOUD = path.join(homedir(), 'google-cloud-sdk/bin/gcloud');
const PROXY = path.join(homedir(), 'google-cloud-sdk/bin/cloud-sql-proxy');
const BUCKET = 'gs://storytree-498613-library-backups';
const ACCOUNT = 'storytree-mint@storytree-498613.iam.gserviceaccount.com';
const CLOUD = { host: '127.0.0.1', port: 55432, user: 'storytree-mint@storytree-498613.iam' };
const LOCAL = { host: '/var/run/postgresql', port: 5432, user: 'mickh' };
const OWNER = 'storytree_library';
// Same name as Cloud SQL so the dump's RLS policies restore unchanged. Local SCRAM, not IAM.
const CI = 'storytree-ci-health@storytree-498613.iam';
// The three 0.3 databases. 0.2's frozen `storytree` stays on Cloud SQL and is archived there by
// `gcloud sql export` before the instance is deleted (owner, 2026-10-07: "we dont need backups for 0.2").
const DBS = ['storytree_storytree', 'storytree-activity', 'storytree-trunks'];
const MARK = 'storytree library-host increment_b3ccd17ff113';
const PASSWORD = path.join(ROOT, 'postgres-password');
const CI_PASSWORD = path.join(ROOT, 'ci-health-password');
const ISOLATED = path.join(ROOT, 'smoke-home');
const q = value => '"' + value.replaceAll('"', '""') + '"';
const lit = value => "'" + value.replaceAll("'", "''") + "'";
const stamp = () => new Date().toISOString().replaceAll(/[-:.]/g, '') + '-' + randomBytes(4).toString('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// A full Cloud SQL refuses at connect (SQLSTATE 53300), before any data moves, so waiting costs no egress.
const FULL = /remaining connection slots|too many clients/;
async function patiently(work, minutes = 20) {
  for (let waited = 0; ; waited += 30) {
    try { return await work(); }
    catch (error) {
      if (!FULL.test(error.message) || waited >= minutes * 60) throw error;
      console.log('Cloud SQL has no free connection slot; retrying in 30 s');
      await pause(30000);
    }
  }
}

export function checkedCounts(source, restored) {
  const sorted = rows => JSON.stringify(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(source) !== sorted(restored)) throw new Error('Restored row counts differ from the dump snapshot; nothing will be uploaded.');
}

export function checkedManifest(manifest) {
  if (manifest?.format !== 1 || !Array.isArray(manifest.databases) ||
      JSON.stringify(manifest.databases.map(d => d.name).sort()) !== JSON.stringify([...DBS].sort()) ||
      manifest.databases.some(d => d.file !== `${d.name}.dump` || !/^[a-f0-9]{64}$/.test(d.sha256) ||
        !Number.isSafeInteger(d.bytes) || d.bytes <= 0 || !d.rows ||
        Object.values(d.rows).some(n => !/^\d+$/.test(n)))) {
    throw new Error('Invalid or incomplete backup manifest');
  }
  return manifest;
}

export function checkFreeze(freeze, direction, now = Date.now()) {
  const age = now - Date.parse(freeze?.at);
  if (freeze?.direction !== direction || freeze.owner !== 'mickh' || !Number.isFinite(age) || age < 0 || age > 30 * 60000 ||
      ['laptopPaused', 'mintPaused', 'ciPaused', 'backupTimerPaused'].some(key => freeze[key] !== true)) {
    throw new Error('A current owner freeze attestation for this direction is required (at most 30 minutes old).');
  }
}

async function exclusive(file, content) {
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
}
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Never inherit connection/password overrides. No secrets in argv or child error messages.
function environment(extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('PG') || name.startsWith('CLOUDSDK_') || name === 'GOOGLE_APPLICATION_CREDENTIALS') delete env[name];
  return { ...env, ...extra };
}
async function run(command, args, { env = {}, input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, env: environment(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(
      `${path.basename(command)} failed (${code})${quiet ? '; details suppressed' : ': ' + errors.slice(-3000)}`)));
    child.stdin.end(input);
  });
}
function pgEnv(server, database, role) {
  return { PGHOST: server.host, PGPORT: String(server.port), PGUSER: server.user, PGDATABASE: database,
    PGCONNECT_TIMEOUT: '15', ...(role ? { PGOPTIONS: `-c role=${role}` } : {}) };
}
async function connect(server, database = 'postgres', role) {
  // pg also consults the parent environment when a config value is empty.
  for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];
  const client = new pg.Client({ ...server, database, password: '', connectionTimeoutMillis: 15000,
    ...(role ? { options: `-c role=${role}` } : {}) });
  client.on('error', () => {});
  await client.connect();
  return client;
}
async function query(server, database, sql, params = []) {
  const client = await connect(server, database);
  try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
}
async function cloudIdentity() {
  const adc = await json(ADC);
  if (adc.type !== 'service_account' || adc.client_email !== ACCOUNT) throw new Error('ADC is not the expected Mint service account');
}
async function storage(args) {
  await cloudIdentity();
  return run(GCLOUD, [`--credential-file-override=${ADC}`, '--quiet', 'storage', ...args], {
    env: { CLOUDSDK_CONFIG: path.join(ROOT, 'gcloud'), CLOUDSDK_CORE_DISABLE_PROMPTS: '1' }, quiet: true,
  });
}
async function withProxy(work) {
  await cloudIdentity();
  const child = spawn(PROXY, ['--auto-iam-authn', `--credentials-file=${ADC}`, '--address=127.0.0.1', '--port=55432',
    'storytree-498613:australia-southeast1:storytree-pg'], { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false, error;
  child.on('error', e => { error = e; });
  const ended = new Promise(resolve => child.on('close', () => { exited = true; resolve(); }));
  // Drain output without disclosing credential-related diagnostic text.
  child.stdout.resume(); child.stderr.resume();
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await pause(1000);
      if (error || exited) throw new Error('The dedicated Cloud SQL proxy did not start; check port 55432 and IAM access.');
      // A full instance still proves the proxy is up; callers wait for a slot themselves.
      try { await query(CLOUD, 'postgres', 'SELECT 1'); ready = true; break; } catch (e) { if (FULL.test(e.message)) { ready = true; break; } }
    }
    if (!ready) throw new Error('Cloud SQL proxy connection timed out');
    return await work();
  } finally {
    if (!exited) { child.kill('SIGTERM'); await ended; }
  }
}

async function counts(client) {
  const tables = (await client.query(`SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename`)).rows;
  const result = {};
  for (const { schemaname, tablename } of tables) {
    result[`${schemaname}.${tablename}`] = (await client.query(`SELECT count(*)::text AS n FROM ${q(schemaname)}.${q(tablename)}`)).rows[0].n;
  }
  return result;
}
async function dump(server, database, directory) {
  const client = await connect(server, database);
  const file = `${database}.dump`;
  try {
    // Cloud's IAM member must act as the table owner to bypass CI-only RLS, just like contract 8.3.
    const ownership = (await client.query(`SELECT pg_get_userbyid(datdba) AS name,
      pg_has_role(session_user, datdba, 'SET') AS may FROM pg_database WHERE datname=current_database()`)).rows[0];
    const owner = ownership.name;
    if (!ownership.may) throw new Error(`Cannot act as ${owner}, the owner of ${database}; refused before dumping`);
    await client.query(`SET ROLE ${q(owner)}`);
    // An error, never silently filtered rows, if row security would apply.
    await client.query('SET row_security = off');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const version = (await client.query('SHOW server_version')).rows[0].server_version;
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    await run('pg_dump', ['-Fc', '--no-password', `--snapshot=${snapshot}`, `--role=${owner}`, '-f', path.join(directory, file)], { env: pgEnv(server, database) });
    const rows = await counts(client);
    await client.query('COMMIT');
    return { name: database, file, owner, version, snapshot, rows, bytes: (await stat(path.join(directory, file))).size, sha256: await sha256(path.join(directory, file)) };
  } finally { await client.end(); }
}
async function newDatabase(server, name, owner) {
  await patiently(() => query(server, 'postgres', `CREATE DATABASE ${q(name)} OWNER ${q(owner)} TEMPLATE template0`));
  await patiently(() => query(server, 'postgres', `COMMENT ON DATABASE ${q(name)} IS ${lit(MARK)}`));
}
async function ownedDatabase(server, name) {
  const rows = await query(server, 'postgres', `SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname=$1`, [name]);
  if (rows[0]?.mark !== MARK) throw new Error(`Refusing to alter unowned database ${name}`);
}
async function dropCreated(server, name) {
  // No FORCE: never terminate another lane's connections. The mark is rechecked on every try.
  await patiently(async () => { await ownedDatabase(server, name); await query(server, 'postgres', `DROP DATABASE ${q(name)}`); });
}
async function restore(server, name, owner, directory, entry) {
  if (await sha256(path.join(directory, entry.file)) !== entry.sha256) throw new Error('Dump checksum mismatch');
  await run('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', `--role=${owner}`, '-d', name, path.join(directory, entry.file)], { env: pgEnv(server, name) });
  const client = await connect(server, name, owner);
  try { checkedCounts(entry.rows, await counts(client)); } finally { await client.end(); }
}
async function scratchRestore(server, directory, entry, name = `st_verify_${randomBytes(8).toString('hex')}`, owner = OWNER) {
  // CREATE fails if the name already exists; cleanup only follows our successful CREATE.
  await newDatabase(server, name, owner);
  try { await restore(server, name, owner, directory, entry); }
  finally { await dropCreated(server, name); }
}

async function provision() {
  for (const [role, file, createdb] of [[OWNER, PASSWORD, true], [CI, CI_PASSWORD, false]]) {
    const exists = await query(LOCAL, 'postgres', 'SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
    if (exists.length) throw new Error(`Role ${role} already exists; provision never alters an existing role`);
    const password = randomBytes(32).toString('hex');
    await exclusive(file, password + '\n');
    const client = await connect(LOCAL);
    try {
      await client.query("SET log_statement = 'none'");
      await client.query("SET log_min_error_statement = 'panic'");
      await client.query('SET log_min_duration_statement = -1');
      await client.query('SET log_min_duration_sample = -1');
      await client.query('SET log_transaction_sample_rate = 0');
      await client.query('SET log_duration = off');
      await client.query(`CREATE ROLE ${q(role)} LOGIN ${createdb ? 'CREATEDB' : 'NOCREATEDB'} NOSUPERUSER NOCREATEROLE NOREPLICATION PASSWORD ${lit(password)}`);
      await client.query(`COMMENT ON ROLE ${q(role)} IS ${lit(MARK)}`);
    } catch { throw new Error(`Role provisioning failed for ${role}; details suppressed to protect the password`); }
    finally { await client.end(); }
  }
  await mkdir(ISOLATED, { mode: 0o700 });
  await run('pnpm', ['storytree', 'auth', 'set', 'postgres'], { env: { STORYTREE_HOME: ISOLATED }, input: `!cat ${PASSWORD}\n`, quiet: true });
  await run('pnpm', ['storytree', 'settings', 'set', 'library', 'postgres', `postgres://${OWNER}@127.0.0.1:5432/postgres`], { env: { STORYTREE_HOME: ISOLATED } });
  console.log('Created client and CI roles, 0600 password files, and isolated Storytree settings. Real settings unchanged.');
}
async function grants() {
  await ownedDatabase(LOCAL, 'storytree_storytree');
  await run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', path.join(HERE, 'grants.sql')], { env: pgEnv(LOCAL, 'storytree_storytree') });
}
async function rehearsal() {
  const directory = path.join(LOGS, 'rehearsal-' + stamp());
  await mkdir(directory, { mode: 0o700 });
  // The two earlier `cloud-dump-*` markers were retired by the owner's 2026-10-07 answer and stay as
  // evidence. This budget allows one fresh copy and, only if it fails a check, one more.
  const present = await query(LOCAL, 'postgres', 'SELECT datname FROM pg_database WHERE datname = ANY($1)', [DBS]);
  if (present.length) throw new Error(`Local database(s) already exist: ${present.map(r => r.datname).join(', ')}; refused before any Cloud copy`);
  const prior = (await readdir(LOGS)).filter(name => name.startsWith('cloud-copy-'));
  if (prior.length >= 2) throw new Error('Both permitted Cloud SQL copies have been used; no third dump');
  const manifest = { format: 1, at: new Date().toISOString(), source: 'storytree-pg', databases: [] };
  await withProxy(async () => {
    const actual = (await patiently(() => query(CLOUD, 'postgres', 'SELECT datname FROM pg_database WHERE datname = ANY($1)', [DBS]))).map(r => r.datname);
    if (actual.length !== DBS.length) throw new Error('A 0.3 database is missing on Cloud SQL; refused before dumping');
    // Count the attempt before the first dump, including one that fails later, to bound egress.
    await exclusive(path.join(LOGS, `cloud-copy-${stamp()}`), directory + '\n');
    for (const name of DBS) {
      console.log(`Dumping ${name}`);
      const entry = await patiently(() => dump(CLOUD, name, directory));
      manifest.databases.push(entry);
      await exclusive(path.join(directory, `${name}.manifest.json`), JSON.stringify(entry, null, 2));
    }
  });
  await exclusive(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const entry of manifest.databases) {
    await newDatabase(LOCAL, entry.name, OWNER);
    await restore(LOCAL, entry.name, OWNER, directory, entry);
    console.log(`Restored and checked ${entry.name}`);
  }
  await grants();
  console.log(`Rehearsal evidence: ${directory}`);
}

async function backup() {
  const directory = path.join(LOGS, stamp());
  await mkdir(directory, { mode: 0o700 });
  const manifest = { format: 1, at: new Date().toISOString(), source: 'mint', databases: [] };
  for (const name of DBS) {
    await ownedDatabase(LOCAL, name);
    const entry = await dump(LOCAL, name, directory);
    await scratchRestore(LOCAL, directory, entry);
    manifest.databases.push(entry);
    console.log(`Dumped, restored and checked ${name}`);
  }
  checkedManifest(manifest);
  await exclusive(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // No upload at all until every database restored and matched. Manifest is the completion marker.
  const prefix = `${BUCKET}/backups/${path.basename(directory)}`;
  for (const entry of manifest.databases) await storage(['cp', path.join(directory, entry.file), `${prefix}/${entry.file}`, '--if-generation-match=0']);
  await storage(['cp', path.join(directory, 'manifest.json'), `${prefix}/manifest.json`, '--if-generation-match=0']);
  console.log(await storage(['ls', prefix + '/']));
  await exclusive(path.join(directory, 'uploaded.json'), JSON.stringify({ prefix, at: new Date().toISOString() }));
  // Retain the manifest/log; only remove this run's own dumps, after all uploads succeeded.
  for (const entry of manifest.databases) await unlink(path.join(directory, entry.file));
  console.log(`Verified backup: ${prefix}`);
  return { directory, manifest, prefix };
}
async function download(prefix) {
  if (!new RegExp('^' + BUCKET + '/backups/[A-Za-z0-9-]+$').test(prefix ?? '')) throw new Error('Give one backup prefix from this bucket');
  const directory = path.join(LOGS, 'download-' + stamp());
  await mkdir(directory, { mode: 0o700 });
  await storage(['cp', `${prefix}/manifest.json`, path.join(directory, 'manifest.json')]);
  const manifest = checkedManifest(await json(path.join(directory, 'manifest.json')));
  for (const entry of manifest.databases) {
    await storage(['cp', `${prefix}/${entry.file}`, path.join(directory, entry.file)]);
    if ((await stat(path.join(directory, entry.file))).size !== entry.bytes || await sha256(path.join(directory, entry.file)) !== entry.sha256) throw new Error('Downloaded dump size/hash mismatch');
  }
  return { directory, manifest };
}
async function bucketRestore(prefix, cloud) {
  const { directory, manifest } = await download(prefix);
  if (cloud) await withProxy(async () => {
    // Only this scratch database may be created/dropped on Cloud SQL by this increment.
    // Prefer the role that owns the project database, so the rehearsal mirrors the real rollback.
    const roles = await patiently(() => query(CLOUD, 'postgres', `SELECT rolname FROM pg_roles WHERE rolcreatedb AND pg_has_role(session_user, oid, 'SET')
      ORDER BY (rolname = (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'storytree_storytree')) DESC, rolname`));
    if (!roles.length) throw new Error('Mint IAM cannot create Cloud SQL databases; laptop must do the rollback rehearsal');
    const role = roles[0].rolname;
    const server = { ...CLOUD, options: `-c role=${role}` };
    await scratchRestore(server, directory, manifest.databases.find(entry => entry.name === 'storytree_storytree'), 'storytree_rollback_rehearsal', role);
    console.log('Cloud SQL rollback rehearsal restored, checked and dropped only storytree_rollback_rehearsal.');
  });
  else for (const entry of manifest.databases) await scratchRestore(LOCAL, directory, entry);
  await exclusive(path.join(directory, cloud ? 'cloud-restore-passed' : 'local-restore-passed'), new Date().toISOString());
  console.log(`Bucket restore proof: ${directory}`);
}

async function installTimer() {
  const linger = await run('loginctl', ['show-user', 'mickh', '-p', 'Linger']);
  if (linger !== 'Linger=yes') throw new Error('Linger is off; owner must run sudo loginctl enable-linger mickh');
  const units = path.join(homedir(), '.config/systemd/user');
  await mkdir(units, { recursive: true });
  // Freeze the reviewed script outside the disposable worktree. pg resolves from the permanent
  // checkout's installed dependencies; no source from that checkout is run by a backup.
  const permanent = path.join(homedir(), 'code/storytree03');
  const runtime = path.join(ROOT, 'runtime-' + stamp());
  await mkdir(runtime, { mode: 0o700 });
  for (const file of ['host.mjs', 'grants.sql']) await copyFile(path.join(HERE, file), path.join(runtime, file), 1);
  await symlink(path.join(permanent, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
  const service = `[Unit]\nDescription=Verified Storytree library backups\n\n[Service]\nType=oneshot\nWorkingDirectory=${permanent}\nEnvironment=PATH=${process.env.PATH}\nEnvironment=LIBRARY_HOST_REPO=${permanent}\nExecStart=${process.execPath} ${runtime}/host.mjs backup\nUMask=0077\nStandardOutput=append:${LOGS}/timer.log\nStandardError=append:${LOGS}/timer.log\n`;
  const timer = '[Unit]\nDescription=Back up Storytree every six hours\n\n[Timer]\nOnCalendar=*-*-* 00,06,12,18:00:00 UTC\nPersistent=true\nRandomizedDelaySec=60\n\n[Install]\nWantedBy=timers.target\n';
  await exclusive(path.join(units, 'storytree-library-backup.service'), service);
  await exclusive(path.join(units, 'storytree-library-backup.timer'), timer);
  await run('systemctl', ['--user', 'daemon-reload']);
  await run('systemctl', ['--user', 'enable', '--now', 'storytree-library-backup.timer']);
  console.log(await run('systemctl', ['--user', 'list-timers', 'storytree-library-backup.timer', '--no-pager']));
}

const actions = ['provision', 'rehearsal', 'backup', 'restore-backup', 'rollback-rehearsal', 'install-timer'];
export async function main(args) {
  const [action, ...rest] = args;
  const dry = rest.includes('--dry-run');
  const positional = rest.filter(arg => arg !== '--dry-run');
  if (!actions.includes(action) || positional.length > (['restore-backup', 'rollback-rehearsal'].includes(action) ? 1 : 0)) throw new Error(`Usage: host.mjs ${actions.join('|')} [backup-prefix] [--dry-run]`);
  if (dry) {
    console.log(`DRY RUN ${action}: databases ${DBS.join(', ')}; local socket ${LOCAL.host}:${LOCAL.port}; bucket ${BUCKET}.`);
    console.log('Create-only local files/roles/databases; marked scratch databases only may be dropped; uploads require all restored row counts to match.');
    console.log('Cloud SQL is never stopped/reconfigured. Real Storytree settings are untouched. No subprocess, connection or write was made.');
    return;
  }
  process.umask(0o077);
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await mkdir(LOGS, { recursive: true, mode: 0o700 });
  const lock = await operationLock();
  try {
    if (action === 'provision') await provision();
    else if (action === 'rehearsal') await rehearsal();
    else if (action === 'backup') await backup();
    else if (action === 'restore-backup') await bucketRestore(positional[0], false);
    else if (action === 'rollback-rehearsal') await bucketRestore(positional[0], true);
    else if (action === 'install-timer') await installTimer();
  } finally { await lock.end(); }
}

async function operationLock() {
  const lock = await connect(LOCAL);
  if (!(await lock.query('SELECT pg_try_advisory_lock(928, 34390) AS held')).rows[0].held) {
    await lock.end();
    throw new Error('Another library-host operation is running');
  }
  // Session lock: the server releases it after exit, SIGKILL, connection loss or reboot.
  return lock;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

// Shared only with the separately reviewed cutover/rollback operator script.
export const operator = { ROOT, LOGS, REPO, HERE, LOCAL, CLOUD, OWNER, DBS, PASSWORD, ISOLATED, MARK,
  stamp, q, lit, exclusive, json, run, query, withProxy, dump, newDatabase, ownedDatabase, restore, grants, operationLock, dropCreated };
