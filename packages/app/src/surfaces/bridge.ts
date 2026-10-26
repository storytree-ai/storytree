/**
 * Capability 3 · Surfaces. The surfaces' bridges to the main process, each declared once as its methods and the channels they
 * travel on: the Surfaces menu's (ADR-0750), and the reads every surface makes of the library and the agent activity log, which
 * the app answers (reads.ts). Data only: safe for the page and preload.
 */
import type { ContextReading, SessionWindow } from "@storytree/session-management";
import type { AnnotatedTree, ArcView, BoardArcView, Changes, DayWindow, Holds, LinesSince, Note, PrCutover, SchemaRecord } from "@storytree/library";

import type { SurfaceReading } from "./switches.js";

export type SurfacesResult = { readonly ok: true; readonly value: readonly SurfaceReading[] } | { readonly ok: false; readonly error: string };

export interface SurfacesBridge {
  readSurfaces(): Promise<SurfacesResult>;
  /** Save a change given as words: `<surface> on|off`, or `<surface> <setting> <choice>`. */
  saveSurface(words: readonly string[]): Promise<SurfacesResult>;
}

export const SURFACES_CHANNELS = {
  readSurfaces: "storytree:read-surfaces",
  saveSurface: "storytree:save-surface",
} as const;

/** The reads a surface makes of a project's library and the agent activity log: each refused for a name that is not a project. */
export interface PageReadsBridge {
  /** Every live arc's view in a project, in one read (library 7.8): what the sessions list builds its rows from. */
  arcViews(name: string): Promise<ArcView[]>;
  /** The arc board's reading (library 10.22): every live arc, and those closed in a window of days. */
  boardArcs(name: string, closed: DayWindow): Promise<BoardArcView[]>;
  /** The arcs closed in a window of days (library 10.22), for the arc board's Closed tab. */
  closedArcs(name: string, window: DayWindow): Promise<BoardArcView[]>;
  /** Every hold on a project's live work, wait and owner, in one reading. */
  holds(name: string): Promise<Holds>;
  /** A project's repository cut-over (library prCutover), undefined while it has none: what an old pull request number is said by. */
  prCutover(name: string): Promise<PrCutover | undefined>;
  /** A project's tree, with every node's health. */
  projectTree(name: string): Promise<AnnotatedTree>;
  /** The library's changes to a project after `cursor` (start from 0), oldest first, and the cursor to pass next time. */
  changesSince(name: string, cursor: number): Promise<Changes>;
  /** The agent activity log's lines for a project after `cursor` (start from 0), oldest first, and the cursor to pass next time. */
  linesSince(name: string, cursor: number): Promise<LinesSince>;
  /** The system records a product project reads from its factory and holds none of its own for (library 1.19), in id order; none for a project with no factory. */
  inherited(name: string): Promise<SchemaRecord[]>;
  /** A story's or capability's shelf of front covers, founding book first. */
  frontCovers(name: string, nodeId: string): Promise<SchemaRecord<"decision">[]>;
  /** The notes that link to a note. */
  relatedNotes(name: string, noteId: string): Promise<Note[]>;
  /** A project's standing delegations (Session management 7.6), for the who-decides-what view; none when its library has none. */
  standingDelegations(name: string): Promise<string | undefined>;
  /** Each named session's context reading in a project (Session management 9.5), read now, in the order asked. */
  contextReadings(name: string, sessions: readonly string[]): Promise<ContextReading[]>;
  /** The user's idle-after setting in milliseconds (Session management 10), read now: how long a session may be quiet before the list shows it idle. */
  idleAfterMs(): Promise<number>;
  /** The user's leave-after setting in milliseconds (Session management 10), read now: how long a quiet session with no unmerged work stays listed. */
  leaveAfterMs(): Promise<number>;
  /** A session's window in a project (Session management 9.10), read now. */
  windowReading(name: string, session: string): Promise<SessionWindow>;
  /** Several sessions' windows in a project, in one read of the log, in the order asked. */
  windowReadings(name: string, sessions: readonly string[]): Promise<SessionWindow[]>;
}

export const PAGE_READS_CHANNELS = {
  arcViews: "storytree:arc-views",
  boardArcs: "storytree:board-arcs",
  closedArcs: "storytree:closed-arcs",
  holds: "storytree:holds",
  prCutover: "storytree:pr-cutover",
  projectTree: "storytree:project-tree",
  changesSince: "storytree:changes-since",
  linesSince: "storytree:lines-since",
  inherited: "storytree:inherited",
  frontCovers: "storytree:front-covers",
  relatedNotes: "storytree:related-notes",
  standingDelegations: "storytree:standing-delegations",
  contextReadings: "storytree:context-readings",
  idleAfterMs: "storytree:idle-after-ms",
  leaveAfterMs: "storytree:leave-after-ms",
  windowReading: "storytree:window-reading",
  windowReadings: "storytree:window-readings",
} as const;

/** The value of surface `id`'s `setting` in `readings`, undefined when the list does not name it. */
export function surfaceSetting(readings: readonly SurfaceReading[], id: string, setting: string): string | undefined {
  return readings.find((surface) => surface.id === id)?.settings.find((each) => each.id === setting)?.value;
}

/** Whether surface `id` is on in `readings`; one the list does not name is on. */
export function surfaceOn(readings: readonly SurfaceReading[], id: string): boolean {
  return readings.find((surface) => surface.id === id)?.on ?? true;
}
