// Capability 3 · Surfaces
import path from "node:path";

import { lookAsApp, projectFolder, openActivityLog, pruneTranscripts, readingLines, storedContextReading, storedSessionWindow, TranscriptCache, type ActivityLog } from "@storytree/session-management";
import { idleAfterMs, importsOf, leaveAfterMs, machineOf, storytreeHome, standingDelegations, trunkedProjects } from "@storytree/project-and-caller";
import type { ChangesFilter, DayWindow, FactoryLink, Library, LineKind, PluginRecordKind, SchemaRecord, Storytree } from "@storytree/library";

const POOL_ENDED = /Cannot use a pool after calling end on the pool/;

import type { PageReadsBridge } from "./bridge.js";

type Answers<Bridge> = { [Method in keyof Bridge]-?: NonNullable<Bridge[Method]> extends (...args: infer Args) => infer Answer ? (...args: { [At in keyof Args]: unknown }) => Answer : never };

export interface PageReads extends Answers<PageReadsBridge> {
  listProjects(): Promise<string[]>;
  projectFolder(project: unknown): Promise<string | undefined>;
  projectLineage(project: unknown): Promise<FactoryLink>;
  projectBuildsItself(project: unknown): Promise<boolean>;
  projectImports(project: unknown): Promise<{ folder: string; repository?: string }[]>;
  pins(project: unknown): Promise<SchemaRecord<"pin">[]>;
  lookAround(): Promise<void>;
  close(): Promise<void>;
}

export interface PageReadsOptions {
  readonly storytree: Storytree;
  readonly transcriptCacheHome?: string;
  readonly home?: string;
  readonly kinds?: readonly PluginRecordKind[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function dayWindow(window: unknown): DayWindow {
  const { from, to } = (window ?? {}) as Partial<Record<"from" | "to", unknown>>;
  if (typeof from !== "string" || typeof to !== "string" || !DAY.test(from) || !DAY.test(to)) throw new Error("a window of days needs a from and a to, each YYYY-MM-DD");
  return { from, to };
}

export function pageReads({ storytree, transcriptCacheHome, home, kinds }: PageReadsOptions): PageReads {
  const libraries = new Map<string, Promise<Library>>();
  const caches = new Map<string, Promise<TranscriptCache>>();
  let log: Promise<ActivityLog> | undefined;
  let looking: Promise<void> | undefined;

  async function project(name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await storytree.listProjects()).includes(name)) {
      throw new Error(`there is no project called ${JSON.stringify(name)}`);
    }
    return name;
  }

  function library(name: string): Promise<Library> {
    let open = libraries.get(name);
    if (open === undefined) {
      open = kinds === undefined ? storytree.openProject(name) : storytree.openProject(name, { kinds });
      libraries.set(name, open);
      open.catch(() => libraries.delete(name));
    }
    return open;
  }

  async function read<T>(name: unknown, use: (library: Library) => T | Promise<T>): Promise<T> {
    const known = await project(name);
    const open = library(known);
    try {
      return await use(await open);
    } catch (error) {
      if (!(error instanceof Error && POOL_ENDED.test(error.message))) throw error;
      if (libraries.get(known) === open) libraries.delete(known);
      return use(await library(known));
    }
  }

  function transcripts(name: string): Promise<TranscriptCache> {
    let cache = caches.get(name);
    if (cache === undefined) {
      cache = transcriptCacheHome === undefined
        ? Promise.resolve(new TranscriptCache())
        : storytree.projectIdentities().then((identities) => new TranscriptCache(path.join(transcriptCacheHome, `${name}-${identities[name] ?? "unknown"}`)));
      caches.set(name, cache);
      cache.catch(() => caches.delete(name));
    }
    return cache;
  }

  function activityLog(): Promise<ActivityLog> {
    if (log === undefined) {
      const opening = openActivityLog(storytree);
      log = opening;
      opening.catch(() => {
        if (log === opening) log = undefined;
      });
      opening.then((opened) => pruneTranscripts(opened)).catch(() => {});
    }
    return log;
  }

  return {
    listProjects: () => storytree.listProjects(),
    projectTree: (name) => read(name, (library) => library.projectTree()),
    changesSince: (name, cursor, filter) => read(name, (library) => library.changesSince(cursor as number, (filter ?? {}) as ChangesFilter)),
    linesSince: async (name, cursor) => {
      const known = await project(name);
      return (await activityLog()).since(known, cursor as number);
    },
    linesStart: async (name, kinds) => {
      const known = await project(name);
      return (await activityLog()).start(known, { kinds: kinds as LineKind[] });
    },
    sessionLines: async (name, sessions) => {
      const known = await project(name);
      return (await activityLog()).sessionLines(known, sessions as string[]);
    },
    inherited: (name) => read(name, (library) => library.inherited()),
    frontCovers: (name, nodeId) => read(name, (library) => library.frontCovers(nodeId as string)),
    relatedNotes: (name, noteId) => read(name, (library) => library.relatedNotes(noteId as string)),
    standingDelegations: (name) => read(name, standingDelegations),
    arcViews: (name) => read(name, (library) => library.arcViews()),
    boardArcs: (name, closed) => read(name, (library) => library.boardArcs(dayWindow(closed))),
    closedArcs: (name, window) => read(name, (library) => library.closedArcs(dayWindow(window))),
    holds: (name) => read(name, (library) => library.holds()),
    prCutover: (name) => read(name, (library) => library.prCutover()),
    contextReadings: async (name, sessions) => {
      const known = await project(name);
      if (!Array.isArray(sessions) || !sessions.every((one) => typeof one === "string")) throw new Error("sessions must be a list of session ids");
      const opened = await activityLog();
      const lines = await readingLines(opened, known, sessions);
      const cache = await transcripts(known);
      return Promise.all(sessions.map((session: string) => storedContextReading(opened, known, lines, session, { cache })));
    },
    idleAfterMs: async () => idleAfterMs(),
    leaveAfterMs: async () => leaveAfterMs(),
    windowReading: async (name, session) => {
      const known = await project(name);
      if (typeof session !== "string") throw new Error("session must be a session id");
      const opened = await activityLog();
      const lines = await readingLines(opened, known, [session]);
      return storedSessionWindow(opened, known, lines, session, { cache: await transcripts(known) });
    },
    projectFolder: async (name) => projectFolder(await activityLog(), await project(name)),
    pins: (name) => read(name, (library) => library.list("pin")),
    projectLineage: (name) => read(name, (library) => library.factory()),
    projectBuildsItself: async (name) => (await trunkedProjects(storytree)).has(await project(name)),
    projectImports: async (name) => (await importsOf(storytree, await project(name), machineOf(home ?? storytreeHome()).id))
      .map(({ folder, repository }) => ({ folder, ...(repository === undefined ? {} : { repository }) })),
    lookAround: () => {
      looking ??= (async () => {
        try {
          const opened = await activityLog();
          for (const name of await storytree.listProjects()) await lookAsApp(opened, name).catch(() => []);
        } catch {
        } finally {
          looking = undefined;
        }
      })();
      return looking;
    },
    close: async () => {
      const opened = [...libraries.values(), ...(log === undefined ? [] : [log])];
      libraries.clear();
      log = undefined;
      await Promise.all(opened.map((open) => open.then((it) => it.close()).catch(() => {})));
    },
  };
}
