#!/usr/bin/env node
// ADR-0928: reviewed operator tools for this host, never imported by the product.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.LIBRARY_HOST_REPO ?? path.resolve(HERE, '../..');
const ROOT = path.join(homedir(), '.storytree/library-host');
const LOGS = path.join(homedir(), 'storytree-lanes/library-backups');
// Each uploaded backup's digest, create-only: the last one holds the last seq and the running SHA-256 the next extends.
const DIGESTS = path.join(LOGS, 'digests');
const ADC = path.join(homedir(), '.config/gcloud/application_default_credentials.json');
const GCLOUD = path.join(homedir(), 'google-cloud-sdk/bin/gcloud');
// The cloud project is the one the Mint service account belongs to, read from its credentials (mintProject):
// the backup bucket and CI's role are named after it.
const bucketOf = project => `gs://${project}-library-backups`;
// The box's own account, which runs these tools and is the database's local superuser over the socket.
const ACCOUNT = userInfo().username;
// The box's PostgreSQL 16 clients by absolute path, never whatever a PATH lookup finds first.
const PG_BIN = '/usr/lib/postgresql/16/bin';
const LOCAL = { host: '/var/run/postgresql', port: 5432, user: ACCOUNT };
const OWNER = 'storytree_library';
// The backup timer's whole PATH: gcloud and the PostgreSQL clients are named by absolute path.
const UNIT_PATH = '/usr/bin:/bin';
// A backup's uploads finish within this long of the time its prefix is named for (about ten minutes in October 2026).
const UPLOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
// The name CI's role had before the library moved here, so grants.sql's row policies name it unchanged. Local SCRAM, not IAM.
const ciRoleOf = project => `storytree-ci-health@${project}.iam`;
// The three 0.3 databases. 0.2's frozen `storytree` was never moved here (owner, 2026-10-07: "we dont need backups
// for 0.2"); its final export sits under the bucket's archive/.
const DBS = ['storytree_storytree', 'storytree-activity', 'storytree-trunks'];
// Backed up beside them: the lag runner's history (packages/dev-loop/src/lag-box.mjs), whose baselines and
// recorded reasons cannot be measured again, and the QA ledger (packages/quality-assurance), whose review history
// ADR-0956 D7's ten-review refusal counts.
const BACKED = [...DBS, 'storytree-lag', 'storytree-quality'];
const MARK = 'storytree library-host increment_b3ccd17ff113';
const PASSWORD = path.join(ROOT, 'postgres-password');
const CI_PASSWORD = path.join(ROOT, 'ci-health-password');
const ISOLATED = path.join(ROOT, 'smoke-home');
const q = value => '"' + value.replaceAll('"', '""') + '"';
const lit = value => "'" + value.replaceAll("'", "''") + "'";
const stamp = () => new Date().toISOString().replaceAll(/[-:.]/g, '') + '-' + randomBytes(4).toString('hex');

export function checkedCounts(source, restored) {
  const sorted = rows => JSON.stringify(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(source) !== sorted(restored)) throw new Error('Restored row counts differ from the dump snapshot; nothing will be uploaded.');
}

export function checkedManifest(manifest) {
  if (manifest?.format !== 1 || !Array.isArray(manifest.databases) ||
      // A backup from before storytree-lag, or then storytree-quality, joined still restores.
      ![DBS, [...DBS, 'storytree-lag'], BACKED].some(names => JSON.stringify(manifest.databases.map(d => d.name).sort()) === JSON.stringify([...names].sort())) ||
      manifest.databases.some(d => d.file !== `${d.name}.dump` || !/^[a-f0-9]{64}$/.test(d.sha256) ||
        !Number.isSafeInteger(d.bytes) || d.bytes <= 0 || !d.rows ||
        Object.values(d.rows).some(n => !/^\d+$/.test(n)))) {
    throw new Error('Invalid or incomplete backup manifest');
  }
  return manifest;
}

