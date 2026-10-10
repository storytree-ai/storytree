/**
 * Capability 1 · Lifecycle. What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import type { ContextReading, LinesSince, SessionWindow } from "@storytree/agent-link";
import { SETTINGS_CHANNELS, type SettingsBridge } from "@storytree/agent-link/view";
import { SURFACES_CHANNELS } from "@storytree/app/surfaces";
import { LIFECYCLE_CHANNELS, type LifecycleBridge } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS, type ProjectsBridge } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS, type UpdatesBridge } from "@storytree/app/updates/bridge";
import type { SurfacesBridge } from "@storytree/app";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS, type FeedbackIdentityBridge, type SetupHelpBridge } from "@storytree/app-setup/bridge";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/journey-events/bridge";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import type { AnnotatedTree, ArcView, Holds, Changes, Note, SchemaRecord } from "@storytree/library";

import { pageMethods } from "./page-operations.js";

export interface StorytreeBridge extends SetupHelpBridge, SurfacesBridge, JourneyBridge, UpdatesBridge, LifecycleBridge, ProjectsBridge {
  /** Every live arc's view in a project, in one read. Refused for a name that is not a project. */
  arcViews(name: string): Promise<ArcView[]>;
  /** Every hold on a project's live work, wait and owner, in one reading. Refused for a name that is not a project. */
  holds(name: string): Promise<Holds>;
  /** Each named session's context reading in a project, read now. Refused for a name that is not a project. */
  contextReadings(name: string, sessions: readonly string[]): Promise<ContextReading[]>;
  /** The user's idle-after setting in milliseconds, read now. */
  idleAfterMs(): Promise<number>;
  /** The user's leave-after setting in milliseconds, read now. */
  leaveAfterMs(): Promise<number>;
  /** A session's window in a project (agent link 9.10), read now. Refused for a name that is not a project. */
  windowReading(name: string, session: string): Promise<SessionWindow>;
  /** Several sessions' windows in a project, in one read of the log. Refused for a name that is not a project. */
  windowReadings(name: string, sessions: readonly string[]): Promise<SessionWindow[]>;
  /** A project's tree, with every node's health. Refused for a name that is not a project. */
  projectTree(name: string): Promise<AnnotatedTree>;
  /**
   * The library's changes to a project after `cursor`, oldest first, and the cursor to pass next
   * time. Start from 0. Refused for a name that is not a project.
   */
  changesSince(name: string, cursor: number): Promise<Changes>;
  /**
   * The agent activity log's lines for a project after `cursor`, oldest first, and the cursor to
   * pass next time. Start from 0. Refused for a name that is not a project.
   */
  linesSince(name: string, cursor: number): Promise<LinesSince>;
  /** A story's or capability's shelf of front covers, founding book first. Refused for a name that is not a project. */
  frontCovers(name: string, nodeId: string): Promise<SchemaRecord<"decision">[]>;
  /** The notes that link to a note. Refused for a name that is not a project. */
  relatedNotes(name: string, noteId: string): Promise<Note[]>;
  /** A project's standing delegations, for the who-decides-what view; none when its library has none. Refused for a name that is not a project. */
  standingDelegations(name: string): Promise<string | undefined>;
  /** Each story's code, surveyed now from the project's checkout on this machine (forest 8); none when there is no checkout here. */
  codeSurvey(name: string): Promise<ProjectSurvey>;
}

/** The IPC channels the functions travel on. */
export const CHANNELS = {
  arcViews: "storytree:arc-views",
  holds: "storytree:holds",
  contextReadings: "storytree:context-readings",
  idleAfterMs: "storytree:idle-after-ms",
  leaveAfterMs: "storytree:leave-after-ms",
  windowReading: "storytree:window-reading",
  windowReadings: "storytree:window-readings",
  projectTree: "storytree:project-tree",
  changesSince: "storytree:changes-since",
  linesSince: "storytree:lines-since",
  frontCovers: "storytree:front-covers",
  relatedNotes: "storytree:related-notes",
  standingDelegations: "storytree:standing-delegations",
  codeSurvey: "storytree:code-survey",
} as const;

/** What the main process told the preload about the bridge: whether this build offers sign-in for feedback (app setup contract 5.6). */
export interface BridgeOptions {
  feedbackIdentity?: boolean;
}

/**
 * Build the page bridge over the preload's IPC invocation. Sign-in for feedback is there only when the build offers it;
 * its answers are the main process's (an id and an email, never a token).
 */
export function createBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  options: BridgeOptions = {},
): StorytreeBridge & SettingsBridge & SurfacesBridge {
  return {
    ...(options.feedbackIdentity === true ? { feedbackIdentity: pageMethods<FeedbackIdentityBridge>(FEEDBACK_IDENTITY_CHANNELS, invoke) } : {}),
    ...pageMethods<JourneyBridge>(JOURNEY_CHANNELS, invoke),
    ...pageMethods<SettingsBridge>(SETTINGS_CHANNELS, invoke),
    ...pageMethods<SurfacesBridge>(SURFACES_CHANNELS, invoke),
    ...pageMethods<UpdatesBridge>(UPDATES_CHANNELS, invoke),
    ...pageMethods<LifecycleBridge>(LIFECYCLE_CHANNELS, invoke),
    ...pageMethods<ProjectsBridge>(PROJECTS_CHANNELS, invoke),
    ...pageMethods<Omit<SetupHelpBridge, "feedbackIdentity">>(SETUP_HELP_CHANNELS, invoke),
    arcViews: (name) => invoke(CHANNELS.arcViews, name) as ReturnType<StorytreeBridge["arcViews"]>,
    holds: (name) => invoke(CHANNELS.holds, name) as ReturnType<StorytreeBridge["holds"]>,
    contextReadings: (name, sessions) => invoke(CHANNELS.contextReadings, name, sessions) as ReturnType<StorytreeBridge["contextReadings"]>,
    idleAfterMs: () => invoke(CHANNELS.idleAfterMs) as Promise<number>,
    leaveAfterMs: () => invoke(CHANNELS.leaveAfterMs) as Promise<number>,
    windowReading: (name, session) => invoke(CHANNELS.windowReading, name, session) as ReturnType<StorytreeBridge["windowReading"]>,
    windowReadings: (name, sessions) => invoke(CHANNELS.windowReadings, name, sessions) as ReturnType<StorytreeBridge["windowReadings"]>,
    projectTree: (name) => invoke(CHANNELS.projectTree, name) as ReturnType<StorytreeBridge["projectTree"]>,
    changesSince: (name, cursor) => invoke(CHANNELS.changesSince, name, cursor) as ReturnType<StorytreeBridge["changesSince"]>,
    linesSince: (name, cursor) => invoke(CHANNELS.linesSince, name, cursor) as ReturnType<StorytreeBridge["linesSince"]>,
    frontCovers: (name, nodeId) => invoke(CHANNELS.frontCovers, name, nodeId) as ReturnType<StorytreeBridge["frontCovers"]>,
    relatedNotes: (name, noteId) => invoke(CHANNELS.relatedNotes, name, noteId) as ReturnType<StorytreeBridge["relatedNotes"]>,
    standingDelegations: (name) => invoke(CHANNELS.standingDelegations, name) as ReturnType<StorytreeBridge["standingDelegations"]>,
    codeSurvey: (name) => invoke(CHANNELS.codeSurvey, name) as ReturnType<StorytreeBridge["codeSurvey"]>,
  };
}
