import koffi from 'koffi';
import type { ProcessIdentity } from '../process/index.js';
import type { SignalResult, StopPhase } from './signal.js';

const kernel = koffi.load('kernel32.dll');
const openProcess = kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)');
const closeHandle = kernel.func('int __stdcall CloseHandle(void *handle)');
const getLastError = kernel.func('uint32_t __stdcall GetLastError()');
const getTimes = kernel.func('int __stdcall GetProcessTimes(void *handle, void *created, void *exited, void *kernel, void *user)');
const wait = kernel.func('uint32_t __stdcall WaitForSingleObject(void *handle, uint32_t milliseconds)');
const terminate = kernel.func('int __stdcall TerminateProcess(void *handle, unsigned int exitCode)');
const user = koffi.load('user32.dll');
const windowCallback = koffi.proto('int __stdcall OwnStopEnumWindow(void *window, intptr_t parameter)');
const enumWindows = user.func('int __stdcall EnumWindows(OwnStopEnumWindow *callback, intptr_t parameter)');
const windowPid = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *pid)');
const postMessage = user.func('int __stdcall PostMessageW(void *window, uint32_t message, uintptr_t wparam, intptr_t lparam)');

export function signalWindows(identity: ProcessIdentity, phase: StopPhase): SignalResult {
  // The same handle is compared and terminated. Never taskkill /T or a PID-based force fallback.
  const handle = openProcess(0x00101000 | (phase === 'force' ? 1 : 0), 0, identity.pid);
  if (!handle) return { status: 'unknown', reason: `OpenProcess for stop failed (Windows error ${getLastError()})` };
  try {
    const created = Buffer.alloc(8);
    if (!getTimes(handle, created, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8))) {
      return { status: 'unknown', reason: `Cannot bind process creation time (Windows error ${getLastError()})` };
    }
    if (identity.boot !== 'windows-filetime-1601' || created.readBigUInt64LE().toString() !== identity.started) return { status: 'gone' };
    const state = wait(handle, 0);
    if (state === 0) return { status: 'gone' };
    if (state !== 258) return { status: 'unknown', reason: `Cannot read process handle state (Windows error ${getLastError()})` };
    if (phase === 'force') return terminate(handle, 1) ? { status: 'sent' } :
      { status: 'unknown', reason: `TerminateProcess failed (Windows error ${getLastError()})` };
    // Detached console processes have no targeted polite channel. WM_CLOSE is cooperative for
    // windows belonging to this process; do not broadcast console events to unrelated work.
    let sent = 0;
    let failed = false;
    const enumerated = enumWindows((window: unknown) => {
      const pid = [0];
      windowPid(window, pid);
      if (pid[0] === identity.pid && wait(handle, 0) === 258) {
        if (postMessage(window, 0x0010 /* WM_CLOSE */, 0, 0)) sent++;
        else failed = true;
      }
      return 1;
    }, 0);
    if (!enumerated || failed) return { status: 'unknown', reason: `Window close request failed (Windows error ${getLastError()})` };
    return sent > 0 ? { status: 'sent' } : { status: 'unsupported', reason: 'No owned top-level window accepts a polite close; detached console work needs bounded force' };
  } finally { closeHandle(handle); }
}
