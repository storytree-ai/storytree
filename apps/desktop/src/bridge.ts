/**
 * Capability 1 · Lifecycle. What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import { SETTINGS_CHANNELS, type SettingsBridge } from "@storytree/session-management/view";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS, type PageReadsBridge } from "@storytree/app/surfaces";
import { LIFECYCLE_CHANNELS, type LifecycleBridge } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS, type ProjectsBridge } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS, type UpdatesBridge } from "@storytree/app/updates/bridge";
import type { SurfacesBridge } from "@storytree/app";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS, type FeedbackIdentityBridge, type SetupHelpBridge } from "@storytree/app-setup/bridge";
import { FOREST_CHANNELS, type ForestBridge } from "@storytree/forest/page";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/journey-events/bridge";

import { pageMethods } from "./page-operations.js";

export interface StorytreeBridge
  extends SetupHelpBridge, SurfacesBridge, JourneyBridge, UpdatesBridge, LifecycleBridge, ProjectsBridge, PageReadsBridge, ForestBridge {}

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
    ...pageMethods<PageReadsBridge>(PAGE_READS_CHANNELS, invoke),
    ...pageMethods<ForestBridge>(FOREST_CHANNELS, invoke),
  };
}
