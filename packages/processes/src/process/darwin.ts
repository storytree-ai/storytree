/** Capability 2 · Keep sight of unfinished runs. */
import koffi from "koffi";
import type { ProcessReading } from "./index.js";

const libproc = koffi.load("/usr/lib/libproc.dylib");
const libsystem = koffi.load("/usr/lib/libSystem.B.dylib");
const procPidinfo = libproc.func("int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)");
const sysctlbyname = libsystem.func("int sysctlbyname(const char *name, void *oldp, _Inout_ size_t *oldlenp, const void *newp, size_t newlen)");

export function readDarwinProcess(pid: number): ProcessReading {
  // Public proc_bsdinfo ABI: 12 uint32s, char[16], char[32], 6 uint32s, then two uint64s.
  // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
  const info = Buffer.alloc(136);
  koffi.errno(0);
  const size = procPidinfo(pid, 3 /* PROC_PIDTBSDINFO */, 0, info, info.length);
  if (size !== info.length) {
    const error = koffi.errno();
    return size === 0 && error === 3 /* ESRCH */
      ? { state: "gone" }
      : { state: "unknown", reason: `proc_pidinfo(${pid}) returned ${size} bytes (errno ${error})` };
  }
  if (info.readUInt32LE(12) !== pid) return { state: "unknown", reason: "Native process identity did not match the requested PID" };
  if (info.readUInt32LE(4) === 5 /* SZOMB */) return { state: "gone" };
  const seconds = info.readBigUInt64LE(120);
  const microseconds = info.readBigUInt64LE(128);
  if (seconds === 0n || microseconds >= 1_000_000n) return { state: "unknown", reason: "Invalid native process start time" };
  const bootBuffer = Buffer.alloc(128);
  const bootSize = [bootBuffer.length];
  if (sysctlbyname("kern.bootsessionuuid", bootBuffer, bootSize, null, 0) !== 0) {
    return { state: "unknown", reason: `Cannot read macOS boot identity (errno ${koffi.errno()})` };
  }
  const boot = bootBuffer.toString("utf8").split("\0", 1)[0]?.trim();
  if (!boot) return { state: "unknown", reason: "Empty macOS boot identity" };
  return { state: "live", identity: { pid, platform: "darwin", started: `${seconds}.${microseconds.toString().padStart(6, "0")}`, boot } };
}
