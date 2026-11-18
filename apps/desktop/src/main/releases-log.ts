// Capability 4 · Updates
import { appendFileSync, renameSync, statSync } from "node:fs";
import { format } from "node:util";

import type { InstallChoice } from "@storytree/app";

const CAP_BYTES = 1_000_000;

interface Logger {
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  debug(...parts: unknown[]): void;
}

export function releasesLog(file: string, options: { echo?: (line: string) => void; capBytes?: number } = {}): Logger {
  const echo = options.echo ?? (line => console.log(line));
  const cap = options.capBytes ?? CAP_BYTES;
  const write = (keep: boolean) => (...parts: unknown[]): void => {
    const message = format(...parts);
    echo(`releases: ${message}`);
    if (!keep) return;
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      if (size(file) + Buffer.byteLength(line) > cap) renameSync(file, `${file}.1`);
      appendFileSync(file, line);
    } catch {}
  };
  return { info: write(true), warn: write(true), error: write(true), debug: write(false) };
}

function size(file: string): number {
  try { return statSync(file).size; } catch { return 0; }
}

export function waitingLine(choice: InstallChoice): string {
  if (choice.mode === "manual") return "downloaded; installs only when the user chooses (manual only), by Restart to update";
  const when = choice.mode === "hours" ? `inside quiet hours ${choice.from}–${choice.to}, at a quiet moment` : "for a quiet moment";
  return `downloaded; waiting ${when} (no seed writing, no one using the window or an agent working) or the user's say-so`;
}
