/**
 * Capability 2 · Storytree projects. A capture on a live library: the page's reads answered by the
 * app's own pageReads on it, as the app answers them, instead of from a seed. A busy library's two
 * first reads would not fit a capture (a 572,774-line log ran the heap out at 4 GB; its whole change
 * history overran a string), so the first activity read starts from a floor near the newest lines,
 * and the changes come back folded (each record's creation and only its latest later change) and
 * thinned by the filter the page gives, as the app's are.
 */
import { pageReads } from "@storytree/app";
import { PAGE_READS_CHANNELS } from "@storytree/app/surfaces";
import type { Change, Changes, Storytree } from "@storytree/library";
import { openActivityLog, type ActivityLog } from "@storytree/session-management";

import type { StorytreeBridge } from "../bridge.js";

export interface LiveLibrary {
  /** The connection to the library the capture reads; the caller's, and still open after the capture. */
  storytree: Storytree;
  /** The project the page opens on; the library's first when not named. */
  project?: string;
  /** How many of the newest activity lines the page's first read holds. */
  lines?: number;
}

/** Enough of a session's recent lines for the sessions list to read it as the app does. */
const LINES = 5_000;

export interface LiveAnswers {
  answers: Partial<StorytreeBridge>;
  close(): Promise<void>;
}

/** The page's reads answered from `live`, with what the capture opened to answer them, closed by close(). */
export async function liveAnswers({ storytree, project, lines = LINES }: LiveLibrary): Promise<LiveAnswers> {
  const projects = await storytree.listProjects();
  if (project !== undefined && !projects.includes(project)) throw new Error(`the live library has no project called ${JSON.stringify(project)}: it has ${projects.join(", ")}`);
  let current = project ?? projects[0];
  const reads = pageReads({ storytree });
  let log: Promise<ActivityLog> | undefined;
  const routed = Object.fromEntries(Object.keys(PAGE_READS_CHANNELS).map(method =>
    [method, (...args: unknown[]) => (reads as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!(...args)]));
  const answers: Partial<StorytreeBridge> = {
    ...routed,
    listProjects: async () => projects,
    projectSelection: async () => ({ projects, current }),
    chooseProject: async name => ({ projects, current: current = name }),
    linesSince: async (name, cursor) => {
      if (cursor !== 0) return reads.linesSince(name, cursor);
      const newest = await (log ??= openActivityLog(storytree)).then(opened => opened.lines(name as string, { newest: lines }));
      return reads.linesSince(name, Math.max(0, (newest[0]?.seq ?? 1) - 1));
    },
    changesSince: async (name, cursor, filter) => folded(await reads.changesSince(name, cursor, filter)),
  };
  return {
    answers,
    close: async () => {
      await reads.close();
      await log?.then(opened => opened.close(), () => {});
    },
  };
}

/** `changes` with each record's creation and only its latest later change, oldest first. */
function folded({ changes, cursor }: Changes): Changes {
  const kept = new Map<string, Change>();
  for (const change of changes) kept.set(`${change.recordId} ${change.action === "created" ? "created" : "since"}`, change);
  return { changes: [...kept.values()].sort((a, b) => a.seq - b.seq), cursor };
}
