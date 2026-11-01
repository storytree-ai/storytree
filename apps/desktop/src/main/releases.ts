/** Capability 4 · Updates. Installed-app updates; a development copy does not update itself. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import { ReleaseUpdater, installation, releaseChannel, releaseChannelChoice, type InstallChoice, type Installation, type ReleaseOptions } from "@storytree/app";
import { agentToolsFolder, channelOffered, keepCheckingReleases } from "@storytree/app/updates/follow-releases";
import { refreshTools } from "@storytree/app-setup/deliver";

import { appHome } from "../home.js";
import { releasesLog, waitingLine } from "./releases-log.js";

/** This app's installation (updates 4.21): whether it is installed, and whether it follows releases. */
function thisInstallation(): Installation {
  return installation({
    platform: process.platform, packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(),
    home: appHome().dir, portable: process.env.PORTABLE_EXECUTABLE_FILE, appImage: process.env.APPIMAGE,
  });
}

/** Whether this is the app the installer put here (the Windows installer's marker, or a delivery record naming this Mac bundle or Linux AppImage). */
export function installedApp(): boolean {
  return thisInstallation().installed;
}

/** An installed Linux AppImage that replaced itself puts its own agent tools beside it, where the hooks run them (Get storytree 1.5; updates 4.31). */
function refreshAgentTools(): void {
  const folder = agentToolsFolder({ platform: process.platform, appImage: process.env.APPIMAGE });
  if (folder === undefined) return;
  try {
    if (refreshTools(folder, path.join(process.resourcesPath, "agent-tools"))) console.log("Agent tools updated to this build's");
  } catch (error) { console.error(`Agent tools could not be updated: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Whether a downloaded release can install itself here, which the gear's install choice is about. */
export function releasesInstall(): boolean {
  return thisInstallation().followsReleases;
}

/** The installer's marker text, which decides an installation's first channel; none on a Mac or a Linux AppImage. */
function markerText(markerFile: string | undefined): string {
  return markerFile === undefined ? "" : readFileSync(markerFile, "utf8");
}

/** The gear's update channel (updates 4.24), offered where releases install (4.32); the updater reads it again on its next check. */
export function channelChoice(home: string, smoke: boolean) {
  const { followsReleases, markerFile } = thisInstallation();
  return releaseChannelChoice({ available: channelOffered({ smoke, followsReleases }), home, marker: () => markerText(markerFile) });
}

/** The updater, for the gear's Updates panel; undefined where the app does not update from releases (an ad-hoc signed Mac build among them). */
export function followReleases(options: ReleaseOptions, home: string, choice: () => InstallChoice): ReleaseUpdater | undefined {
  const { followsReleases, markerFile } = thisInstallation();
  if (!followsReleases) return undefined;
  refreshAgentTools();

  const updater = new ReleaseUpdater({ ...options, home, sandboxOff: app.commandLine.hasSwitch("no-sandbox"), releaseChannel: () => releaseChannel(home, markerText(markerFile)) });
  const log = releasesLog(path.join(home, "releases.log"));
  updater.logger = log;
  // It checks now and every three minutes until the app quits (updates 4.30).
  const checking = keepCheckingReleases({ updater, log, waiting: () => waitingLine(choice()) });
  app.once("before-quit", checking.stop);
  return updater;
}
