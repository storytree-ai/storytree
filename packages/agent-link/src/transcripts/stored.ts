/**
 * Readings parsed from the shared log (ADR-0749 D3, D4): a session's context reading and window,
 * worked out by our own folds from the transcript records its hooks streamed in, so an app on any
 * machine reads every machine's sessions without opening a transcript file. Raw records expire
 * after RETAIN_MS; before they go, what was worked out from them is kept, and read from then on.
 */
import type { ActivityLog, Line } from "../activity/index.js";
import { contextReading, type ContextReading, type TranscriptReader } from "../context/context.js";
import { sessionWindow, type SessionWindow } from "../context/window.js";

/** How long raw transcript records are kept: 180 days (D4). */
export const RETAIN_MS = 180 * 24 * 60 * 60 * 1000;

/** What is kept of a session once its raw records expire. */
interface Kept {
  readonly context: ContextReading;
  readonly window: SessionWindow;
}

/** A reader of `session`'s own transcript as stored in `project`'s log. */
function storedReader(log: ActivityLog, project: string, session: string): TranscriptReader {
  return () => log.transcripts.text(project, session);
}

/** `session`'s context reading, parsed from its stored records; what was kept, once they expired. */
export async function storedContextReading(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, home }: { now?: Date; home?: string } = {}): Promise<ContextReading> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) return kept.context;
  return contextReading(lines, session, { ...(now === undefined ? {} : { now }), ...(home === undefined ? {} : { home }), read: storedReader(log, project, session) });
}

/** `session`'s window, parsed from its stored records; what was kept, once they expired. */
export async function storedSessionWindow(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now }: { now?: Date } = {}): Promise<SessionWindow> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) return kept.window;
  return sessionWindow(lines, session, { ...(now === undefined ? {} : { now }), read: storedReader(log, project, session) });
}

/**
 * The retention pass: for each session with a record stored more than RETAIN_MS before `now`, keep
 * its readings worked out from all it has stored, then delete every record past the limit.
 * Returns how many records went.
 */
export async function pruneTranscripts(log: ActivityLog, { now = new Date(), home }: { now?: Date; home?: string } = {}): Promise<number> {
  const before = new Date(now.getTime() - RETAIN_MS);
  const lines = new Map<string, readonly Line[]>();
  for (const { project, session } of await log.transcripts.storedBefore(before)) {
    if ((await log.transcripts.kept(project, session)) !== undefined) continue;
    if (!lines.has(project)) lines.set(project, (await log.since(project, 0)).lines);
    const own = lines.get(project)!;
    const read = storedReader(log, project, session);
    const kept: Kept = {
      context: await contextReading(own, session, { now, ...(home === undefined ? {} : { home }), read }),
      window: await sessionWindow(own, session, { now, read }),
    };
    await log.transcripts.keep(project, session, kept);
  }
  return log.transcripts.deleteBefore(before);
}
