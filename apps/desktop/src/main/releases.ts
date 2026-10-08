/** Capability 4 · Updates. Installed-app updates; development slots keep their own follow-main updater. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import { ReleaseUpdater, releaseChannel, type InstallChoice, type ReleaseOptions } from "@storytree/app";

import { releasesLog, waitingLine } from "./releases-log.js";

/**
 * Whether this is the app the installer put here. The installer writes a marker; unpacked
 * development bundles, portable executables and smoke runs must never replace themselves with an
 * installed release, nor register themselves to open at sign-in.
 */
export function installedApp(): boolean {
  return app.isPackaged && process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_FILE === undefined &&
    existsSync(path.join(process.resourcesPath, "storytree-installed"));
}

/** The updater, for the gear's Updates panel; undefined where the app does not update from releases. */
export function followReleases(options: ReleaseOptions, home: string, choice: () => InstallChoice): ReleaseUpdater | undefined {
  if (!installedApp()) return undefined;

  const updater = new ReleaseUpdater({ ...options, home, releaseChannel: () => releaseChannel(home, readFileSync(path.join(process.resourcesPath, "storytree-installed"), "utf8")) });
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
