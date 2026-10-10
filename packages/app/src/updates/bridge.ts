/** Capability 4 · Updates. The page's update operations and the channels they travel on (ADR-0649). Data only: safe for the page and preload. */
import type { InstallChoice, InstallChoiceState } from "./install-choice.js";
import type { UpdateAction, UpdateState } from "./main-updates.js";

export interface UpdatesBridge {
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** When a downloaded release may install itself (updates 4.13), and whether this app installs releases. */
  readInstallChoice(): Promise<InstallChoiceState>;
  /** Keep a new install choice; refused where the app does not install releases, or for a choice that is not one. */
  setInstallChoice(choice: InstallChoice): Promise<InstallChoiceState>;
}

export const UPDATES_CHANNELS = {
  checkForUpdates: "storytree:check-for-updates",
  readInstallChoice: "storytree:read-install-choice",
  setInstallChoice: "storytree:set-install-choice",
} as const satisfies Record<keyof UpdatesBridge, string>;
