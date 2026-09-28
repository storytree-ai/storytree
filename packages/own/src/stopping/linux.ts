import koffi from 'koffi';
import { probeProcess } from '../process/index.js';
import type { ProcessIdentity } from '../process/index.js';
import type { SignalResult, StopPhase } from './signal.js';

const libc = koffi.load('libc.so.6');
const pidfdOpen = libc.func('int pidfd_open(int pid, unsigned int flags)');
const pidfdSendSignal = libc.func('int pidfd_send_signal(int pidfd, int sig, const void *info, unsigned int flags)');
const close = libc.func('int close(int fd)');

export async function signalLinux(identity: ProcessIdentity, phase: StopPhase): Promise<SignalResult> {
  // The fd pins a lifetime BEFORE comparison. A subsequent PID replacement cannot receive this signal.
  const fd = pidfdOpen(identity.pid, 0);
  if (fd < 0) return { status: 'unknown', reason: `pidfd_open failed (errno ${koffi.errno()})` };
  try {
    const current = await probeProcess(identity);
    if (current.state !== 'live') return current.state === 'gone' ? { status: 'gone' } : { status: 'unknown', reason: current.reason };
    if (pidfdSendSignal(fd, phase === 'polite' ? 15 : 9, null, 0) === 0) return { status: 'sent' };
    return { status: 'unknown', reason: `pidfd_send_signal failed (errno ${koffi.errno()})` };
  } finally { close(fd); }
}
