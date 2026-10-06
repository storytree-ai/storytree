#!/usr/bin/env node
// Future cutover-window operation. Never execute for real in the rehearsal increment.
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { checkFreeze, operator as o } from './host.mjs';

const [direction, ...args] = process.argv.slice(2);
if (!['cutover', 'rollback'].includes(direction) ||
    !(args.length === 1 && args[0] === '--dry-run') &&
    !(args.length === 2 && args[0] === '--execute-after-freeze')) {
  throw new Error('Usage: cutover.sh|rollback.sh --dry-run OR --execute-after-freeze /absolute/owner-freeze.json');
}
if (args[0] === '--dry-run') {
  console.log(`DRY RUN ${direction}: require fresh owner freeze of laptop, Mint lanes, CI, and backup timer; refuse open client connections.`);
  console.log('Dump all four source databases; restore and check into new staging databases; preserve old databases by renaming; atomically swap names.');
  console.log('Save original Mint settings/auth privately; switch Mint settings and key; smoke. Laptop switches itself and controls Cloud SQL power.');
  console.log('No connection, subprocess or write. Never execute in the rehearsal increment.');
} else {
  await execute().catch(error => { console.error(error.message); process.exitCode = 1; });
}

async function clientsPaused(server) {
  const live = await o.query(server, 'postgres', `SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = ANY($1) AND pid <> pg_backend_pid()`, [o.DBS]);
  if (live[0].n) throw new Error('The freeze is incomplete: database client connections remain');
}
async function execute() {
  process.umask(0o077);
  const freeze = await o.json(args[1]);
  checkFreeze(freeze, direction);
  if ((await o.run('systemctl', ['--user', 'is-active', 'storytree-library-backup.timer']).catch(() => 'inactive')) !== 'inactive') throw new Error('Stop the backup timer before the freeze');
  const directory = path.join(o.LOGS, direction + '-' + o.stamp());
  await mkdir(directory, { mode: 0o700 });
  const lock = await o.operationLock();
  try {
    // Preserve exact existing files (including unrelated keys) before changing either one.
    const realHome = path.join(homedir(), '.storytree/0.3');
    for (const file of ['settings.json', 'auth.json']) {
      try { await o.exclusive(path.join(directory, file), await readFile(path.join(realHome, file))); }
      catch (error) {
        if (file !== 'auth.json' || error.code !== 'ENOENT') throw error;
        await o.exclusive(path.join(directory, 'auth.json.absent'), 'No auth.json existed before this transition.\n');
      }
    }
    await o.withProxy(async () => {
      const source = direction === 'cutover' ? o.CLOUD : o.LOCAL;
      const target = direction === 'cutover' ? o.LOCAL : o.CLOUD;
      await clientsPaused(source);
      await clientsPaused(target);
      if (direction === 'rollback') {
        const owners = await o.query(target, 'postgres', `SELECT datname, pg_get_userbyid(datdba) AS owner,
          pg_has_role(session_user, datdba, 'SET') AS may FROM pg_database WHERE datname=ANY($1)`, [o.DBS]);
        const denied = owners.filter(row => !row.may);
        if (denied.length) throw new Error(`Mint IAM cannot replace ${denied.map(row => row.datname).join(', ')}: laptop owner must perform that part of rollback under the freeze; no dump or restore started.`);
      }
      const manifest = { format: 1, direction, at: new Date().toISOString(), databases: [] };
      for (const name of o.DBS) manifest.databases.push(await o.dump(source, name, directory));
      await o.exclusive(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const staged = [];
      for (const [i, entry] of manifest.databases.entries()) {
        if (direction === 'cutover') await o.ownedDatabase(target, entry.name);
        const owner = direction === 'cutover' ? o.OWNER : (await o.query(target, 'postgres', 'SELECT pg_get_userbyid(datdba) AS name FROM pg_database WHERE datname=$1', [entry.name]))[0]?.name;
        if (!owner) throw new Error('Target database owner is missing');
        const server = direction === 'rollback' ? { ...target, options: `-c role=${owner}` } : target;
        const suffix = o.stamp().replaceAll('-', '').slice(-16);
        const temporary = `st_migration_${suffix}_${i}`;
        const previous = `st_previous_${suffix}_${i}`;
        await o.newDatabase(server, temporary, owner);
        await o.restore(server, temporary, owner, directory, entry);
        staged.push({ name: entry.name, temporary, previous, owner });
      }
      await o.exclusive(path.join(directory, 'swap.json'), JSON.stringify(staged, null, 2));
      const undo = ['\\set ON_ERROR_STOP on', 'BEGIN;', ...staged.flatMap(item => [
        ...(direction === 'rollback' ? [`SET LOCAL ROLE ${o.q(item.owner)};`] : []),
        `ALTER DATABASE ${o.q(item.name)} RENAME TO ${o.q(item.temporary)};`,
        `ALTER DATABASE ${o.q(item.previous)} RENAME TO ${o.q(item.name)};`,
      ]), 'COMMIT;', ''];
      await o.exclusive(path.join(directory, 'undo-swap.sql'), undo.join('\n'));
      await clientsPaused(source);
      await clientsPaused(target);
      const admin = new pg.Client({ ...target, database: 'postgres', password: '', connectionTimeoutMillis: 15000 });
      await admin.connect();
      try {
        await admin.query('BEGIN');
        for (const item of staged) {
          if (direction === 'rollback') await admin.query(`SET LOCAL ROLE ${o.q(item.owner)}`);
          await admin.query(`ALTER DATABASE ${o.q(item.name)} RENAME TO ${o.q(item.previous)}`);
          await admin.query(`ALTER DATABASE ${o.q(item.temporary)} RENAME TO ${o.q(item.name)}`);
        }
        await admin.query('COMMIT');
      } catch (error) { await admin.query('ROLLBACK'); throw error; }
      finally { await admin.end(); }
      await o.exclusive(path.join(directory, 'swapped'), new Date().toISOString());
      if (direction === 'cutover') await o.grants();
      else await o.run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', path.join(o.REPO, 'infra/ci-health/grants.sql')], {
        env: { PGHOST: target.host, PGPORT: String(target.port), PGUSER: target.user, PGDATABASE: 'storytree_storytree' },
      });
      const env = { STORYTREE_HOME: realHome };
      if (direction === 'cutover') {
        await o.run('pnpm', ['storytree', 'auth', 'set', 'postgres'], { env, input: `!cat ${o.PASSWORD}\n`, quiet: true });
        await o.run('pnpm', ['storytree', 'settings', 'set', 'library', 'postgres', `postgres://${o.OWNER}@127.0.0.1:5432/postgres`], { env });
      } else {
        await o.run('pnpm', ['storytree', 'settings', 'set', 'library', 'cloudsql', 'storytree-498613:australia-southeast1:storytree-pg', o.CLOUD.user], { env });
      }
      await o.run('pnpm', ['storytree', 'arc', 'list'], { env });
      await o.run('pnpm', ['storytree', 'tree'], { env });
      await o.exclusive(path.join(directory, 'passed'), new Date().toISOString());
      console.log(`Mint ${direction} passed. Preserved settings and database names: ${directory}. Laptop must now switch and smoke before resuming.`);
    });
  } finally { await lock.end(); }
}
