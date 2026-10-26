/**
 * Capability 11 · Machines: this machine's health, on Linux and Windows. It reads when the machine booted, the memory
 * it has available, its load (the 15-minute load average on Linux, the processor queue on Windows) and how full its
 * system disk is, and reads each against the limits in settings: past one is a concern. Each platform's readings are
 * taken from what it hands over (its files, numbers and command output), so a test hands over its own.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statfsSync } from "node:fs";
import { freemem, hostname, loadavg, totalmem, uptime } from "node:os";

const GB = 1024 ** 3;

/** The system disk as statfs reports it: its block size, and its blocks in all, free, and available to a user. */
export interface DiskBlocks {
  readonly bsize: number;
  readonly blocks: number;
  readonly bfree: number;
  readonly bavail: number;
}

/** What Linux hands over: /proc/meminfo's text, the seconds since boot, the load averages and the root disk's blocks. */
export interface LinuxSources {
  readonly now: Date;
  readonly uptimeSeconds: number;
  readonly meminfo: string;
  readonly loadavg: readonly number[];
  readonly disk: () => DiskBlocks;
}

/** What Windows hands over: the memory free and in all, the seconds since boot, the processor queue's output and the system drive's blocks. */
export interface WindowsSources {
  readonly now: Date;
  readonly uptimeSeconds: number;
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly queue: () => string;
  readonly drive: string;
  readonly disk: () => DiskBlocks;
}

/** One machine's readings; a reading that could not be taken is absent, and why is in `unread`. */
export interface MachineReadings {
  readonly platform: "Linux" | "Windows";
  readonly bootedAt: Date;
  readonly memory?: { readonly availableGB: number; readonly totalGB: number };
  readonly load?: { readonly value: number; readonly what: "15-minute load" | "processor queue" };
  readonly disk?: { readonly path: string; readonly fullPercent: number; readonly freeGB: number; readonly sizeGB: number };
  readonly unread: readonly string[];
}

/** The limits a machine is read against, as settings keep them: memory available in GB, load, and disk full in percent. */
export interface HealthLimits {
  readonly memoryGB: number;
  readonly load: number;
  readonly diskPercent: number;
}

/** The Linux readings, from what Linux hands over. */
export function linuxReadings(sources: LinuxSources): MachineReadings {
  const unread: string[] = [];
  const kb = (field: string) => {
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, "m").exec(sources.meminfo);
    return match === null ? undefined : Number(match[1]) * 1024;
  };
  const available = kb("MemAvailable");
  const total = kb("MemTotal");
  if (available === undefined || total === undefined) unread.push("memory: /proc/meminfo gives no MemAvailable and MemTotal");
  const load = sources.loadavg[2];
  if (load === undefined || !Number.isFinite(load)) unread.push("load: no 15-minute load average");
  return {
    platform: "Linux",
    bootedAt: bootedAt(sources),
    ...(available === undefined || total === undefined ? {} : { memory: { availableGB: available / GB, totalGB: total / GB } }),
    ...(load === undefined || !Number.isFinite(load) ? {} : { load: { value: load, what: "15-minute load" as const } }),
    ...diskOf("/", sources.disk, unread),
    unread,
  };
}

/** The Windows readings, from what Windows hands over. */
export function windowsReadings(sources: WindowsSources): MachineReadings {
  const unread: string[] = [];
  let queue: number | undefined;
  try {
    const said = sources.queue().trim();
    if (/^\d+$/.test(said)) queue = Number(said);
    else unread.push(`processor queue: PowerShell said ${JSON.stringify(said)}, not a number`);
  } catch (error) {
    unread.push(`processor queue: ${(error as Error).message.split("\n")[0]}`);
  }
  return {
    platform: "Windows",
    bootedAt: bootedAt(sources),
    memory: { availableGB: sources.freeBytes / GB, totalGB: sources.totalBytes / GB },
    ...(queue === undefined ? {} : { load: { value: queue, what: "processor queue" as const } }),
    ...diskOf(sources.drive, sources.disk, unread),
    unread,
  };
}

