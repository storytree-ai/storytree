// Capability 3 · Arc surface.
import type { Change, Changes, ChangesFilter, Line, LineKind, LinesSince } from "@storytree/library";
import type { LinesStart } from "@storytree/session-management";

export const ASK_EVERY_MS = 2_000;
export const CLOCK_EVERY_MS = 60_000;

export interface LiveReads {
  changesSince(project: string, cursor: number, filter?: ChangesFilter): Promise<Changes>;
  linesSince(project: string, cursor: number): Promise<LinesSince>;
  linesStart?(project: string, kinds: readonly LineKind[]): Promise<LinesStart>;
  sessionLines?(project: string, sessions: readonly string[]): Promise<Line[]>;
}

export interface News {
  changes: Change[];
  lines: Line[];
}

export interface Timers {
  now(): number;
  every(ms: number, run: () => void): () => void;
}

export interface LiveReadingOptions {
  project: string;
  reads: LiveReads;
  onNews(news: News): unknown;
  onClock(now: number): void;
  onError?(error: unknown): void;
  onAsked?(): void;
  timers?: Timers;
  from?: { changes: number; lines: number };
}

export interface LiveReading {
  stop(): void;
}

export const pageTimers: Timers = {
  now: () => Date.now(),
  every(ms, run) {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

export function liveReading({ project, reads, onNews, onClock, onError, onAsked, timers = pageTimers, from }: LiveReadingOptions): LiveReading {
  let changesCursor = from?.changes ?? 0;
  let linesCursor = from?.lines ?? 0;
  let first = from === undefined;
  let asking = false;
  let stopped = false;

  async function ask(): Promise<void> {
    if (asking || stopped) return;
    asking = true;
    try {
      const [changes, lines] = await Promise.all([reads.changesSince(project, changesCursor), reads.linesSince(project, linesCursor)]);
      if (stopped) return;
      if (first || changes.changes.length > 0 || lines.lines.length > 0) await onNews({ changes: changes.changes, lines: lines.lines });
      if (stopped) return;
      changesCursor = changes.cursor;
      linesCursor = lines.cursor;
      first = false;
      onAsked?.();
    } catch (error) {
      if (!stopped) onError?.(error);
    } finally {
      asking = false;
    }
  }

  const stopAsking = timers.every(ASK_EVERY_MS, () => void ask());
  const stopClock = timers.every(CLOCK_EVERY_MS, () => onClock(timers.now()));
  if (from === undefined) void ask();
  return {
    stop() {
      stopped = true;
      stopAsking();
      stopClock();
    },
  };
}
