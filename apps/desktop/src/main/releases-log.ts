/** Capability 4 · Updates, contract 4.19: the installed app's releases.log stays readable and bounded. */
import { appendFileSync, renameSync, statSync } from "node:fs";
import { format } from "node:util";

import type { InstallChoice } from "@storytree/app";

/** About a year of three-minute checks, and a downloaded release's lines, fit in one file. */
const CAP_BYTES = 1_000_000;

interface Logger {
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  debug(...parts: unknown[]): void;
}

/**
 * The updater's logger. Info, warnings and errors go to the file a person reads; debug, where
 * electron-updater dumps each differential download's blockmap plan and duplicated blocks, only to
 * the console. Past the cap the file moves to `<file>.1`, replacing the one before, and starts again.
 */
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
    } catch { /* logging cannot stop the app */ }
  };
  return { info: write(true), warn: write(true), error: write(true), debug: write(false) };
}

function size(file: string): number {
  try { return statSync(file).size; } catch { return 0; }
}

/** What holds a downloaded release, by the user's install choice (4.13). */
export function waitingLine(choice: InstallChoice): string {
  if (choice.mode === "manual") return "downloaded; installs only when the user chooses (manual only), by Restart to update";
  const when = choice.mode === "hours" ? `inside quiet hours ${choice.from}–${choice.to}, at a quiet moment` : "for a quiet moment";
  return `downloaded; waiting ${when} (no seed writing, no one using the window or an agent working) or the user's say-so`;
}
