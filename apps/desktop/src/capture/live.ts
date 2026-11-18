// Capability 2 · Storytree projects
import { pageReads } from "@storytree/app";
import { PAGE_READS_CHANNELS } from "@storytree/app/surfaces";
import type { Change, Changes, Storytree } from "@storytree/library";
import { openActivityLog, type ActivityLog } from "@storytree/session-management";

import type { StorytreeBridge } from "../bridge.js";

export interface LiveLibrary {
  storytree: Storytree;
  project?: string;
  lines?: number;
}

const LINES = 5_000;

export interface LiveAnswers {
  answers: Partial<StorytreeBridge>;
  close(): Promise<void>;
}

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

function folded({ changes, cursor }: Changes): Changes {
  const kept = new Map<string, Change>();
  for (const change of changes) kept.set(`${change.recordId} ${change.action === "created" ? "created" : "since"}`, change);
  return { changes: [...kept.values()].sort((a, b) => a.seq - b.seq), cursor };
}
