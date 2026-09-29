/**
 * Capability 3 · Surfaces (the app story): what the app answers when the page asks. The page runs
 * sandboxed and cannot reach the database, so every read a surface makes comes through here: the
 * projects, a project's tree, the two the live reading asks for (ADR-0634 D3), the library's
 * changes and the agent activity log's new lines since a point, and the two the forest's shelves
 * ask for, a node's front covers and the notes that link to a note. The live reading, which decides when
 * to ask, is the arc surface's; the app only answers.
 *
 * Only a project the library already has is read: a name that is not a project is refused, and
 * never created, since opening a project's library would create it.
 */
import { contextReading, idleAfterMs, openActivityLog, type ActivityLog, type ContextReading, type LinesSince } from "@storytree/agent-link";
import type { AnnotatedTree, ArcView, Hold, Changes, Library, Note, SchemaRecord, Storytree } from "@storytree/library";

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
  arcView(project: unknown, id: unknown): Promise<ArcView | null>;
  waitHolds(project: unknown, id: unknown): Promise<Hold[]>;
  heldOnQuestion(project: unknown, id: unknown): Promise<string[]>;
  /** Each named session's context reading in a project (agent link 9.5), read now from the transcript its hooks named, in the order asked. */
  contextReadings(project: unknown, sessions: unknown): Promise<ContextReading[]>;
  /** The user's idle-after setting in milliseconds (agent link 10), read now: how long a session may be quiet before the list shows it idle. */
  idleAfterMs(): Promise<number>;
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
  let log: Promise<ActivityLog> | undefined;

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
    arcView: async (name, id) => (await library(await project(name))).arcView(id as string),
    waitHolds: async (name, id) => (await library(await project(name))).waitHolds(id as string),
    heldOnQuestion: async (name, id) => (await library(await project(name))).heldOnQuestion(id as string),
    contextReadings: async (name, sessions) => {
      const known = await project(name);
      if (!Array.isArray(sessions) || !sessions.every((one) => typeof one === "string")) throw new Error("sessions must be a list of session ids");
      const { lines } = await (await activityLog()).since(known, 0);
      return Promise.all(sessions.map((session: string) => contextReading(lines, session)));
    },
    idleAfterMs: async () => idleAfterMs(),
    close: async () => {
      const opened = [...libraries.values(), ...(log === undefined ? [] : [log])];
      libraries.clear();
      log = undefined;
      await Promise.all(opened.map((open) => open.then((it) => it.close()).catch(() => {})));
    },
  };
}
