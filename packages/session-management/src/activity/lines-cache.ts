// Capability 2 · Agent activity log
import type { ActivityLog } from "./activity-log.js";
import type { Line, LinesSince } from "@storytree/library";

export type LinesCache = Map<string, Promise<LinesSince>>;

export function cachedLines(log: ActivityLog, project: string, cache: LinesCache): Promise<readonly Line[]> {
  const had = cache.get(project) ?? Promise.resolve({ lines: [], cursor: 0 });
  const now = had.then(async ({ lines, cursor }) => {
    const added = await log.since(project, cursor);
    return { lines: added.lines.length === 0 ? lines : [...lines, ...added.lines], cursor: added.cursor };
  });
  cache.set(project, now.catch(() => had));
  return now.then(({ lines }) => lines);
}
