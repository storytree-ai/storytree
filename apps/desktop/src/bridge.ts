/**
 * Capability 1 · Lifecycle. What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import type { ContextReading, LinesSince, SessionWindow } from "@storytree/agent-link";
import { SETTINGS_CHANNELS, type SettingsBridge } from "@storytree/agent-link/view";
import { SURFACES_CHANNELS } from "@storytree/app/surfaces";
import type { InstallChoice, InstallChoiceState, ProjectSelection, SignInState, SurfacesBridge, UpdateAction, UpdateState } from "@storytree/app";
import type { SetupHelpBridge } from "@storytree/app-setup";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/journey-events/bridge";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import type { AnnotatedTree, ArcView, Holds, Changes, Note, SchemaRecord } from "@storytree/library";

export interface StorytreeBridge extends SetupHelpBridge, SurfacesBridge, JourneyBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** Whether the app opens at sign-in, in the tray (lifecycle 1.12), and whether it can here. */
  readSignIn(): Promise<SignInState>;
  /** Turn opening at sign-in on or off; refused where the app is not installed. */
  setSignIn(on: boolean): Promise<SignInState>;
  /** When a downloaded release may install itself (updates 4.13), and whether this app installs releases. */
  readInstallChoice(): Promise<InstallChoiceState>;
  /** Keep a new install choice; refused where the app does not install releases, or for a choice that is not one. */
  setInstallChoice(choice: InstallChoice): Promise<InstallChoiceState>;
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** The current project list and the last chosen project, including newly set-up projects. */
  projectSelection(): Promise<ProjectSelection>;
  chooseProject(name: string): Promise<ProjectSelection>;
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
  checkForUpdates: "storytree:check-for-updates",
  readSignIn: "storytree:read-sign-in",
  setSignIn: "storytree:set-sign-in",
  readInstallChoice: "storytree:read-install-choice",
  setInstallChoice: "storytree:set-install-choice",
  readSetupLicense: "storytree:read-setup-license",
  agentConnections: "storytree:agent-connections",
  checkSetupFolder: "storytree:check-setup-folder",
  addProject: "storytree:add-project",
  removeProject: "storytree:remove-project",
  deletableProjects: "storytree:deletable-projects",
  deleteProject: "storytree:delete-project",
  openFeedbackDraft: "storytree:open-feedback-draft",
  copyHelpText: "storytree:copy-help-text",
  listProjects: "storytree:list-projects",
  projectSelection: "storytree:project-selection",
  chooseProject: "storytree:choose-project",
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
  feedbackIdentityOffered: "storytree:feedback-identity-offered",
  feedbackIdentityStatus: "storytree:feedback-identity-status",
  feedbackIdentitySignIn: "storytree:feedback-identity-sign-in",
  feedbackIdentitySignOut: "storytree:feedback-identity-sign-out",
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
  type Identity = NonNullable<StorytreeBridge["feedbackIdentity"]>;
  const feedbackIdentity: Identity | undefined = options.feedbackIdentity === true
    ? {
        status: () => invoke(CHANNELS.feedbackIdentityStatus) as ReturnType<Identity["status"]>,
        signIn: () => invoke(CHANNELS.feedbackIdentitySignIn) as ReturnType<Identity["signIn"]>,
        signOut: () => invoke(CHANNELS.feedbackIdentitySignOut) as ReturnType<Identity["signOut"]>,
      }
    : undefined;
  return {
    ...(feedbackIdentity === undefined ? {} : { feedbackIdentity }),
    readJourney: () => invoke(JOURNEY_CHANNELS.readJourney) as ReturnType<JourneyBridge["readJourney"]>,
    chooseJourney: (on) => invoke(JOURNEY_CHANNELS.chooseJourney, on) as ReturnType<JourneyBridge["chooseJourney"]>,
    prepareJourneyDeletion: () => invoke(JOURNEY_CHANNELS.prepareJourneyDeletion) as ReturnType<JourneyBridge["prepareJourneyDeletion"]>,
    readSettings: () => invoke(SETTINGS_CHANNELS.readSettings) as ReturnType<SettingsBridge["readSettings"]>,
    saveSetting: (name, values) => invoke(SETTINGS_CHANNELS.saveSetting, name, values) as ReturnType<SettingsBridge["saveSetting"]>,
    readSurfaces: () => invoke(SURFACES_CHANNELS.readSurfaces) as ReturnType<SurfacesBridge["readSurfaces"]>,
    saveSurface: (words) => invoke(SURFACES_CHANNELS.saveSurface, words) as ReturnType<SurfacesBridge["saveSurface"]>,
    checkForUpdates: (action) => invoke(CHANNELS.checkForUpdates, action) as ReturnType<StorytreeBridge["checkForUpdates"]>,
    readSignIn: () => invoke(CHANNELS.readSignIn) as ReturnType<StorytreeBridge["readSignIn"]>,
    setSignIn: (on) => invoke(CHANNELS.setSignIn, on) as ReturnType<StorytreeBridge["setSignIn"]>,
    readInstallChoice: () => invoke(CHANNELS.readInstallChoice) as ReturnType<StorytreeBridge["readInstallChoice"]>,
    setInstallChoice: (choice) => invoke(CHANNELS.setInstallChoice, choice) as ReturnType<StorytreeBridge["setInstallChoice"]>,
    readSetupLicense: () => invoke(CHANNELS.readSetupLicense) as ReturnType<StorytreeBridge["readSetupLicense"]>,
    agentConnections: () => invoke(CHANNELS.agentConnections) as ReturnType<StorytreeBridge["agentConnections"]>,
    checkSetupFolder: () => invoke(CHANNELS.checkSetupFolder) as ReturnType<StorytreeBridge["checkSetupFolder"]>,
    addProject: () => invoke(CHANNELS.addProject) as ReturnType<StorytreeBridge["addProject"]>,
    removeProject: (name) => invoke(CHANNELS.removeProject, name) as ReturnType<StorytreeBridge["removeProject"]>,
    deletableProjects: () => invoke(CHANNELS.deletableProjects) as ReturnType<StorytreeBridge["deletableProjects"]>,
    deleteProject: (name, typed, snapshot) => invoke(CHANNELS.deleteProject, name, typed, snapshot) as ReturnType<StorytreeBridge["deleteProject"]>,
    openFeedbackDraft: (draft) => invoke(CHANNELS.openFeedbackDraft, draft) as ReturnType<StorytreeBridge["openFeedbackDraft"]>,
    copyHelpText: (text) => invoke(CHANNELS.copyHelpText, text) as ReturnType<StorytreeBridge["copyHelpText"]>,
    arcViews: (name) => invoke(CHANNELS.arcViews, name) as ReturnType<StorytreeBridge["arcViews"]>,
    holds: (name) => invoke(CHANNELS.holds, name) as ReturnType<StorytreeBridge["holds"]>,
    contextReadings: (name, sessions) => invoke(CHANNELS.contextReadings, name, sessions) as ReturnType<StorytreeBridge["contextReadings"]>,
    idleAfterMs: () => invoke(CHANNELS.idleAfterMs) as Promise<number>,
    leaveAfterMs: () => invoke(CHANNELS.leaveAfterMs) as Promise<number>,
    windowReading: (name, session) => invoke(CHANNELS.windowReading, name, session) as ReturnType<StorytreeBridge["windowReading"]>,
    windowReadings: (name, sessions) => invoke(CHANNELS.windowReadings, name, sessions) as ReturnType<StorytreeBridge["windowReadings"]>,

    listProjects: () => invoke(CHANNELS.listProjects) as Promise<string[]>,
    projectSelection: () => invoke(CHANNELS.projectSelection) as ReturnType<StorytreeBridge["projectSelection"]>,
    chooseProject: (name) => invoke(CHANNELS.chooseProject, name) as ReturnType<StorytreeBridge["chooseProject"]>,
    projectTree: (name) => invoke(CHANNELS.projectTree, name) as ReturnType<StorytreeBridge["projectTree"]>,
    changesSince: (name, cursor) => invoke(CHANNELS.changesSince, name, cursor) as ReturnType<StorytreeBridge["changesSince"]>,
    linesSince: (name, cursor) => invoke(CHANNELS.linesSince, name, cursor) as ReturnType<StorytreeBridge["linesSince"]>,
    frontCovers: (name, nodeId) => invoke(CHANNELS.frontCovers, name, nodeId) as ReturnType<StorytreeBridge["frontCovers"]>,
    relatedNotes: (name, noteId) => invoke(CHANNELS.relatedNotes, name, noteId) as ReturnType<StorytreeBridge["relatedNotes"]>,
    standingDelegations: (name) => invoke(CHANNELS.standingDelegations, name) as ReturnType<StorytreeBridge["standingDelegations"]>,
    codeSurvey: (name) => invoke(CHANNELS.codeSurvey, name) as ReturnType<StorytreeBridge["codeSurvey"]>,
  };
}