// A restore takes only a prefix the off-box check verified: its manifest's SHA-256 is on the verified list (one hash
// opening each line; `#` lines are comments), its name's time is not in the future, and every object in it was
// created in the upload window after that time.
/** The cloud project of the Mint service account's credentials, refused unless they are that account's. */
export function mintProject(adc) {
  const project = adc?.project_id;
  if (adc?.type !== 'service_account' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? '') ||
      adc.client_email !== `storytree-mint@${project}.iam.gserviceaccount.com`) throw new Error('ADC is not the expected Mint service account');
  return project;
}

export function checkedPrefix({ prefix, manifestHash, verified, objects, now = new Date() }) {
  const listed = new Set(verified.split('\n').map(line => line.trim()).filter(line => !line.startsWith('#'))
    .map(line => line.split(/\s+/)[0]).filter(hash => /^[a-f0-9]{64}$/.test(hash)));
  if (!listed.has(manifestHash)) throw new Error('This backup\'s manifest is not verified off the box; refused before any restore');
  checkedCreation({ prefix, objects, now });
}

/** A backup's name is the time it began: not in the future, and every object in it created in the upload window after it. */
export function checkedCreation({ prefix, objects, now = new Date() }) {
  const name = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[a-f0-9]{8}$/.exec(path.basename(prefix ?? ''));
  if (!name) throw new Error('The backup prefix carries no timestamp');
  const [, y, mo, d, h, mi, sec, ms] = name.map(Number);
  const at = Date.UTC(y, mo - 1, d, h, mi, sec, ms);
  if (at > now.getTime()) throw new Error('The backup prefix is stamped in the future');
  const created = objects.map(object => Date.parse(object.creation_time));
  // Creation times are reported to the second.
  if (!created.length || created.some(t => !(t >= Math.floor(at / 1000) * 1000 && t <= at + UPLOAD_WINDOW_MS))) {
    throw new Error('The backup\'s object creation times do not match its prefix\'s timestamp');
  }
}

// The digest chain (verify-offbox.mjs checks it from off the box): each uploaded backup's digest carries the next seq
// and a SHA-256 over the previous digest's, the backup's name and its manifest's hash, so a backup cannot be dropped
// from the chain, nor one slipped in, without the next check seeing it.
const GENESIS = '0'.repeat(64);
export function chainOf(previous, seq, prefix, manifest) {
  return createHash('sha256').update(`${previous}\n${seq}\n${prefix}\n${manifest}`).digest('hex');
}
export function nextDigest(last, prefix, manifest) {
  const seq = (last?.seq ?? 0) + 1;
  const previous = last?.chain ?? GENESIS;
  return { format: 1, seq, prefix, manifest, previous, chain: chainOf(previous, seq, prefix, manifest) };
}
const digestFile = seq => `${String(seq).padStart(8, '0')}.json`;
export async function lastDigest(folder) {
  const files = (await readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; }))
    .filter(name => /^\d{8}\.json$/.test(name)).sort();
  return files.length ? json(path.join(folder, files.at(-1))) : undefined;
}
export async function saveDigest(folder, digest) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await exclusive(path.join(folder, digestFile(digest.seq)), JSON.stringify(digest));
}

