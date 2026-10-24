import { waitUntil } from '@storytree/test-waits';
import { probeProcess } from '../process/index.js';
import type { RunRecord } from '../ledger/records.js';

/**
 * Node's argv for a test's long-running child. Launched detached, it escapes the runner's process
 * group and any teardown a killed runner never reaches, so it ends itself once `parent` is gone.
 */
export function testChildArgs(parent = process.pid): string[] {
  return ['-e', `setInterval(() => { try { process.kill(${parent}, 0); } catch { process.exit(); } }, 250)`];
}

/** Kill a test child still running, never whatever process has since been given its PID. */
export async function stopTestChild(run: RunRecord): Promise<void> {
  if (run.birth.state !== 'live') return;
  const { identity } = run.birth;
  // Windows reuses a PID at once: a raw kill after the child exits can end a Postgres backend and
  // send the shared test server into crash recovery under every other test.
  if ((await probeProcess(identity)).state !== 'live') return;
  try { process.kill(identity.pid, 'SIGKILL'); } catch { return; }
  await waitUntil(async () => (await probeProcess(identity)).state === 'gone', 2_000, `test child ${identity.pid} to exit`);
}
