/** Capability 4 · Updates. The page's update operations and the channels they travel on (ADR-0649). Data only: safe for the page and preload. */
import type { InstallChoice, InstallChoiceState } from "./install-choice.js";
import type { ReleaseChannelState } from "./release-channel.js";
import type { UpdateAction, UpdateState } from "./update-state.js";

export interface UpdatesBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** When a downloaded release may install itself (updates 4.13), and whether this app installs releases. */
  readInstallChoice(): Promise<InstallChoiceState>;
  /** Keep a new install choice; refused where the app does not install releases, or for a choice that is not one. */
  setInstallChoice(choice: InstallChoice): Promise<InstallChoiceState>;
  /** Which release channel the updater follows (updates 4.24), stable unless the user opted in to alpha, and whether this app installs releases. */
  readReleaseChannel(): Promise<ReleaseChannelState>;
  /** Follow another channel from the next check; refused where the app does not install releases, or for a channel that is not one. */
  setReleaseChannel(channel: ReleaseChannelState["channel"]): Promise<ReleaseChannelState>;
}

export const UPDATES_CHANNELS = {
  checkForUpdates: "storytree:check-for-updates",
  readInstallChoice: "storytree:read-install-choice",
  setInstallChoice: "storytree:set-install-choice",
  readReleaseChannel: "storytree:read-release-channel",
  setReleaseChannel: "storytree:set-release-channel",
} as const satisfies Record<keyof UpdatesBridge, string>;
