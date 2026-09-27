// Cancel an actual MCP edit while the project's writer lock stops it from writing.
import { connect } from '@storytree/library';
import { url, project, sql, waitQuery, emit, sleep } from './common.mjs';
import { mcp } from './mcp-client.mjs';

const began = Date.now();
const name = 'chaos-cancel';
const folder = project(name);
const tree = await connect({ url });
const library = await tree.openProject(name);
const story = await library.addStory({ title: 'Before cancellation' });
const blocker = await sql('storytree_' + name);
const observer = await sql();
let agent;
try {
  agent = await mcp(folder, 'chaos-cancelled-session');
  await agent.call('show_plan'); // Connect before taking the lock; exclude schema startup.
  await blocker.query('BEGIN');
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
  const pending = agent.call('edit_plan', { id: story.id, title: 'CANCELLED EDIT STILL WRITTEN' });
  const outcome = pending.then(result => ({ result }), error => ({ error: error.message }));
  await waitQuery(observer, "SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
  agent.cancel(pending);
  emit('cancel-sent-before-unlock', { requestId: pending.requestId, fields: (await library.get(story.id)).fields });
  await sleep(250); // Allow the separate MCP process to receive the cancellation.
  await blocker.query('COMMIT');
  await sleep(250);
  emit('record-after-cancel-and-unlock', { fields: (await library.get(story.id)).fields, history: (await library.history({ id: story.id })).map(h => ({ seq: h.seq, actor: h.actor, fields: h.record.fields })) });
  emit('cancelled-call-response', await outcome);
} finally {
  await blocker.query('ROLLBACK').catch(() => {});
  await agent?.stop();
  await blocker.end(); await observer.end(); await tree.close();
}
emit('drill-finished', { ms: Date.now() - began });
