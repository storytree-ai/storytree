/**
 * Capability 1 · Lifecycle. What the preload script hands the page, as `window.storytree`: these functions and nothing else.
 * Each is answered by the main process, which alone holds the library (@storytree/app's pageReads).
 */
import type { SettingsBridge } from "@storytree/project-and-caller/bridge";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS, type PageReadsBridge } from "@storytree/app/surfaces";
import { LIFECYCLE_CHANNELS, type LifecycleBridge } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS, type ProjectsBridge } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS, type UpdatesBridge } from "@storytree/app/updates/bridge";
import type { SurfacesBridge } from "@storytree/app";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS, type FeedbackIdentityBridge, type SetupHelpBridge } from "@storytree/app-setup/bridge";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/app-setup/journey-events/bridge";
import type { StorySurvey } from "@storytree/library";

import PAGE_CHANNELS from "#parts/pageChannels";

import { pageMethods, unreachableSaid, type PageStandIns, type PluginView } from "./page-operations.js";

/**
 * The page operations the forest, Lag in real use and Surface feedback name in their manifests (ADR-1030), as the frame hands them on:
 * its own copy (ADR-1017 D2), with the code survey's shape taken from the library, where it is defined (D1).
 */
export interface StoryPageBridge {
  /** The forest's: each story's code survey, by story id (map 8). */
  codeSurvey(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
  /** Lag in real use's: the page's readings of how long it took to answer. */
  recordLag(readings: readonly object[]): Promise<void>;
  /** Surface feedback's: whether the corner is offered here, and the surfaces a note may name. */
  feedbackSetup(): Promise<{ offered: boolean; surfaces: readonly { id: string; name: string; story: string }[] }>;
  /** Surface feedback's: a picture of the window, or of the part `box` names, kept in the main process, named by the token returned. */
  captureForFeedback(box?: { x: number; y: number; width: number; height: number }): Promise<string | undefined>;
  /** Surface feedback's: the note written, with the element it points at and the pictures its tokens name. */
  sendFeedback(
    note: { text: string; surface: string; anchor: object; selection?: string | undefined; project?: string | undefined; window: { width: number; height: number }; theme: "light" | "dark" },
    screenshot?: string,
    crop?: string,
  ): Promise<{ id: string }>;
}

/** The channel a start-timing mark from the page reaches the main process on (contract 1.33). */
export const START_MARK = "storytree:start-mark";

export interface StorytreeBridge
  extends SetupHelpBridge, SurfacesBridge, JourneyBridge, UpdatesBridge, LifecycleBridge, ProjectsBridge, PageReadsBridge, StoryPageBridge {
  /** Mark that this start reached `name` now, written once to app.log as milliseconds from launch (contract 1.33). */
  startMark(name: string): Promise<void>;
  /** The views of the factory plugins standing in for switched-off parts, which the page mounts while their surfaces are on. */
  readonly pluginViews: readonly PluginView[];
}

/**
 * What the main process told the preload about the bridge: whether this build offers sign-in for feedback (app setup
 * contract 5.6), and the page channels and views of the factory plugins standing in for switched-off parts.
 */
export interface BridgeOptions {
  feedbackIdentity?: boolean;
  standIns?: PageStandIns;
}

/** Electron's wrapper around a main-side failure: "Error invoking remote method '<channel>': <name>: <message>". */
const REMOTE_FAILURE = /^Error invoking remote method '[^']*': (?:([A-Za-z]*Error): )?([\s\S]*)$/;

/** The main side's failure as it was thrown there, its name and message, without Electron's wrapper (contract 1.38); any other rejection unchanged. */
function ownWords(error: unknown): unknown {
  const parts = error instanceof Error ? REMOTE_FAILURE.exec(error.message) : null;
  if (!parts) return error;
  const unwrapped = new Error(parts[2]);
  if (parts[1]) unwrapped.name = parts[1];
  return unwrapped;
}

/**
 * Build the page bridge over the preload's IPC invocation. Sign-in for feedback is there only when the build offers it;
 * its answers are the main process's (an id and an email, never a token).
 */
export function createBridge(
  ipcInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  options: BridgeOptions = {},
): StorytreeBridge & SettingsBridge & SurfacesBridge {
  const invoke = (channel: string, ...args: unknown[]) => ipcInvoke(channel, ...args).then(unreachableSaid, (error: unknown) => { throw ownWords(error); });
  return {
    // Sign-in for feedback, the journey and setup help stay named here: their main-process side stays in the frame (ADR-1030 D4),
    // and sign-in for feedback is one object offered only by some builds, where a manifest's channels are flat and always there.
    ...(options.feedbackIdentity === true ? { feedbackIdentity: pageMethods<FeedbackIdentityBridge>(FEEDBACK_IDENTITY_CHANNELS, invoke) } : {}),
    ...pageMethods<JourneyBridge>(JOURNEY_CHANNELS, invoke),
    ...pageMethods<SurfacesBridge>(SURFACES_CHANNELS, invoke),
    ...pageMethods<UpdatesBridge>(UPDATES_CHANNELS, invoke),
    ...pageMethods<LifecycleBridge>(LIFECYCLE_CHANNELS, invoke),
    ...pageMethods<ProjectsBridge>(PROJECTS_CHANNELS, invoke),
    ...pageMethods<Omit<SetupHelpBridge, "feedbackIdentity">>(SETUP_HELP_CHANNELS, invoke),
    ...pageMethods<PageReadsBridge>(PAGE_READS_CHANNELS, invoke),
    // The stories whose manifests name their page channels (ADR-1030); the page's type above still names them for the renderer.
    ...(Object.assign({}, ...PAGE_CHANNELS.parts.map((channels) => pageMethods<Record<string, unknown>>(channels, invoke))) as Pick<StorytreeBridge, "recordLag" | "codeSurvey" | "feedbackSetup" | "captureForFeedback" | "sendFeedback"> & SettingsBridge),
    // A factory plugin standing in for a switched-off part: its channels, which the main process answers, read from the factory as it started.
    ...Object.assign({}, ...(options.standIns?.channels ?? []).map((channels) => pageMethods<Record<string, unknown>>(channels, invoke))),
    pluginViews: options.standIns?.views ?? [],
    startMark: async (name) => { await invoke(START_MARK, name, Date.now()); },
  };
}
