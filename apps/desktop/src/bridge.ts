/**
 * Capability 1 · Lifecycle. What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import { SETTINGS_CHANNELS, type SettingsBridge } from "@storytree/agent-link/view";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS } from "@storytree/app/surfaces";
import type { InstallChoice, InstallChoiceState, PageReadsBridge, ProjectSelection, SignInState, SurfacesBridge, UpdateAction, UpdateState } from "@storytree/app";
import type { SetupHelpBridge } from "@storytree/app-setup";
import { FOREST_CHANNELS, type ForestBridge } from "@storytree/forest/page";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/journey-events/bridge";

import { pageMethods } from "./page-operations.js";

export interface StorytreeBridge extends SetupHelpBridge, SurfacesBridge, JourneyBridge, PageReadsBridge, ForestBridge {
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
    ...pageMethods<JourneyBridge>(JOURNEY_CHANNELS, invoke),
    ...pageMethods<SettingsBridge>(SETTINGS_CHANNELS, invoke),
    ...pageMethods<SurfacesBridge>(SURFACES_CHANNELS, invoke),
    ...pageMethods<PageReadsBridge>(PAGE_READS_CHANNELS, invoke),
    ...pageMethods<ForestBridge>(FOREST_CHANNELS, invoke),
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
    listProjects: () => invoke(CHANNELS.listProjects) as Promise<string[]>,
    projectSelection: () => invoke(CHANNELS.projectSelection) as ReturnType<StorytreeBridge["projectSelection"]>,
    chooseProject: (name) => invoke(CHANNELS.chooseProject, name) as ReturnType<StorytreeBridge["chooseProject"]>,
  };
}
