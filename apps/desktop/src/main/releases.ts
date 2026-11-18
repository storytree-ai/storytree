// Capability 4 · Updates
import { readFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import { ReleaseUpdater, installation, releaseChannel, releaseChannelChoice, stableBuild, type InstallChoice, type Installation, type ReleaseOptions } from "@storytree/app";
import { channelOffered, installationFolder, keepCheckingReleases, refreshAgentTools } from "@storytree/app/updates/follow-releases";
import { followBuildTools, refreshTools } from "@storytree/app-setup/deliver";

import { appHome } from "../home.js";
import { releasesLog, waitingLine } from "./releases-log.js";

function thisInstallation(): Installation {
  return installation({
    platform: process.platform, packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(),
    home: appHome().dir, portable: process.env.PORTABLE_EXECUTABLE_FILE, appImage: process.env.APPIMAGE,
  });
}

export function installedApp(): boolean {
  return thisInstallation().installed;
}

export function releasesInstall(): boolean {
  return thisInstallation().followsReleases;
}

function markerText(markerFile: string | undefined): string {
  return markerFile === undefined ? "" : readFileSync(markerFile, "utf8");
}

export function channelChoice(home: string, smoke: boolean) {
  const { followsReleases, markerFile } = thisInstallation();
  const choice = releaseChannelChoice({ available: channelOffered({ smoke, followsReleases }), home, marker: () => markerText(markerFile), stable: () => stableBuild() });
  return { read: () => choice.describe(), set: choice.set };
}

export function followReleases(options: ReleaseOptions, home: string, choice: () => InstallChoice): ReleaseUpdater | undefined {
  const { followsReleases, markerFile } = thisInstallation();
  if (!followsReleases) return undefined;
  const installDir = installationFolder({ platform: process.platform, execPath: process.execPath, appImage: process.env.APPIMAGE });
  void refreshAgentTools({
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    refresh: (folder) => refreshTools(folder, path.join(process.resourcesPath, "agent-tools")),
    follow: () => followBuildTools({ installDir, home, arch: process.arch === "arm64" ? "arm64" : "x64", searchPath: process.env.PATH ?? "" }),
    log: console,
  });

  const updater = new ReleaseUpdater({ ...options, home, sandboxOff: app.commandLine.hasSwitch("no-sandbox"), releaseChannel: () => releaseChannel(home, markerText(markerFile)) });
  const log = releasesLog(path.join(home, "releases.log"));
  updater.logger = log;
  const checking = keepCheckingReleases({ updater, log, waiting: () => waitingLine(choice()) });
  app.once("before-quit", checking.stop);
  return updater;
}
