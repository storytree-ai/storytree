// Capability 1 · Lifecycle
import type { AppLog } from "./app-log.js";

export interface StartMarks {
  mark(name: string, at?: number): void;
}

export function processLaunchedAt(): number {
  return Date.now() - process.uptime() * 1000;
}

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

export function answerStartMarks(ipc: { handle(channel: string, answer: (event: unknown, ...args: unknown[]) => void): void }, channel: string, marks: StartMarks): void {
  ipc.handle(channel, (_event, name, at) => {
    if (typeof name === "string" && typeof at === "number" && Number.isFinite(at)) marks.mark(name, at);
  });
}
