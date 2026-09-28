import { probeProcess } from '../process/index.js';
import type { ProcessIdentity } from '../process/index.js';
export type StopPhase = 'polite' | 'force';
export type SignalResult = { readonly status: 'sent' | 'gone' } |
  { readonly status: 'unknown' | 'unsupported'; readonly reason: string };

/** Internal signal boundary. No PID-only or process-group fallback is permitted. */
export async function signalProcess(identity: ProcessIdentity, phase: StopPhase): Promise<SignalResult> {
  const current = await probeProcess(identity);
  if (current.state !== 'live') return current.state === 'gone' ? { status: 'gone' } : { status: 'unknown', reason: current.reason };
  try {
    switch (identity.platform) {
      case 'linux': return await (await import('./linux.js')).signalLinux(identity, phase);
      case 'darwin': return (await import('./darwin.js')).signalDarwin(identity, phase);
      case 'win32': return (await import('./windows.js')).signalWindows(identity, phase);
      default: return { status: 'unsupported', reason: `Lifetime-bound stopping is unavailable on ${identity.platform}` };
    }
  } catch (error) { return { status: 'unknown', reason: `Native stop unavailable: ${String(error)}` }; }
}
