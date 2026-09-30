/**
 * What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import type { ContextReading, LinesSince, SessionWindow } from "@storytree/agent-link";
import type { ProjectSelection, SurfacesBridge, UpdateAction, UpdateState } from "@storytree/app";
import type { SetupHelpBridge } from "@storytree/app-setup";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import type { AnnotatedTree, ArcView, Holds, Changes, Note, SchemaRecord } from "@storytree/library";

export interface StorytreeBridge extends SetupHelpBridge, SurfacesBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** The current project list and the last chosen project, including newly set-up projects. */
  projectSelection(): Promise<ProjectSelection>;
  chooseProject(name: string): Promise<ProjectSelection>;
  arcView(name: string, id: string): Promise<ArcView | null>;
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
  /** Each story's code, surveyed now from the project's checkout on this machine (forest 8); none when there is no checkout here. */
  codeSurvey(name: string): Promise<ProjectSurvey>;
}

/** The IPC channels the functions travel on. */
export const CHANNELS = {
  checkForUpdates: "storytree:check-for-updates",
  readSetupLicense: "storytree:read-setup-license",
  agentConnections: "storytree:agent-connections",
  checkSetupFolder: "storytree:check-setup-folder",
  addProject: "storytree:add-project",
  openFeedbackDraft: "storytree:open-feedback-draft",
  copyHelpText: "storytree:copy-help-text",
  listProjects: "storytree:list-projects",
  projectSelection: "storytree:project-selection",
  chooseProject: "storytree:choose-project",
  arcView: "storytree:arc-view",
  holds: "storytree:holds",
  contextReadings: "storytree:context-readings",
  idleAfterMs: "storytree:idle-after-ms",
  leaveAfterMs: "storytree:leave-after-ms",
  windowReading: "storytree:window-reading",
  projectTree: "storytree:project-tree",
  changesSince: "storytree:changes-since",
  linesSince: "storytree:lines-since",
  frontCovers: "storytree:front-covers",
  relatedNotes: "storytree:related-notes",
  codeSurvey: "storytree:code-survey",
} as const;
