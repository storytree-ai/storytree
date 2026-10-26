/**
 * Capability 1 · Lifecycle. The app's own log: app.log in its home, where everything the app says is kept so it can be
 * read after the fact, including by an installed app started with no terminal (contract 1.34). It stays bounded the way
 * releases.log is (4.19): past its cap it moves to `app.log.1`, replacing the one before, and starts again.
 */
import { appendFileSync, renameSync, statSync } from "node:fs";
import { format } from "node:util";

/** A few months of starts, marks and errors fit in one file, and two files are all a machine ever keeps. */
const CAP_BYTES = 1_000_000;

export interface AppLog {
  /** Append `text` to the log as one entry, stamped with the time; a log that cannot be written never stops the app. */
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
        // a log that cannot be written must never stop the app
      }
    },
  };
}

/** Also write everything `target` logs or errors to `log`, after it is said as before. */
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
