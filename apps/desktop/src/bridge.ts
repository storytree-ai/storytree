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
import type { LagBridge } from "@storytree/lag-in-use/bridge";

import PAGE_CHANNELS from "#parts/pageChannels";

import { pageMethods } from "./page-operations.js";

export interface StorytreeBridge
  extends SetupHelpBridge, SurfacesBridge, JourneyBridge, UpdatesBridge, LifecycleBridge, ProjectsBridge, PageReadsBridge, ForestBridge, LagBridge {}

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
    // Sign-in for feedback, the journey and setup help stay named here: their main-process side stays in the frame (ADR-1030 D4),
    // and sign-in for feedback is one object offered only by some builds, where a manifest's channels are flat and always there.
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
    // The stories whose manifests name their page channels (ADR-1030); the page's type above still names them for the renderer.
    ...(Object.assign({}, ...PAGE_CHANNELS.map((channels) => pageMethods<Record<string, unknown>>(channels, invoke))) as Pick<StorytreeBridge, "recordLag">),
  };
}
