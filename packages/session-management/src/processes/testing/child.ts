import { waitUntil } from '@storytree/test-waits';
import { probeProcess } from '../process/index.js';
import type { RunRecord } from '../ledger/records.js';

export function testChildArgs(parent = process.pid): string[] {
  return ['-e', `setInterval(() => { try { process.kill(${parent}, 0); } catch { process.exit(); } }, 250)`];
}

export async function stopTestChild(run: RunRecord): Promise<void> {
  if (run.birth.state !== 'live') return;
  const { identity } = run.birth;
  if ((await probeProcess(identity)).state !== 'live') return;
  try { process.kill(identity.pid, 'SIGKILL'); } catch { return; }
  await waitUntil(async () => (await probeProcess(identity)).state === 'gone', 2_000, `test child ${identity.pid} to exit`);
}
