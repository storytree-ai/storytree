/**
 * Capability 1 · Lifecycle. The app's own start-timing marks (contract 1.33): each start appends, to app.log in the app's home,
 * how long after launch it reached each point (app ready, library open, window shown, and the page's: the kept reading's
 * read-back and each surface's first fresh draw), so a cold start is timed by reading the log, with no debugger attach.
 */
import type { AppLog } from "./app-log.js";

export interface StartMarks {
  /** Write `name`'s mark, at `at` (milliseconds since the epoch, by default now), unless this start already wrote it. */
  mark(name: string, at?: number): void;
}

/** When this process was launched, in milliseconds since the epoch. */
export function processLaunchedAt(): number {
  return Date.now() - process.uptime() * 1000;
}

/** Marks for a start launched at `launchedAt`, each written once to `log` as "start mark: <name> +<ms> ms". */
export function startMarks({ launchedAt, log, now = Date.now }: { launchedAt: number; log: AppLog; now?: () => number }): StartMarks {
  const written = new Set<string>();
  return {
    mark(name, at = now()) {
      if (written.has(name)) return;
      written.add(name);
      log.write(`start mark: ${name} +${Math.round(at - launchedAt)} ms`);
    },
  };
}

/** Answer the page's marks (bridge.ts's startMark, a name and when it was reached) on `channel`; anything else is ignored. */
export function answerStartMarks(ipc: { handle(channel: string, answer: (event: unknown, ...args: unknown[]) => void): void }, channel: string, marks: StartMarks): void {
  ipc.handle(channel, (_event, name, at) => {
    if (typeof name === "string" && typeof at === "number" && Number.isFinite(at)) marks.mark(name, at);
  });
}
