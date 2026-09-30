/**
 * What a reader that asks again and again (the app, every 10 seconds) already has of each project's
 * log, so each ask fetches only the lines added since, as the transcript cache does for a session's
 * stored records. The whole log is tens of thousands of lines, seconds to fetch from a remote library.
 */
import type { ActivityLog } from "./activity-log.js";
import type { Line, LinesSince } from "./lines.js";

/** Each project's lines read so far and the cursor after them. Asks take turns, so two at once read each line once; a held promise never rejects. */
export type LinesCache = Map<string, Promise<LinesSince>>;

/** Every one of `project`'s lines, oldest first: those in `cache`, and the log's lines since its cursor. */
export function cachedLines(log: ActivityLog, project: string, cache: LinesCache): Promise<readonly Line[]> {
  const had = cache.get(project) ?? Promise.resolve({ lines: [], cursor: 0 });
  const now = had.then(async ({ lines, cursor }) => {
    const added = await log.since(project, cursor);
    return { lines: added.lines.length === 0 ? lines : [...lines, ...added.lines], cursor: added.cursor };
  });
  // What is cached never fails: a failed fetch leaves what was had, for the next ask to fetch from.
  cache.set(project, now.catch(() => had));
  return now.then(({ lines }) => lines);
}