function bootedAt({ now, uptimeSeconds }: { now: Date; uptimeSeconds: number }): Date {
  return new Date(now.getTime() - uptimeSeconds * 1000);
}

/** How full the disk is as `df` says it: what is used, of what is used and what a user may still use. */
function diskOf(path: string, read: () => DiskBlocks, unread: string[]): Pick<MachineReadings, "disk"> {
  try {
    const { bsize, blocks, bfree, bavail } = read();
    const used = blocks - bfree;
    return { disk: { path, fullPercent: used + bavail === 0 ? 0 : (used / (used + bavail)) * 100, freeGB: (bavail * bsize) / GB, sizeGB: (blocks * bsize) / GB } };
  } catch (error) {
    unread.push(`disk ${path}: ${(error as Error).message.split("\n")[0]}`);
    return {};
  }
}

/** This machine's readings: Linux's or Windows'; any other platform is refused, as this reads only those two. */
export function thisMachine(now = new Date()): MachineReadings {
  if (process.platform === "linux") {
    return linuxReadings({ now, uptimeSeconds: uptime(), meminfo: readFileSync("/proc/meminfo", "utf8"), loadavg: loadavg(), disk: () => statfsSync("/") });
  }
  if (process.platform === "win32") {
    const drive = `${process.env.SystemDrive ?? "C:"}\\`;
    return windowsReadings({
      now,
      uptimeSeconds: uptime(),
      freeBytes: freemem(),
      totalBytes: totalmem(),
      queue: () => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_PerfFormattedData_PerfOS_System).ProcessorQueueLength"], { encoding: "utf8", timeout: 30_000, windowsHide: true }),
      drive,
      disk: () => statfsSync(drive),
    });
  }
  throw new Error(`machine health reads Linux and Windows, and this machine runs ${process.platform}`);
}

/** Each concern, worst kept first: a reading past its limit, or one that could not be taken. */
export function concernsOf(readings: MachineReadings, limits: HealthLimits): readonly string[] {
  const concerns: string[] = [];
  if (readings.memory !== undefined && readings.memory.availableGB < limits.memoryGB) {
    concerns.push(`memory: ${gb(readings.memory.availableGB)} available, under ${limits.memoryGB} GB`);
  }
  if (readings.load !== undefined && readings.load.value > limits.load) {
    concerns.push(`load: ${readings.load.what} ${number(readings.load.value)}, over ${limits.load}`);
  }
  if (readings.disk !== undefined && readings.disk.fullPercent > limits.diskPercent) {
    concerns.push(`disk: ${readings.disk.path} ${Math.round(readings.disk.fullPercent)}% full, over ${limits.diskPercent}%`);
  }
  return [...concerns, ...readings.unread.map((why) => `unread ${why}`)];
}

/** The health as the command line says it: the concerns first, then each reading. */
export function healthSaid(readings: MachineReadings, concerns: readonly string[], host = hostname()): string {
  const lines = concerns.length === 0
    ? [`No concerns on ${host}.`]
    : [`${concerns.length} concern${concerns.length === 1 ? "" : "s"} on ${host}:`, ...concerns.map((concern) => `  - ${concern}`)];
  const { memory, load, disk } = readings;
  return [
    ...lines,
    "",
    `${readings.platform}, up since ${readings.bootedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ...(memory === undefined ? [] : [`memory: ${gb(memory.availableGB)} available of ${gb(memory.totalGB)}`]),
    ...(load === undefined ? [] : [`load: ${load.what} ${number(load.value)}`]),
    ...(disk === undefined ? [] : [`disk: ${disk.path} ${Math.round(disk.fullPercent)}% full, ${gb(disk.freeGB)} free of ${gb(disk.sizeGB)}`]),
  ].join("\n");
}

function gb(value: number): string {
  return `${value.toFixed(1)} GB`;
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
