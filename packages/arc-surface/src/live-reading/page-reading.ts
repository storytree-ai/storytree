/**
 * The page's one live reading (ADR-0836 D3): every surface on the page (the forest, the sessions
 * list, the knowledge core, the arc surface) hears the same news from one live reading, so the page
 * asks the library's changes and the agent log's lines once per tick, not once per surface.
 *
 * - It holds what it has read, so a surface that starts listening late (the arc surface opens when
 *   its drawer does) first hears everything held, without asking the library again. What it holds
 *   keeps only what a surface reads (ADR-0836 D4): the news each surface hears is whole, but the
 *   history held is thinned as it arrives, so the page never keeps the whole history in memory.
 * - Each surface takes news at its own pace: one whose handling fails is told so, and hears that
 *   news again together with the next, while the others hear it once.
 * - Given a kept reading (the page's storage, ADR-0836 D4), it keeps what it holds there, a piece at
 *   a time, and the next start hears the kept reading at once and asks the library only from where
 *   it got to. The first ask overlaps the kept reading by one change and one line, so a kept reading
 *   the library does not know (another library, a project made again) is dropped and read again
 *   from the start, and the reading converges either way (D5).
 * - It never writes to the library.
 */
import type { Line } from "@storytree/agent-link";
import type { Change } from "@storytree/library";

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
  /** Everything read so far, oldest first, thinned to what a surface reads; it grows as news comes. */
  held(): News;
}

/** The most of a running command's text a surface shows (the sessions list's title on its words). */
const COMMAND_SHOWN = 300;

/**
 * What is held of the history and the log, kept as news arrives. Every surface reads the history and
 * the log in order, so dropping is only of what no surface reads:
 * - a health change other than a reported one (verified health is not drawn, ADR-0630), and a
 *   reported state the same as that contract's last held one (the drill-down's trail shows each
 *   change of state once), each held with only its node, column and state;
 * - a finished command's text, and a running command's text past what the sessions list shows.
 */
class Held {
  readonly changes: Change[] = [];
  readonly lines: Line[] = [];
  #reported = new Map<string, unknown>();

  /** Hold what is new, and say what of it was held. */
  add({ changes, lines }: News): News {
    const added: News = { changes: [], lines: [] };
    for (const change of changes) {
      if (change.type !== "health") { added.changes.push(change); continue; }
      const { node, column, state } = change.record.fields as { node?: unknown; column?: unknown; state?: unknown };
      if (change.action === "retired" || column !== "reported" || typeof node !== "string" || this.#reported.get(node) === state) continue;
      this.#reported.set(node, state);
      added.changes.push({ ...change, record: { ...change.record, fields: { node, column, state } } });
    }
    for (const line of lines) {
      if (line.kind === "command-run") added.lines.push({ ...line, command: "" });
      else if (line.kind === "command-started" && line.command.length > COMMAND_SHOWN) added.lines.push({ ...line, command: `${line.command.slice(0, COMMAND_SHOWN)} …` });
      else added.lines.push(line);
    }
    this.changes.push(...added.changes);
    this.lines.push(...added.lines);
    return added;
  }
}

/** Where a page reading is kept between starts: pieces added in order, read back as one. */
export interface KeptReading {
  /** Everything kept, oldest first, or undefined when nothing is. */
  read(): Promise<News | undefined>;
  /** Keep this piece after what is kept. */
  add(news: News): Promise<void>;
  /** Keep nothing. */
  clear(): Promise<void>;
}

export interface PageReadingOptions {
  project: string;
  reads: LiveReads;
  timers?: Timers;
  /** Where to keep the reading between starts; without it every start reads from the start. */
  kept?: KeptReading;
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
export function pageReading({ project, reads, timers, kept }: PageReadingOptions): PageReading {
  const clock = timers ?? pageTimers;
  const everyone = new Set<Ears>();
  const held = new Held();
  let read = false;
  let stopped = false;
  let reading: LiveReading | undefined;

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

  /** Hold `news`, keep what was held, and hand it on; `whole` is what surfaces hear. */
  async function heard(news: News, whole: News = news): Promise<void> {
    if (read && whole.changes.length === 0 && whole.lines.length === 0) return;
    const added = held.add(news);
    read = true;
    if (kept !== undefined && (added.changes.length > 0 || added.lines.length > 0)) kept.add(added).catch(() => { /* This start still holds it. */ });
    await Promise.all([...everyone].map((ears) => {
      ears.owed = joined(ears.owed, whole);
      return hand(ears);
    }));
  }

  const failed = (error: unknown): void => {
    if (!stopped) for (const { listener } of everyone) listener.onError?.(error);
  };

  function live(from?: { changes: number; lines: number }): void {
    if (stopped) return;
    reading = liveReading({
      project,
      reads,
      ...(timers ? { timers } : {}),
      ...(from ? { from } : {}),
      onNews: (news) => heard(news),
      onClock(now) {
        for (const { listener } of everyone) listener.onClock?.(now);
      },
      onError: failed,
    });
  }

  /**
   * Start from the kept reading: ask from one change and one line before where it got to, and hear
   * it with what is new when the library still knows where it got to; drop it otherwise. A failed
   * ask is tried again at the next.
   */
  async function resume(): Promise<void> {
    const last = await kept!.read().catch(() => undefined);
    if (stopped) return;
    if (last === undefined || (last.changes.length === 0 && last.lines.length === 0)) return live();
    const change = last.changes.at(-1);
    const line = last.lines.at(-1);
    const from = { changes: Math.max(0, (change?.seq ?? 0) - 1), lines: Math.max(0, (line?.seq ?? 0) - 1) };
    let trying = false;
    const attempt = async (): Promise<boolean> => {
      if (trying || stopped) return stopped;
      trying = true;
      try {
        const [changes, lines] = await Promise.all([reads.changesSince(project, from.changes), reads.linesSince(project, from.lines)]);
        if (stopped) return true;
        const knows = (change === undefined || (changes.changes[0]?.seq === change.seq && changes.changes[0].recordId === change.recordId))
          && (line === undefined || (lines.lines[0]?.seq === line.seq && lines.lines[0].session === line.session && lines.lines[0].kind === line.kind));
        if (!knows) {
          await kept!.clear().catch(() => {});
          live();
          return true;
        }
        held.add(last);
        const news = { changes: changes.changes.filter(({ seq }) => seq > (change?.seq ?? 0)), lines: lines.lines.filter(({ seq }) => seq > (line?.seq ?? 0)) };
        await heard(news, { changes: [...held.changes, ...news.changes], lines: [...held.lines, ...news.lines] });
        live({ changes: changes.cursor, lines: lines.cursor });
        return true;
      } catch (error) {
        failed(error);
        return false;
      } finally {
        trying = false;
      }
    };
    if (await attempt()) return;
    const stopTrying = clock.every(ASK_EVERY_MS, () => void attempt().then((done) => { if (done) stopTrying(); }));
  }

  if (kept === undefined) live();
  else void resume();

  // A surface still owed news is offered it again at the next ask, even when nothing is new.
  const stopRetrying = clock.every(ASK_EVERY_MS, () => {
    for (const ears of everyone) if (clock.now() >= ears.retryAt) void hand(ears);
  });
  return {
    subscribe(listener) {
      const ears: Ears = { listener, owed: read ? { changes: [...held.changes], lines: [...held.lines] } : undefined, busy: false, retryAt: 0 };
      everyone.add(ears);
      void hand(ears);
      return () => { everyone.delete(ears); };
    },
    held: () => held,
    stop() {
      stopped = true;
      everyone.clear();
      stopRetrying();
      reading?.stop();
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
