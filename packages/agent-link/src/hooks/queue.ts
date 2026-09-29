/**
 * Lines a hook could not deliver (ADR-0749's consequence: losing a line matters once everything reads
 * from the shared log). While storytree cannot be reached (the app stopped, the machine offline, the
 * store restarting), a hook writes its lines here, under the storytree home, each with the time and
 * machine it was written at. The next hook that reaches the log uploads every waiting line before
 * its own, oldest first, at its own time; an upload tried twice, by two hooks at once or after a
 * crash, adds each line once (ActivityLog.append's `once`).
 *
 * Each hook's lines are one file, written whole and then renamed into place, so a reader never sees
 * half of one; the file name starts with the time, so the files sort oldest first.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import type { ActivityLog, NewLine } from "../activity/index.js";

/** One waiting line: the project it is for, and when it was written. */
interface Queued {
  readonly project: string;
  readonly at: string;
  readonly line: NewLine;
}

/** Where lines wait, under the storytree home `home`. */
export function queueFolder(home: string): string {
  return path.join(home, "queued-lines");
}

/** Keep `lines` for `project`, written now on this machine, until a hook reaches the log. */
export function enqueue(home: string, project: string, lines: readonly NewLine[]): void {
  if (lines.length === 0) return;
  const folder = queueFolder(home);
  mkdirSync(folder, { recursive: true });
  const at = new Date();
  const machine = hostname().trim() || undefined;
  const text = lines.map((line): string => JSON.stringify({ project, at: at.toISOString(),
    line: line.machine !== undefined || machine === undefined ? line : { ...line, machine } } satisfies Queued)).join("\n");
  const name = `${String(at.getTime()).padStart(15, "0")}-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(path.join(folder, `${name}.part`), `${text}\n`);
  renameSync(path.join(folder, `${name}.part`), path.join(folder, `${name}.jsonl`));
}

/**
 * Upload every waiting line to `log`, oldest first, each once, and forget each file once all its
 * lines are in. A file that cannot be read as lines is set aside (renamed `.unreadable`), never
 * retried for ever. Stops at the first failure, leaving the rest for the next hook.
 */
export async function uploadQueued(home: string, log: ActivityLog): Promise<void> {
  const folder = queueFolder(home);
  let names: string[];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(folder, name);
    let waiting: Queued[];
    try {
      waiting = readFileSync(file, "utf8").split("\n").filter((text) => text.trim() !== "").map((text) => JSON.parse(text) as Queued);
    } catch (error) {
      // Another hook uploaded and removed it first: nothing is lost.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      renameSync(file, `${file}.unreadable`);
      continue;
    }
    for (const { project, at, line } of waiting) await log.append(project, line, { at, once: true });
    rmSync(file, { force: true });
  }
}
