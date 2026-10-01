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
import { cachedLines, idleAfterMs, leaveAfterMs, lookAsApp, projectFolder, openActivityLog, pruneTranscripts, standingDelegations, storedContextReading, storedSessionWindow, type ActivityLog, type LinesCache, type TranscriptCache, type ContextReading, type LinesSince, type SessionWindow } from "@storytree/agent-link";
import type { AnnotatedTree, ArcView, Holds, Changes, Library, Note, SchemaRecord, Storytree } from "@storytree/library";

/** The page's reads, as the app answers them. */
export interface PageReads {
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** A project's tree, with every node's health. */
  projectTree(project: unknown): Promise<AnnotatedTree>;
  /** The library's changes to a project after `cursor` (0 for all), and the cursor to pass next time. */
  changesSince(project: unknown, cursor: unknown): Promise<Changes>;
  /** The agent activity log's lines for a project after `cursor` (0 for all), and the cursor to pass next time. */
  linesSince(project: unknown, cursor: unknown): Promise<LinesSince>;
  /** A story's or capability's shelf of front covers in a project, founding book first. */
  frontCovers(project: unknown, nodeId: unknown): Promise<SchemaRecord<"decision">[]>;
  /** The notes in a project that link to a note. */
  relatedNotes(project: unknown, noteId: unknown): Promise<Note[]>;
  /** A project's standing delegations (agent link 7.6): the definition "Standing delegation"'s meaning, or none when its library has none. */
  standingDelegations(project: unknown): Promise<string | undefined>;
  /** Every live arc's view in a project, in one read (library 7.8): what the sessions list builds its rows from. */
  arcViews(project: unknown): Promise<ArcView[]>;
  /** Every hold on a project's live work, wait and owner, in one reading. */
  holds(project: unknown): Promise<Holds>;
  /** Each named session's context reading in a project (agent link 9.5), parsed now from the transcript records its hooks streamed into the shared log (ADR-0749 D3), in the order asked. */
  contextReadings(project: unknown, sessions: unknown): Promise<ContextReading[]>;
  /** The user's idle-after setting in milliseconds (agent link 10), read now: how long a session may be quiet before the list shows it idle. */
  idleAfterMs(): Promise<number>;
  /** The user's leave-after setting in milliseconds (agent link 10), read now: how long a quiet session with no unmerged work stays listed. */
  leaveAfterMs(): Promise<number>;
  /** A session's window in a project (agent link 9.10), parsed now from the transcript records in the shared log. */
  windowReading(project: unknown, session: unknown): Promise<SessionWindow>;
  /** Several sessions' windows in one ask, in the order asked: the log is read once for all of them, not once each. */
  windowReadings(project: unknown, sessions: unknown): Promise<SessionWindow[]>;
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
}

/**
 * The page's reads over the app's library. Each project's library, and the agent activity log, are
 * opened the first time they are asked for, and kept open until close(). A cursor is passed on as
 * the page gave it: the library and the log each refuse one that is not a whole number, 0 or more.
 */
export function pageReads({ storytree }: PageReadsOptions): PageReads {
  const libraries = new Map<string, Promise<Library>>();
  /** What the page's reads already fetched of each session's stored transcript: each ask fetches only what was stored since. */
  const transcripts: TranscriptCache = new Map();
  /** What the page's reads already fetched of each project's log: each window or context read fetches only the lines added since. */
  const logLines: LinesCache = new Map();
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
      const lines = await cachedLines(opened, known, logLines);
      return Promise.all(sessions.map((session: string) => storedContextReading(opened, known, lines, session, { cache: transcripts })));
    },
    idleAfterMs: async () => idleAfterMs(),
    leaveAfterMs: async () => leaveAfterMs(),
    windowReading: async (name, session) => {
      const known = await project(name);
      if (typeof session !== "string") throw new Error("session must be a session id");
      const opened = await activityLog();
      const lines = await cachedLines(opened, known, logLines);
      return storedSessionWindow(opened, known, lines, session, { cache: transcripts });
    },
    windowReadings: async (name, sessions) => {
      const known = await project(name);
      if (!Array.isArray(sessions) || !sessions.every((one) => typeof one === "string")) throw new Error("sessions must be a list of session ids");
      const opened = await activityLog();
      const lines = await cachedLines(opened, known, logLines);
      return Promise.all(sessions.map((session: string) => storedSessionWindow(opened, known, lines, session, { cache: transcripts })));
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
      logLines.clear();
      log = undefined;
      await Promise.all(opened.map((open) => open.then((it) => it.close()).catch(() => {})));
    },
  };
}
