/** Installed-app updates; development slots keep their own follow-main updater. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";

import { app } from "electron";
import { ReleaseUpdater, releaseChannel, type ReleaseOptions } from "@storytree/app";

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
export function followReleases(options: ReleaseOptions, home: string): ReleaseUpdater | undefined {
  if (!installedApp()) return undefined;

  const updater = new ReleaseUpdater({ ...options, home, releaseChannel: () => releaseChannel(home, readFileSync(path.join(process.resourcesPath, "storytree-installed"), "utf8")) });
  const log = (...parts: unknown[]): void => {
    const message = format(...parts);
    console.log(`releases: ${message}`);
    try { appendFileSync(path.join(home, "releases.log"), `${new Date().toISOString()} ${message}\n`); } catch { /* logging cannot stop the app */ }
  };
  updater.logger = { info: log, warn: log, error: log, debug: log };
  const check = async (): Promise<void> => {
    try {
      if (await updater.check() === "waiting") log("downloaded; waiting for a quiet moment (no seed writing, no one using the window or an agent working) or the user's say-so");
    } catch (error) { log(error); }
  };
  const timer = setInterval(() => void check(), 3 * 60_000);
  timer.unref();
  app.once("before-quit", () => { clearInterval(timer); updater.stop(); });
  void check();
  return updater;
}
