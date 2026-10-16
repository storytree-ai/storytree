/** Capability 4 · Updates. Installed-app updates; development slots keep their own follow-main updater. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import { ReleaseUpdater, installation, releaseChannel, type InstallChoice, type Installation, type ReleaseOptions } from "@storytree/app";
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

/** An installed Linux AppImage that replaced itself puts its own agent tools beside it, where the hooks run them (Get storytree 1.5). */
function refreshAgentTools(): void {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== "linux" || appImage === undefined) return;
  try {
    if (refreshTools(path.dirname(appImage), path.join(process.resourcesPath, "agent-tools"))) console.log("Agent tools updated to this build's");
  } catch (error) { console.error(`Agent tools could not be updated: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Whether a downloaded release can install itself here, which the gear's install choice is about. */
export function releasesInstall(): boolean {
  return thisInstallation().followsReleases;
}

/** The updater, for the gear's Updates panel; undefined where the app does not update from releases (an ad-hoc signed Mac build among them). */
export function followReleases(options: ReleaseOptions, home: string, choice: () => InstallChoice): ReleaseUpdater | undefined {
  const { followsReleases, markerFile } = thisInstallation();
  if (!followsReleases) return undefined;
  refreshAgentTools();

  const updater = new ReleaseUpdater({ ...options, home, releaseChannel: () => releaseChannel(home, markerFile === undefined ? "" : readFileSync(markerFile, "utf8")) });
  const log = releasesLog(path.join(home, "releases.log"));
  updater.logger = log;
  const check = async (): Promise<void> => {
    try {
      if (await updater.check() === "waiting") log.info(waitingLine(choice()));
    } catch (error) { log.error(error); }
  };
  const timer = setInterval(() => void check(), 3 * 60_000);
  timer.unref();
  app.once("before-quit", () => { clearInterval(timer); updater.stop(); });
  void check();
  return updater;
}
