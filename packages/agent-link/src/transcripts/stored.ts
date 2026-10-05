/**
 * Readings parsed from the shared log (ADR-0749 D3, D4): a session's context reading and window,
 * worked out by our own folds from the transcript records its hooks streamed in, so an app on any
 * machine reads every machine's sessions without opening a transcript file. Raw records expire
 * after RETAIN_MS; before they go, what was worked out from them is kept, and read from then on.
 */
import type { ActivityLog, Line } from "../activity/index.js";
import { contextReading, transcriptLines, type ContextReading, type TranscriptReader } from "../context/context.js";
import { sessionWindow, type SessionWindow } from "../context/window.js";

/** How long raw transcript records are kept: 180 days (D4). */
export const RETAIN_MS = 180 * 24 * 60 * 60 * 1000;

/** What is kept of a session once its raw records expire. */
interface Kept {
  readonly context: ContextReading;
  readonly window: SessionWindow;
}

/**
 * What a reader that asks again and again (the app, every 10 seconds) already has of each session's
 * stored transcript, so each ask fetches only the records stored since.
 */
export type TranscriptCache = Map<string, { records: string[]; finish: number }>;

/** A reader of `session`'s own transcript as stored in `project`'s log, through `cache` when given. */
function storedReader(log: ActivityLog, project: string, session: string, cache?: TranscriptCache): TranscriptReader {
  if (cache === undefined) return () => log.transcripts.text(project, session);
  return async () => {
    const key = `${project}\0${session}`;
    const had = cache.get(key) ?? { records: [], finish: 0 };
    const added = await log.transcripts.since(project, session, had.finish);
    const now = { records: [...had.records, ...added.records], finish: added.finish };
    cache.set(key, now);
    return now.records.length === 0 ? undefined : now.records.join("\n");
  };
}

interface StoredOptions {
  readonly now?: Date;
  readonly home?: string;
  readonly cache?: TranscriptCache;
}

/** `session`'s context reading, parsed from its stored records; what was kept, once they expired. */
export async function storedContextReading(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, home, cache }: StoredOptions = {}): Promise<ContextReading> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) return kept.context;
  return contextReading(lines, session, { ...(now === undefined ? {} : { now }), ...(home === undefined ? {} : { home }), read: storedReader(log, project, session, cache) });
}

/** `session`'s window, parsed from its stored records; what was kept, once they expired. */
export async function storedSessionWindow(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, cache }: StoredOptions = {}): Promise<SessionWindow> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) return kept.window;
  return sessionWindow(lines, session, { ...(now === undefined ? {} : { now }), read: storedReader(log, project, session, cache) });
}

/**
 * The retention pass: for each session with a record stored more than RETAIN_MS before `now`, keep
 * its readings worked out from all it has stored, then delete every record past the limit.
 * Returns how many records went.
 */
export async function pruneTranscripts(log: ActivityLog, { now = new Date(), home }: { now?: Date; home?: string } = {}): Promise<number> {
  const before = new Date(now.getTime() - RETAIN_MS);
  for (const { project, session } of await log.transcripts.storedBefore(before)) {
    if ((await log.transcripts.kept(project, session)) !== undefined) continue;
    const own = await transcriptLines(log, project, session);
    const read = storedReader(log, project, session);
    const kept: Kept = {
      context: await contextReading(own, session, { now, ...(home === undefined ? {} : { home }), read }),
      window: await sessionWindow(own, session, { now, read }),
    };
    await log.transcripts.keep(project, session, kept);
  }
  return log.transcripts.deleteBefore(before);
}
