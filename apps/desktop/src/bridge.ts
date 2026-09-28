/**
 * What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import type { LinesSince } from "@storytree/agent-link";
import type { ProjectSelection, UpdateAction, UpdateState } from "@storytree/app";
import type { SetupHelpBridge } from "@storytree/app-setup";
import type { AnnotatedTree, ArcView, Hold, Changes, Note, SchemaRecord } from "@storytree/library";

export interface StorytreeBridge extends SetupHelpBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** The current project list and the last chosen project, including newly set-up projects. */
  projectSelection(): Promise<ProjectSelection>;
  chooseProject(name: string): Promise<ProjectSelection>;
  arcView(name: string, id: string): Promise<ArcView | null>;
  waitHolds(name: string, id: string): Promise<Hold[]>;
  heldOnQuestion(name: string, id: string): Promise<string[]>;
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
}

/** The IPC channels the functions travel on. */
export const CHANNELS = {
  checkForUpdates: "storytree:check-for-updates",
  readSetupLicense: "storytree:read-setup-license",
  checkSetupFolder: "storytree:check-setup-folder",
  openFeedbackDraft: "storytree:open-feedback-draft",
  copyHelpText: "storytree:copy-help-text",
  listProjects: "storytree:list-projects",
  projectSelection: "storytree:project-selection",
  chooseProject: "storytree:choose-project",
  arcView: "storytree:arc-view",
  waitHolds: "storytree:wait-holds",
  heldOnQuestion: "storytree:held-on-question",
  projectTree: "storytree:project-tree",
  changesSince: "storytree:changes-since",
  linesSince: "storytree:lines-since",
  frontCovers: "storytree:front-covers",
  relatedNotes: "storytree:related-notes",
} as const;
