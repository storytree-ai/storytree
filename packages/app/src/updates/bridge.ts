// Capability 4 · Updates
import type { InstallChoice, InstallChoiceState } from "./install-choice.js";
import type { ReleaseChannelState } from "./release-channel.js";
import type { UpdateAction, UpdateState } from "./update-state.js";

export interface UpdatesBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  readInstallChoice(): Promise<InstallChoiceState>;
  setInstallChoice(choice: InstallChoice): Promise<InstallChoiceState>;
  readReleaseChannel(): Promise<ReleaseChannelState>;
  setReleaseChannel(channel: ReleaseChannelState["channel"]): Promise<ReleaseChannelState>;
}

export const UPDATES_CHANNELS = {
  checkForUpdates: "storytree:check-for-updates",
  readInstallChoice: "storytree:read-install-choice",
  setInstallChoice: "storytree:set-install-choice",
  readReleaseChannel: "storytree:read-release-channel",
  setReleaseChannel: "storytree:set-release-channel",
} as const satisfies Record<keyof UpdatesBridge, string>;
