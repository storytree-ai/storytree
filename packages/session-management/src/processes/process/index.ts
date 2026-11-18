// Capability 13 · Keep sight of unfinished runs
import { readLinuxProcess } from "./linux.js";

export interface ProcessIdentity {
  pid: number;
  platform: NodeJS.Platform;
  started: string;
  boot: string;
}

export type ProcessReading =
  | { state: "live"; identity: ProcessIdentity }
  | { state: "gone" }
  | { state: "unknown"; reason: string };

export async function readProcess(pid: number): Promise<ProcessReading> {
  const maxPid = process.platform === "win32" ? 0xffffffff : 0x7fffffff;
  if (!Number.isInteger(pid) || pid <= 0 || pid > maxPid) return { state: "unknown", reason: "Invalid process identifier" };
  try {
    switch (process.platform) {
      case "linux": return await readLinuxProcess(pid);
      case "darwin": return (await import("./darwin.js")).readDarwinProcess(pid);
      case "win32": return (await import("./windows.js")).readWindowsProcess(pid);
      default: return { state: "unknown", reason: `Process observation is unavailable on ${process.platform}` };
    }
  } catch (error) {
    return { state: "unknown", reason: `Native process observation failed: ${String(error)}` };
  }
}

export async function probeProcess(identity: ProcessIdentity): Promise<ProcessReading> {
  if (identity.platform !== process.platform) return { state: "unknown", reason: "The recorded process belongs to another platform" };
  if (!identity.started || !identity.boot) return { state: "unknown", reason: "The recorded process has incomplete lifetime evidence" };
  const reading = await readProcess(identity.pid);
  if (reading.state !== "live") return reading;
  return reading.identity.started === identity.started && reading.identity.boot === identity.boot
    ? reading
    : { state: "gone" };
}
