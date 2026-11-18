// Capability 8 · Page bridge
import type { SettingsBridge } from "@storytree/project-and-caller/bridge";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS, type PageReadsBridge } from "@storytree/app/surfaces";
import { LIFECYCLE_CHANNELS, type LifecycleBridge } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS, type ProjectsBridge } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS, type UpdatesBridge } from "@storytree/app/updates/bridge";
import type { SurfacesBridge } from "@storytree/app";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS, type FeedbackIdentityBridge, type SetupHelpBridge } from "@storytree/app-setup/bridge";
import { JOURNEY_CHANNELS, type JourneyBridge } from "@storytree/app-setup/journey-events/bridge";
import type { SchemaRecord, StorySurvey } from "@storytree/library";
import type { CiTimesBridge } from "@storytree/ci-health/bridge";

import PAGE_CHANNELS from "#parts/pageChannels";

import { pageMethods, unreachableSaid, type PageStandIns, type PluginView } from "./page-operations.js";

export interface StoryPageBridge {
  codeSurvey(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
  pins(project: string): Promise<readonly { readonly pin: SchemaRecord<"pin">; readonly stale?: string }[]>;
  recordLag(readings: readonly object[]): Promise<void>;
  feedbackSetup(): Promise<{ offered: boolean; surfaces: readonly { id: string; name: string; story: string }[] }>;
  captureForFeedback(box?: { x: number; y: number; width: number; height: number }): Promise<string | undefined>;
  sendFeedback(
    note: { text: string; surface: string; anchor: object; selection?: string | undefined; project?: string | undefined; window: { width: number; height: number }; theme: "light" | "dark" },
    screenshot?: string,
    crop?: string,
  ): Promise<{ id: string }>;
}

export const START_MARK = "storytree:start-mark";

export interface StorytreeBridge
  extends SetupHelpBridge, SurfacesBridge, JourneyBridge, UpdatesBridge, LifecycleBridge, ProjectsBridge, PageReadsBridge, StoryPageBridge, Partial<CiTimesBridge> {
  startMark(name: string): Promise<void>;
  readonly pluginViews: readonly PluginView[];
}

export interface BridgeOptions {
  feedbackIdentity?: boolean;
  standIns?: PageStandIns;
}

const REMOTE_FAILURE = /^Error invoking remote method '[^']*': (?:([A-Za-z]*Error): )?([\s\S]*)$/;

function ownWords(error: unknown): unknown {
  const parts = error instanceof Error ? REMOTE_FAILURE.exec(error.message) : null;
  if (!parts) return error;
  const unwrapped = new Error(parts[2]);
  if (parts[1]) unwrapped.name = parts[1];
  return unwrapped;
}

export function createBridge(
  ipcInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  options: BridgeOptions = {},
): StorytreeBridge & SettingsBridge & SurfacesBridge {
  const invoke = (channel: string, ...args: unknown[]) => ipcInvoke(channel, ...args).then(unreachableSaid, (error: unknown) => { throw ownWords(error); });
  return {
    ...(options.feedbackIdentity === true ? { feedbackIdentity: pageMethods<FeedbackIdentityBridge>(FEEDBACK_IDENTITY_CHANNELS, invoke) } : {}),
    ...pageMethods<JourneyBridge>(JOURNEY_CHANNELS, invoke),
    ...pageMethods<SurfacesBridge>(SURFACES_CHANNELS, invoke),
    ...pageMethods<UpdatesBridge>(UPDATES_CHANNELS, invoke),
    ...pageMethods<LifecycleBridge>(LIFECYCLE_CHANNELS, invoke),
    ...pageMethods<ProjectsBridge>(PROJECTS_CHANNELS, invoke),
    ...pageMethods<Omit<SetupHelpBridge, "feedbackIdentity">>(SETUP_HELP_CHANNELS, invoke),
    ...pageMethods<PageReadsBridge>(PAGE_READS_CHANNELS, invoke),
    ...(Object.assign({}, ...PAGE_CHANNELS.parts.map((channels) => pageMethods<Record<string, unknown>>(channels, invoke))) as Pick<StorytreeBridge, "recordLag" | "codeSurvey" | "pins" | "feedbackSetup" | "captureForFeedback" | "sendFeedback"> & SettingsBridge),
    ...Object.assign({}, ...(options.standIns?.channels ?? []).map((channels) => pageMethods<Record<string, unknown>>(channels, invoke))),
    pluginViews: options.standIns?.views ?? [],
    startMark: async (name) => { await invoke(START_MARK, name, Date.now()); },
  };
}
