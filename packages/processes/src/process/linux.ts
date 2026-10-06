/** Capability 2 · Keep sight of unfinished runs. */
import { readFile } from "node:fs/promises";
import type { ProcessReading } from "./index.js";

function code(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function confirmAbsent(pid: number): "gone" | "unknown" {
  try {
    // Signal 0 delivers no signal. It distinguishes a vanished PID from hidepid/access restrictions.
    process.kill(pid, 0);
  } catch (error) {
    if (code(error) === "ESRCH") return "gone";
  }
  return "unknown";
}

export async function readLinuxProcess(
  pid: number,
  read: (file: string) => Promise<string> = (file) => readFile(file, "utf8"),
  absent: (pid: number) => "gone" | "unknown" = confirmAbsent,
): Promise<ProcessReading> {
  let boot: string;
  try {
    // Establish that procfs is available before interpreting a missing PID entry.
    boot = (await read("/proc/sys/kernel/random/boot_id")).trim();
    if (!boot) throw new Error("Empty boot identity");
  } catch (error) {
    return { state: "unknown", reason: `Cannot read the Linux boot identity: ${String(error)}` };
  }
  let stat: string;
  try {
    stat = await read(`/proc/${pid}/stat`);
  } catch (error) {
    if ((code(error) === "ENOENT" || code(error) === "ESRCH") && absent(pid) === "gone") return { state: "gone" };
    return { state: "unknown", reason: `Cannot read process ${pid}: ${String(error)}` };
  }
  // comm (field 2) may itself contain spaces and parentheses. starttime is field 22.
  // https://docs.kernel.org/filesystems/proc.html
  const end = stat.lastIndexOf(")");
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const started = fields[19];
  if (!stat.startsWith(`${pid} (`) || end < 0 || !started || !/^\d+$/.test(started) || !/^[RSDZTWtXxKPI]$/.test(fields[0] ?? "")) {
    return { state: "unknown", reason: `Malformed process identity for ${pid}` };
  }
  if (fields[0] === "Z" || fields[0] === "X" || fields[0] === "x") return { state: "gone" };
  return { state: "live", identity: { pid, platform: "linux", started, boot } };
}
