// Last drill: kill the throwaway host, observe the orphan, recover and shut down.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from '@storytree/library';
import { home, project, cli, child, emit, sleep } from './common.mjs';

const began = Date.now();
const hostFile = path.join(home, 'host.json');
const old = JSON.parse(readFileSync(hostFile, 'utf8'));
const command = readFileSync(`/proc/${old.pid}/cmdline`, 'utf8');
if (!command.includes('docs/chaos-repros/host.mjs')) throw new Error('Refusing to kill a process other than this probe host');
emit('second-owner-while-live', await child('docs/chaos-repros/host.mjs').done);
process.kill(old.pid, 'SIGKILL');
await sleep(100);
emit('cli-after-owner-death', await cli(['library', 'list', 'story'], project('storytree')).done);
const orphanPid = Number(readFileSync(path.join(home, 'pgdata/postmaster.pid'), 'utf8').split('\n')[0]);
process.kill(orphanPid, 0);
emit('orphan-postgres-still-alive', { pid: orphanPid });
const replacement = child('docs/chaos-repros/host.mjs');
try {
  let next;
  for (let i = 0; i < 100; i++) {
    next = JSON.parse(readFileSync(hostFile, 'utf8'));
    if (next.pid !== old.pid) break;
    await sleep(50);
  }
  if (next.pid === old.pid) throw new Error('Replacement did not start in 5s');
  const tree = await connect({ url: next.url });
  try {
    const library = await tree.openProject('storytree');
    emit('after-owner-recovery', { stories: (await library.list('story')).length, history: (await library.history()).length });
  } finally { await tree.close(); }
} finally {
  replacement.proc.kill('SIGTERM');
  emit('replacement-log-and-clean-shutdown', await replacement.done);
}
emit('drill-finished', { ms: Date.now() - began });