export function restorer(password) {
  return { host: '127.0.0.1', port: 5432, user: OWNER, password };
}
export function restoreCommand(server, name, file) {
  return { command: path.posix.join(PG_BIN, 'pg_restore'),
    args: ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-d', name, file],
    env: pgEnv(server, name) };
}
// The account a dump of `database` acts as: none for a superuser, else the owner, refused when it may not act as it.
export function dumpRole(database, { name, may, superuser }) {
  if (superuser) return undefined;
  if (!may) throw new Error(`Cannot act as ${name}, the owner of ${database}; refused before dumping`);
  return name;
}
// `role` is the account the dump acts as, or none to dump as the account that connected.
export function dumpCommand(server, database, snapshot, role, file) {
  return { command: path.posix.join(PG_BIN, 'pg_dump'),
    args: ['-Fc', '--no-password', `--snapshot=${snapshot}`, ...(role ? [`--role=${role}`] : []), '-f', file], env: pgEnv(server, database) };
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
    PGCONNECT_TIMEOUT: '15', ...(server.password ? { PGPASSWORD: server.password } : {}),
    ...(role ? { PGOPTIONS: `-c role=${role}` } : {}) };
}
async function connect(server, database = 'postgres', role) {
  // pg also consults the parent environment when a config value is empty.
  for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];
  const client = new pg.Client({ ...server, database, password: server.password ?? '', connectionTimeoutMillis: 15000,
    ...(role ? { options: `-c role=${role}` } : {}) });
  client.on('error', () => {});
  await client.connect();
  return client;
}
async function query(server, database, sql, params = []) {
  const client = await connect(server, database);
  try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
}
async function cloudProject() { return mintProject(await json(ADC)); }
async function storage(args) {
  await cloudProject();
  return run(GCLOUD, [`--credential-file-override=${ADC}`, '--quiet', 'storage', ...args], {
    env: { CLOUDSDK_CONFIG: path.join(ROOT, 'gcloud'), CLOUDSDK_CORE_DISABLE_PROMPTS: '1' }, quiet: true,
  });
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
    // A superuser (the box's own account) dumps as itself: it passes row-level security even where it is forced on
    // the owner (library contract 1.28). Any other account acts as the table owner to pass CI-only RLS, as contract 8.3.
    const ownership = (await client.query(`SELECT pg_get_userbyid(datdba) AS name,
      pg_has_role(session_user, datdba, 'SET') AS may,
      (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS superuser
      FROM pg_database WHERE datname=current_database()`)).rows[0];
    const owner = ownership.name;
    const role = dumpRole(database, ownership);
    if (role) await client.query(`SET ROLE ${q(role)}`);
    // An error, never silently filtered rows, if row security would apply.
    await client.query('SET row_security = off');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const version = (await client.query('SHOW server_version')).rows[0].server_version;
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const { command, args, env } = dumpCommand(server, database, snapshot, role, path.join(directory, file));
    await run(command, args, { env });
    const rows = await counts(client);
    await client.query('COMMIT');
    return { name: database, file, owner, version, snapshot, rows, bytes: (await stat(path.join(directory, file))).size, sha256: await sha256(path.join(directory, file)) };
  } finally { await client.end(); }
}
async function newDatabase(server, name, owner) {
  await query(server, 'postgres', `CREATE DATABASE ${q(name)} OWNER ${q(owner)} TEMPLATE template0`);
  await query(server, 'postgres', `COMMENT ON DATABASE ${q(name)} IS ${lit(MARK)}`);
}
async function ownedDatabase(server, name) {
  const rows = await query(server, 'postgres', `SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname=$1`, [name]);
  if (rows[0]?.mark !== MARK) throw new Error(`Refusing to alter unowned database ${name}`);
}
async function dropCreated(server, name) {
  // No FORCE: never terminate another lane's connections. The mark is checked first.
  await ownedDatabase(server, name);
  await query(server, 'postgres', `DROP DATABASE ${q(name)}`);
}
// A dump's SQL runs, and its counts are read, as the library's own role over 127.0.0.1, never as the superuser
// that creates and drops the scratch database around it. The database is the role's, so its objects become the role's.
async function restore(name, directory, entry) {
  if (await sha256(path.join(directory, entry.file)) !== entry.sha256) throw new Error('Dump checksum mismatch');
  const server = restorer((await readFile(PASSWORD, 'utf8')).trim());
  const { command, args, env } = restoreCommand(server, name, path.join(directory, entry.file));
  await run(command, args, { env });
  const client = await connect(server, name);
  try { checkedCounts(entry.rows, await counts(client)); } finally { await client.end(); }
}
async function scratchRestore(directory, entry, name = `st_verify_${randomBytes(8).toString('hex')}`) {
  // CREATE fails if the name already exists; cleanup only follows our successful CREATE.
  await newDatabase(LOCAL, name, OWNER);
  try { await restore(name, directory, entry); }
  finally { await dropCreated(LOCAL, name); }
}

