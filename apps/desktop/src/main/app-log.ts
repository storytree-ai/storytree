// Capability 9 · Errors and app.log
import { appendFileSync, renameSync, statSync } from "node:fs";
import { format } from "node:util";

const CAP_BYTES = 1_000_000;

export interface AppLog {
  write(text: string): void;
}

export function appLog(file: string, { capBytes = CAP_BYTES }: { capBytes?: number } = {}): AppLog {
  return {
    write(text) {
      const line = `${new Date().toISOString()} ${text}\n`;
      try {
        if (size(file) + Buffer.byteLength(line) > capBytes) renameSync(file, `${file}.1`);
        appendFileSync(file, line);
      } catch {
      }
    },
  };
}

export function teeConsole(target: Pick<Console, "log" | "error">, log: AppLog): void {
  for (const level of ["log", "error"] as const) {
    const say = target[level].bind(target);
    target[level] = (...parts: unknown[]) => {
      say(...parts);
      log.write(format(...parts));
    };
  }
}

function size(file: string): number {
  try { return statSync(file).size; } catch { return 0; }
}
