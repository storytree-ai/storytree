/**
 * Capability 3 · Surfaces (the app story): what the app answers when the page asks. The page runs
 * sandboxed and cannot reach the database, so every read a surface makes comes through here: the
 * projects, a project's tree, the two the live reading asks for (ADR-0634 D3), the library's
 * changes and the agent activity log's new lines since a point, and the two the forest's shelves
 * ask for, a node's front covers and the notes that link to a note, and the knowledge core's session window. The live reading, which decides when
 * to ask, is the arc surface's; the app only answers.
 *
 * Only a project the library already has is read: a name that is not a project is refused, and
 * never created, since opening a project's library would create it.
 */
import path from "node:path";

import { idleAfterMs, leaveAfterMs, lookAsApp, projectFolder, openActivityLog, pruneTranscripts, standingDelegations, storedContextReading, storedSessionWindow, TranscriptCache, type ActivityLog } from "@storytree/agent-link";
import type { Library, Storytree } from "@storytree/library";

import type { PageReadsBridge } from "./bridge.js";

/** Each of a bridge's methods as the app answers it: given the page's arguments unchecked, since they arrive untrusted. */
type Answers<Bridge> = { [Method in keyof Bridge]: Bridge[Method] extends (...args: infer Args) => infer Answer ? (...args: { [At in keyof Args]: unknown }) => Answer : never };

/** The page's reads (bridge.ts's PageReadsBridge, on its channels), as the app answers them, and what the app itself asks of them. */
export interface PageReads extends Answers<PageReadsBridge> {
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** The latest folder a session of the project worked in on this machine, still there: where its code can be read. */
  projectFolder(project: unknown): Promise<string | undefined>;
  /** The app's own look at every project's branches (agent link 4.21), so the sessions list never waits on a hook's. Never throws, never blocks the process, and never runs twice at once. */
  lookAround(): Promise<void>;
  /** Close the libraries and the log opened here. The connection to the library stays the caller's. */
  close(): Promise<void>;
}

export interface PageReadsOptions {
  /** The app's connection to its library, local or Cloud SQL; the agent activity log is its own database there. */
  readonly storytree: Storytree;
  /**
   * The folder the sessions' fetched transcript records are kept in between app starts (app 3.10),
   * one folder inside it per project's database; without it they are kept only while the app runs.
   */
  readonly transcriptCacheHome?: string;
}

/**
 * The page's reads over the app's library. Each project's library, and the agent activity log, are
 * opened the first time they are asked for, and kept open until close(). A cursor is passed on as
 * the page gave it: the library and the log each refuse one that is not a whole number, 0 or more.
 */
export function pageReads({ storytree, transcriptCacheHome }: PageReadsOptions): PageReads {
  const libraries = new Map<string, Promise<Library>>();
  /** What the page's reads already fetched of each session's stored transcript: each ask fetches only what was stored since. */
  const caches = new Map<string, Promise<TranscriptCache>>();
  let log: Promise<ActivityLog> | undefined;
  /** The look under way, if one is: a look asked for meanwhile joins it rather than running beside it. */
  let looking: Promise<void> | undefined;

  /** `name`, if it is a project the library has; refused otherwise. */
  async function project(name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await storytree.listProjects()).includes(name)) {
      throw new Error(`there is no project called ${JSON.stringify(name)}`);
    }
    return name;
  }

  function library(name: string): Promise<Library> {
    let open = libraries.get(name);
    if (open === undefined) {
      open = storytree.openProject(name);
      libraries.set(name, open);
      open.catch(() => libraries.delete(name));
    }
    return open;
  }

  /**
   * `name`'s transcript cache. Its folder is named by the project's database too, so a project
   * deleted and made again under the same name never reads the old one's records.
   */
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
      // Once an app start: raw transcript records past their 180 days go, their readings kept (ADR-0749 D4). The next start retries a failure.
      opening.then((opened) => pruneTranscripts(opened)).catch(() => {});
    }
    return log;
  }

  return {
    listProjects: () => storytree.listProjects(),
    projectTree: async (name) => (await library(await project(name))).projectTree(),
    changesSince: async (name, cursor) => (await library(await project(name))).changesSince(cursor as number),
    linesSince: async (name, cursor) => {
      const known = await project(name);
      return (await activityLog()).since(known, cursor as number);
    },
    frontCovers: async (name, nodeId) => (await library(await project(name))).frontCovers(nodeId as string),
    relatedNotes: async (name, noteId) => (await library(await project(name))).relatedNotes(noteId as string),
    standingDelegations: async (name) => standingDelegations(await library(await project(name))),
    arcViews: async (name) => (await library(await project(name))).arcViews(),
    holds: async (name) => (await library(await project(name))).holds(),
    contextReadings: async (name, sessions) => {
      const known = await project(name);
      if (!Array.isArray(sessions) || !sessions.every((one) => typeof one === "string")) throw new Error("sessions must be a list of session ids");
      const opened = await activityLog();
      const lines = await opened.lines(known, { sessions, has: ["transcript"], latestBy: ["session"], omit: ["command", "files"] });
      const cache = await transcripts(known);
      return Promise.all(sessions.map((session: string) => storedContextReading(opened, known, lines, session, { cache })));
    },
    idleAfterMs: async () => idleAfterMs(),
    leaveAfterMs: async () => leaveAfterMs(),
    windowReading: async (name, session) => {
      const known = await project(name);
      if (typeof session !== "string") throw new Error("session must be a session id");
      const opened = await activityLog();
      const lines = await opened.lines(known, { sessions: [session], has: ["transcript"], latestBy: ["session"], omit: ["command", "files"] });
      return storedSessionWindow(opened, known, lines, session, { cache: await transcripts(known) });
    },
    windowReadings: async (name, sessions) => {
      const known = await project(name);
      if (!Array.isArray(sessions) || !sessions.every((one) => typeof one === "string")) throw new Error("sessions must be a list of session ids");
      const opened = await activityLog();
      const lines = await opened.lines(known, { sessions, has: ["transcript"], latestBy: ["session"], omit: ["command", "files"] });
      const cache = await transcripts(known);
      return Promise.all(sessions.map((session: string) => storedSessionWindow(opened, known, lines, session, { cache })));
    },
    projectFolder: async (name) => projectFolder(await activityLog(), await project(name)),
    lookAround: () => {
      looking ??= (async () => {
        try {
          const opened = await activityLog();
          for (const name of await storytree.listProjects()) await lookAsApp(opened, name).catch(() => []);
        } catch {
          // No log or no library now: the next look tries again.
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
