/**
 * The live reading (part of capability 3 · Arc surface, the arc surface story): what keeps the
 * overlay and the forest current while they are open. The forest uses it (ADR-0632 D3), and the app
 * only carries its two reads (ADR-0634 D3).
 *
 * - It reads everything at once, then about every two seconds asks the library's changes and the
 *   agent log's lines since where it got to, each read carrying its own cursor forward, and hands on
 *   what is new. Nothing new is not news.
 * - Once a minute it re-reads the clock and says so, even when nothing is new, so an agent that goes
 *   quiet turns idle without any new record.
 * - A read that fails is reported, and the next ask tries again from the same place. One ask runs
 *   at a time: a tick that comes while one is still on the way is skipped.
 * - It never writes.
 *
 * Its clock and timers are handed in (the page's own by default), so it is tested with a stand-in.
 */
import type { Line, LinesSince } from "@storytree/agent-link";
import type { Change, Changes } from "@storytree/library";

/** How often it asks what changed. */
export const ASK_EVERY_MS = 2_000;
/** How often it re-reads the clock. */
export const CLOCK_EVERY_MS = 60_000;

/** The two reads the app carries for the page (ADR-0634 D3): `window.storytree`'s. */
export interface LiveReads {
  changesSince(project: string, cursor: number): Promise<Changes>;
  linesSince(project: string, cursor: number): Promise<LinesSince>;
}

/** What is new since the last news: the library's changes and the agent log's lines, oldest first. */
export interface News {
  changes: Change[];
  lines: Line[];
}

/** The clock and timers the reading runs on: the page's own by default, a stand-in in tests. */
export interface Timers {
  now(): number;
  /** Run `run` every `ms` until the returned function is called. */
  every(ms: number, run: () => void): () => void;
}

export interface LiveReadingOptions {
  /** The project on show. */
  project: string;
  reads: LiveReads;
  /** Called with what is new. A returned promise is awaited before advancing either cursor. */
  onNews(news: News): unknown;
  /** Called once a minute with the time, so quiet time can pass without a record. */
  onClock(now: number): void;
  /** Called when a read fails; the next ask tries again. */
  onError?(error: unknown): void;
  /** Called after every ask that read, whether or not anything was new. */
  onAsked?(): void;
  timers?: Timers;
  /** Where to start reading from, just read by the caller: the first ask waits for the first tick. By default, the start, read at once. */
  from?: { changes: number; lines: number };
}

export interface LiveReading {
  /** Stop asking. */
  stop(): void;
}

/** The page's own clock and timers. */
export const pageTimers: Timers = {
  now: () => Date.now(),
  every(ms, run) {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

/** Start reading `project` live. The first read starts at once, unless it starts `from` where the caller has just read. */
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
