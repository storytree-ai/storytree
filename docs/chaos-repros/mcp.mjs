// Restart the real MCP process under a held session, then stall first DB contact.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from '@storytree/library';
import { readClaims, openActivityLog } from '@storytree/agent-link';
import { url, home, project, emit, sleep } from './common.mjs';
import { mcp } from './mcp-client.mjs';

const began = Date.now();
const folder = project('chaos-mcp');
const tree = await connect({ url });
const library = await tree.openProject('chaos-mcp');
const story = await library.addStory({ title: 'Throwaway MCP drill' });
const capability = await library.addCapability({ story: story.id, title: 'Held through a restart' });
const log = await openActivityLog(url);
let first, rival, resumed, cold;
try {
  first = await mcp(folder, 'chaos-held-session');
  emit('claim-before-kill', await first.call('claim', { capability: capability.id, reason: 'throwaway drill' }));
  first.proc.kill('SIGKILL');
  const dead = await first.done;
  emit('killed-mcp', { code: dead.code, signal: dead.signal, ms: dead.ms });
  emit('claims-after-kill', { claims: await readClaims(log, 'chaos-mcp') });
  rival = await mcp(folder, 'chaos-rival-session');
  emit('rival-claim', await rival.call('claim', { capability: capability.id, reason: 'competing drill' }));
  resumed = await mcp(folder, 'chaos-held-session');
  emit('same-session-reclaim', await resumed.call('claim', { capability: capability.id, reason: 'resumed drill' }));
  emit('same-session-release', await resumed.call('release', { capability: capability.id }));
  emit('claims-after-release', { claims: await readClaims(log, 'chaos-mcp') });

  // A freshly started MCP server has no already-connected pool to hide a stalled startup.
  cold = await mcp(folder, 'chaos-stalled-session');
  const pid = Number(readFileSync(path.join(home, 'pgdata/postmaster.pid'), 'utf8').split('\n')[0]);
  let call;
  const started = Date.now();
  try {
    process.kill(pid, 'SIGSTOP');
    let answered = false;
    call = cold.call('show_plan').then(result => { answered = true; return result; });
    await sleep(6500);
    emit('mcp-first-contact-at-6500ms', { answered });
  } finally { process.kill(pid, 'SIGCONT'); }
  const answer = await call;
  emit('mcp-after-resume', { ms: Date.now() - started, isError: answer.isError ?? false, text: answer.content?.[0]?.text });
} finally {
  await Promise.allSettled([first, rival, resumed, cold].filter(x => x && x.proc.exitCode === null && x.proc.signalCode === null).map(x => x.stop()));
  await log.close();
  await tree.close();
}
emit('drill-finished', { ms: Date.now() - began });
