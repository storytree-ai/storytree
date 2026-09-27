// Stop the real database under a blocked library read; then stall a new connection.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from '@storytree/library';
import { findBinaries } from '../../packages/local-postgres/src/binaries.ts';
import { url, home, project, sql, cli, hook, waitQuery, emit, sleep } from './common.mjs';

const began = Date.now();
const folder = project('storytree');
const tree = await connect({ url });
const library = await tree.openProject('storytree');
const before = { stories: (await library.list('story')).length, history: (await library.history()).length };
emit('baseline', before);
const blocker = await sql('storytree_storytree');
const observer = await sql();
const ctl = (...args) => execFileSync(path.join(findBinaries(), 'pg_ctl'), ['-D', path.join(home, 'pgdata'), ...args], { encoding: 'utf8' }).trim();
try {
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE record IN ACCESS EXCLUSIVE MODE');
  const pending = library.list('story').then(rows => ({ rows: rows.length }), error => ({ error: error.message, code: error.code }));
  await waitQuery(observer, 'SELECT %FROM record WHERE type%');
  emit('stop', { output: ctl('-m', 'immediate', '-w', 'stop') });
  emit('in-flight-read', await pending);
  emit('cli-while-down', await cli(['library', 'list', 'story'], folder).done);
  emit('restart', { output: ctl('-o', `-p ${new URL(url).port} -c listen_addresses=127.0.0.1`, '-l', path.join(home, 'pgdata.log'), '-w', 'start') });
  emit('same-handle-after-restart', { stories: (await library.list('story')).length, history: (await library.history()).length });
} finally {
  await blocker.end().catch(() => {});
  await observer.end().catch(() => {});
  await tree.close();
}

// Freeze only this throwaway postmaster. New TCP connections cannot complete startup.
const postgresPid = Number(readFileSync(path.join(home, 'pgdata/postmaster.pid'), 'utf8').split('\n')[0]);
let pendingCli, pendingHook;
try {
  process.kill(postgresPid, 'SIGSTOP');
  pendingCli = cli(['library', 'list', 'story'], folder);
  pendingHook = hook('chaos-slow-start', folder);
  await sleep(6500);
  emit('startup-still-stalled-at-6500ms', { cliExited: pendingCli.proc.exitCode, hookExited: pendingHook.proc.exitCode });
} finally {
  process.kill(postgresPid, 'SIGCONT');
}
emit('cli-after-resume', await pendingCli.done);
emit('hook-after-stall', await pendingHook.done);
emit('drill-finished', { ms: Date.now() - began });