async function provision() {
  const ci = ciRoleOf(await cloudProject());
  for (const [role, file, createdb] of [[OWNER, PASSWORD, true], [ci, CI_PASSWORD, false]]) {
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
async function backup() {
  const directory = path.join(LOGS, stamp());
  await mkdir(directory, { mode: 0o700 });
  const manifest = { format: 1, at: new Date().toISOString(), source: 'mint', databases: [] };
  for (const name of BACKED) {
    // storytree-lag and storytree-quality were made by their own packages, not here, so they carry no mark; dump still refuses a stranger's database.
    if (DBS.includes(name)) await ownedDatabase(LOCAL, name);
    const entry = await dump(LOCAL, name, directory);
    await scratchRestore(directory, entry);
    manifest.databases.push(entry);
    console.log(`Dumped, restored and checked ${name}`);
  }
  checkedManifest(manifest);
  await exclusive(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // No upload at all until every database restored and matched. Manifest is the completion marker.
  const prefix = `${bucketOf(await cloudProject())}/backups/${path.basename(directory)}`;
  for (const entry of manifest.databases) await storage(['cp', path.join(directory, entry.file), `${prefix}/${entry.file}`, '--if-generation-match=0']);
  await storage(['cp', path.join(directory, 'manifest.json'), `${prefix}/manifest.json`, '--if-generation-match=0']);
  // The digest goes up after the manifest and is saved here only once it is up, so a failed upload leaves no gap.
  const digest = nextDigest(await lastDigest(DIGESTS), path.basename(directory), await sha256(path.join(directory, 'manifest.json')));
  await exclusive(path.join(directory, 'digest.json'), JSON.stringify(digest));
  await storage(['cp', path.join(directory, 'digest.json'), `${prefix}/digest.json`, '--if-generation-match=0']);
  await saveDigest(DIGESTS, digest);
  console.log(await storage(['ls', prefix + '/']));
  await exclusive(path.join(directory, 'uploaded.json'), JSON.stringify({ prefix, at: new Date().toISOString() }));
  // Retain the manifest/log; only remove this run's own dumps, after all uploads succeeded.
  for (const entry of manifest.databases) await unlink(path.join(directory, entry.file));
  console.log(`Verified backup: ${prefix}`);
  return { directory, manifest, prefix };
}
async function download(prefix, verifiedFile) {
  if (!new RegExp('^' + bucketOf(await cloudProject()) + '/backups/[A-Za-z0-9-]+$').test(prefix ?? '')) throw new Error('Give one backup prefix from this bucket');
  if (!verifiedFile) throw new Error('Give the off-box verified list with --verified <file>');
  const verified = await readFile(verifiedFile, 'utf8');
  const directory = path.join(LOGS, 'download-' + stamp());
  await mkdir(directory, { mode: 0o700 });
  const objects = JSON.parse(await storage(['objects', 'list', `${prefix}/*`, '--format=json(name,creation_time)']));
  await storage(['cp', `${prefix}/manifest.json`, path.join(directory, 'manifest.json')]);
  checkedPrefix({ prefix, manifestHash: await sha256(path.join(directory, 'manifest.json')), verified, objects });
  const manifest = checkedManifest(await json(path.join(directory, 'manifest.json')));
  for (const entry of manifest.databases) {
    await storage(['cp', `${prefix}/${entry.file}`, path.join(directory, entry.file)]);
    if ((await stat(path.join(directory, entry.file))).size !== entry.bytes || await sha256(path.join(directory, entry.file)) !== entry.sha256) throw new Error('Downloaded dump size/hash mismatch');
  }
  return { directory, manifest };
}
async function bucketRestore(prefix, verifiedFile) {
  const { directory, manifest } = await download(prefix, verifiedFile);
  for (const entry of manifest.databases) await scratchRestore(directory, entry);
  await exclusive(path.join(directory, 'local-restore-passed'), new Date().toISOString());
  console.log(`Bucket restore proof: ${directory}`);
}

// The reviewed script and its pg dependency, bundled into one file in a runtime folder outside the disposable
// worktree: nothing a backup runs resolves from any checkout's node_modules.
export async function bundleRuntime(runtime) {
  const { build } = await import('esbuild');
  await build({ entryPoints: [path.join(HERE, 'host.mjs')], outfile: path.join(runtime, 'host.mjs'), bundle: true,
    platform: 'node', format: 'esm', external: ['pg-native', 'esbuild'], logLevel: 'error',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
}
export function timerUnits(runtime, permanent, node) {
  const service = `[Unit]\nDescription=Verified Storytree library backups\n\n[Service]\nType=oneshot\nWorkingDirectory=${permanent}\nEnvironment=PATH=${UNIT_PATH}\nEnvironment=LIBRARY_HOST_REPO=${permanent}\nExecStart=${node} ${runtime}/host.mjs backup\nUMask=0077\nStandardOutput=append:${LOGS}/timer.log\nStandardError=append:${LOGS}/timer.log\n`;
  const timer = '[Unit]\nDescription=Back up Storytree every six hours\n\n[Timer]\nOnCalendar=*-*-* 00,06,12,18:00:00 UTC\nPersistent=true\nRandomizedDelaySec=60\n\n[Install]\nWantedBy=timers.target\n';
  return { service, timer };
}

async function installTimer() {
  const linger = await run('loginctl', ['show-user', ACCOUNT, '-p', 'Linger']);
  if (linger !== 'Linger=yes') throw new Error(`Linger is off; owner must run sudo loginctl enable-linger ${ACCOUNT}`);
  const units = path.join(homedir(), '.config/systemd/user');
  await mkdir(units, { recursive: true });
  const permanent = path.join(homedir(), 'code/storytree03');
  const runtime = path.join(ROOT, 'runtime-' + stamp());
  await mkdir(runtime, { mode: 0o700 });
  await bundleRuntime(runtime);
  const { service, timer } = timerUnits(runtime, permanent, process.execPath);
  await exclusive(path.join(units, 'storytree-library-backup.service'), service);
  await exclusive(path.join(units, 'storytree-library-backup.timer'), timer);
  await run('systemctl', ['--user', 'daemon-reload']);
  await run('systemctl', ['--user', 'enable', '--now', 'storytree-library-backup.timer']);
  console.log(await run('systemctl', ['--user', 'list-timers', 'storytree-library-backup.timer', '--no-pager']));
}

const actions = ['provision', 'backup', 'restore-backup', 'install-timer'];
export async function main(args) {
  const [action, ...rest] = args;
  const dry = rest.includes('--dry-run');
  const at = rest.indexOf('--verified');
  const verifiedFile = at >= 0 ? rest[at + 1] : undefined;
  const positional = rest.filter((arg, i) => arg !== '--dry-run' && (at < 0 || (i !== at && i !== at + 1)));
  if (!actions.includes(action) || positional.length > (action === 'restore-backup' ? 1 : 0) ||
      (at >= 0 && (action !== 'restore-backup' || !verifiedFile))) {
    throw new Error(`Usage: host.mjs ${actions.join('|')} [backup-prefix --verified <file>] [--dry-run]`);
  }
  if (dry) {
    console.log(`DRY RUN ${action}: databases ${BACKED.join(', ')}; local socket ${LOCAL.host}:${LOCAL.port}; bucket ${bucketOf('<the Mint service account\'s project>')}.`);
    console.log('Create-only local files/roles/databases; marked scratch databases only may be dropped; uploads require all restored row counts to match.');
    console.log(`Dumps restore as ${OWNER} over 127.0.0.1; a bucket restore takes only a prefix whose manifest is on the off-box verified list.`);
    console.log('Real Storytree settings are untouched. No subprocess, connection or write was made.');
    return;
  }
  process.umask(0o077);
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await mkdir(LOGS, { recursive: true, mode: 0o700 });
  const lock = await operationLock();
  try {
    if (action === 'provision') await provision();
    else if (action === 'backup') await backup();
    else if (action === 'restore-backup') await bucketRestore(positional[0], verifiedFile);
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

// Node runs the entry point from its real path, so compare real paths (macOS's /var is a symlink).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

// Shared only with the separately reviewed smoke and local fixture scripts.
export const operator = { LOGS, LOCAL, OWNER, ISOLATED, stamp, q, exclusive, run, query, dump, newDatabase, restore, operationLock, dropCreated, counts, sha256 };
