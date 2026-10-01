/**
 * The page's one live reading (ADR-0836 D3): every surface on the page (the forest, the sessions
 * list, the knowledge core, the arc surface) hears the same news from one live reading, so the page
 * asks the library's changes and the agent log's lines once per tick, not once per surface.
 *
 * - It holds what it has read, so a surface that starts listening late (the arc surface opens when
 *   its drawer does) first hears everything held, without asking the library again.
 * - Each surface takes news at its own pace: one whose handling fails is told so, and hears that
 *   news again together with the next, while the others hear it once.
 * - It never writes.
 */
import { ASK_EVERY_MS, liveReading, pageTimers, type LiveReading, type LiveReads, type News, type Timers } from "./live-reading.js";

/** One surface's ears on the page reading. */
export interface NewsListener {
  /** Called with what is new to this surface; a returned promise that rejects hands the news back. */
  onNews(news: News): unknown;
  /** Called once a minute with the time. */
  onClock?(now: number): void;
  /** Called when a read, or this surface's handling of news, fails; the next ask tries again. */
  onError?(error: unknown): void;
}

export interface PageReading extends LiveReading {
  /** Start hearing news: the first is everything held so far, once the first read has landed. Returns a function that stops. */
  subscribe(listener: NewsListener): () => void;
}

export interface PageReadingOptions {
  project: string;
  reads: LiveReads;
  timers?: Timers;
}

interface Ears {
  listener: NewsListener;
  /** News this surface has not yet taken, oldest first. */
  owed: News | undefined;
  /** Whether it is taking news now. */
  busy: boolean;
  /** When news it failed to take is next offered again without new news. */
  retryAt: number;
}

const joined = (a: News | undefined, b: News): News => a === undefined ? b : { changes: [...a.changes, ...b.changes], lines: [...a.lines, ...b.lines] };

/** Start the page's one live reading of `project`. */
export function pageReading({ project, reads, timers }: PageReadingOptions): PageReading {
  const clock = timers ?? pageTimers;
  const everyone = new Set<Ears>();
  let held: News | undefined;
  let stopped = false;

  /** Hand `ears` what it is owed, unless it is still taking the last. */
  async function hand(ears: Ears): Promise<void> {
    if (ears.busy || ears.owed === undefined || stopped) return;
    const news = ears.owed;
    ears.owed = undefined;
    ears.busy = true;
    try {
      await ears.listener.onNews(news);
    } catch (error) {
      ears.owed = joined(news, ears.owed ?? { changes: [], lines: [] });
      ears.retryAt = clock.now() + ASK_EVERY_MS;
      if (!stopped) ears.listener.onError?.(error);
    } finally {
      ears.busy = false;
    }
  }

  const reading = liveReading({
    project,
    reads,
    ...(timers ? { timers } : {}),
    async onNews(news) {
      held = joined(held, news);
      await Promise.all([...everyone].map((ears) => {
        ears.owed = joined(ears.owed, news);
        return hand(ears);
      }));
    },
    onClock(now) {
      for (const { listener } of everyone) listener.onClock?.(now);
    },
    onError(error) {
      for (const { listener } of everyone) listener.onError?.(error);
    },
  });

  // A surface still owed news is offered it again at the next ask, even when nothing is new.
  const stopRetrying = clock.every(ASK_EVERY_MS, () => {
    for (const ears of everyone) if (clock.now() >= ears.retryAt) void hand(ears);
  });
  return {
    subscribe(listener) {
      const ears: Ears = { listener, owed: held, busy: false, retryAt: 0 };
      everyone.add(ears);
      void hand(ears);
      return () => { everyone.delete(ears); };
    },
    stop() {
      stopped = true;
      everyone.clear();
      stopRetrying();
      reading.stop();
    },
  };
}

/**
 * `reads` with its project tree read joined: a read asked while the same one is on the way gets that
 * one's answer, so the surfaces hearing one news share one read (ADR-0836 D3).
 */
export function joinedReads<T extends { projectTree(project: string): Promise<unknown> }>(reads: T): T {
  const going = new Map<string, Promise<unknown>>();
  const projectTree = (project: string): Promise<unknown> => {
    let read = going.get(project);
    if (read === undefined) {
      read = reads.projectTree(project).finally(() => going.delete(project));
      going.set(project, read);
    }
    return read;
  };
  return Object.assign(Object.create(reads) as T, { projectTree });
}
