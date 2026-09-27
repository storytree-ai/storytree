import koffi from 'koffi';
import type { ProcessIdentity } from '../process/index.js';
import type { SignalResult, StopPhase } from './signal.js';

const libproc = koffi.load('/usr/lib/libproc.dylib');
const procPidinfo = libproc.func('int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)');
const signalToken = libproc.func('int proc_signal_with_audittoken(void *token, int sig)');

export function signalDarwin(identity: ProcessIdentity, phase: StopPhase): SignalResult {
  // XNU PROC_PIDT_BSDINFOWITHUNIQID (18): proc_bsdinfo[136] + proc_uniqidentifierinfo[56].
  // One retained process reference supplies both birth time and pidversion, unlike two PID reads.
  // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h
  const info = Buffer.alloc(192);
  if (procPidinfo(identity.pid, 18, 0, info, info.length) !== info.length) {
    return { status: 'unknown', reason: `Cannot bind macOS process identity (errno ${koffi.errno()})` };
  }
  const started = `${info.readBigUInt64LE(120)}.${info.readBigUInt64LE(128).toString().padStart(6, '0')}`;
  if (info.readUInt32LE(12) !== identity.pid || started !== identity.started) return { status: 'gone' };
  // proc_find_audit_token validates target PID (word 5) and pidversion (word 7), then applies
  // normal signalling permissions. A changed version (including exec) is refused by the kernel.
  const token = Buffer.alloc(32, 0xff);
  token.writeUInt32LE(identity.pid, 20);
  token.writeUInt32LE(info.readUInt32LE(168), 28);
  const error = signalToken(token, phase === 'polite' ? 15 : 9);
  return error === 0 ? { status: 'sent' } : { status: 'unknown', reason: `macOS lifetime-bound signal failed (errno ${error})` };
}
