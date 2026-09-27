// Concurrent project opens and an app-library write racing a CLI write.
import { connect } from '@storytree/library';
import { openActivityLog } from '@storytree/agent-link';
import { url, project, sql, cli, hook, waitQuery, emit, sleep } from './common.mjs';

const began = Date.now();
const a = project('chaos-a'), b = project('chaos-b');
const opens = await Promise.all([
  cli(['library', 'new', 'story', '--title', 'Only A'], a).done,
  cli(['library', 'new', 'story', '--title', 'Only B'], b).done,
]);
emit('two-projects-created-concurrently', { opens });
emit('two-project-hooks', { hooks: await Promise.all([hook('chaos-session-a', a).done, hook('chaos-session-b', b).done]) });
const tree = await connect({ url });
const log = await openActivityLog(url);
const [la, lb] = await Promise.all([tree.openProject('chaos-a'), tree.openProject('chaos-b')]);
const blocker = await sql('storytree_chaos-a');
const observer = await sql();
try {
  emit('project-isolation', {
    a: (await la.list('story')).map(r => r.fields.title), b: (await lb.list('story')).map(r => r.fields.title),
    aSessions: (await log.since('chaos-a', 0)).lines.map(l => l.session),
    bSessions: (await log.since('chaos-b', 0)).lines.map(l => l.session),
  });
  const target = (await la.list('story'))[0];
  await blocker.query('BEGIN');
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
  const command = cli(['library', 'edit', target.id, '--title', 'CLI title'], a);
  await waitQuery(observer, "SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
  // Same public library API the app uses, with a different field of the same record.
  const appWrite = la.editStory(target.id, { description: 'App description' }, { actor: 'chaos:app' });
  const otherProjectBegan = Date.now();
  const other = await cli(['library', 'edit', (await lb.list('story'))[0].id, '--title', 'B while A blocked'], b).done;
  emit('b-progress-while-a-blocked', { ...other, elapsed: Date.now() - otherProjectBegan });
  await sleep(6500);
  emit('cli-write-still-blocked', { exited: command.proc.exitCode });
  await blocker.query('COMMIT');
  await appWrite;
  emit('cli-write-after-unlock', await command.done);
  emit('both-fields-survive', { fields: (await la.get(target.id)).fields, history: (await la.history({ id: target.id })).map(h => ({ seq: h.seq, actor: h.actor, fields: h.record.fields })) });
} finally {
  await blocker.query('ROLLBACK').catch(() => {});
  await blocker.end(); await observer.end(); await log.close(); await tree.close();
}
emit('drill-finished', { ms: Date.now() - began });
