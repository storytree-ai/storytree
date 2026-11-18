// Capability 13 · Keep sight of unfinished runs
import koffi from "koffi";
import type { ProcessReading } from "./index.js";

const kernel = koffi.load("kernel32.dll");
const openProcess = kernel.func("void * __stdcall OpenProcess(uint32_t desiredAccess, int inheritHandle, uint32_t processId)");
const closeHandle = kernel.func("int __stdcall CloseHandle(void *handle)");
const getLastError = kernel.func("uint32_t __stdcall GetLastError()");
const getProcessTimes = kernel.func("int __stdcall GetProcessTimes(void *handle, void *created, void *exited, void *kernelTime, void *userTime)");
const waitForSingleObject = kernel.func("uint32_t __stdcall WaitForSingleObject(void *handle, uint32_t milliseconds)");

export function readWindowsProcess(pid: number): ProcessReading {
  const handle = openProcess(0x00101000, 0, pid);
  if (!handle) {
    const error = getLastError();
    return error === 87
      ? { state: "gone" }
      : { state: "unknown", reason: `OpenProcess(${pid}) failed (Windows error ${error})` };
  }
  try {
    const created = Buffer.alloc(8);
    if (!getProcessTimes(handle, created, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8))) {
      return { state: "unknown", reason: `GetProcessTimes(${pid}) failed (Windows error ${getLastError()})` };
    }
    const status = waitForSingleObject(handle, 0);
    if (status === 0) return { state: "gone" };
    if (status !== 258) return { state: "unknown", reason: `Process state could not be read (Windows error ${getLastError()})` };
    const started = created.readBigUInt64LE();
    if (started === 0n) return { state: "unknown", reason: "Empty native process creation time" };
    return { state: "live", identity: { pid, platform: "win32", started: started.toString(), boot: "windows-filetime-1601" } };
  } finally {
    closeHandle(handle);
  }
}
