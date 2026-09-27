// Kill the actual hook executable after BEGIN, while its INSERT is blocked.
import { openActivityLog } from '@storytree/agent-link';
import { url, project, sql, hook, waitQuery, emit, sleep } from './common.mjs';

const began = Date.now();
const folder = project('chaos-hooks');
const log = await openActivityLog(url);
const blocker = await sql('storytree-activity');
const observer = await sql();
let killed;
try {
  const before = await log.since('chaos-hooks', 0);
  // A table lock also blocks openActivityLog's schema check, before the INSERT.
  // This throwaway trigger pauses only the chosen INSERT, inside its transaction.
  await blocker.query(`CREATE OR REPLACE FUNCTION chaos_pause_hook() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.session = 'chaos-killed-hook' THEN PERFORM pg_advisory_xact_lock(8675309); END IF; RETURN NEW; END $$`);
  await blocker.query('CREATE TRIGGER chaos_pause_hook BEFORE INSERT ON activity FOR EACH ROW EXECUTE FUNCTION chaos_pause_hook()');
  await blocker.query('SELECT pg_advisory_lock(8675309)');
  killed = hook('chaos-killed-hook', folder);
  await waitQuery(observer, 'INSERT INTO activity%');
  killed.proc.kill('SIGKILL');
  emit('killed-hook', await killed.done);
  await blocker.query('SELECT pg_advisory_unlock(8675309)');
  await sleep(100);
  emit('next-hook', await hook('chaos-surviving-hook', folder).done);
  const after = await log.since('chaos-hooks', before.cursor);
  emit('committed-lines', { lines: after.lines.map(({ session, kind, seq }) => ({ session, kind, seq })) });
} finally {
  if (killed?.proc.exitCode === null) killed.proc.kill('SIGKILL');
  await blocker.query('SELECT pg_advisory_unlock_all()').catch(() => {});
  await blocker.query('DROP TRIGGER IF EXISTS chaos_pause_hook ON activity');
  await blocker.query('DROP FUNCTION IF EXISTS chaos_pause_hook()');
  await blocker.end();
  await observer.end();
  await log.close();
}
emit('drill-finished', { ms: Date.now() - began });
