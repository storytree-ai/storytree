/** Installed-app updates; development slots keep their own follow-main updater. */
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";

import { app } from "electron";
import { ReleaseUpdater, type ReleaseOptions } from "@storytree/app";

export function followReleases(options: ReleaseOptions, home: string): void {
  // app-update.yml is emitted for the NSIS target. Unpacked development bundles, portable
  // executables and smoke runs must never replace themselves with an installed release.
  if (!app.isPackaged || process.platform !== "win32" || process.env.PORTABLE_EXECUTABLE_FILE !== undefined ||
      !existsSync(path.join(process.resourcesPath, "app-update.yml"))) return;

  const updater = new ReleaseUpdater(options);
  const log = (...parts: unknown[]): void => {
    const message = format(...parts);
    console.log(`releases: ${message}`);
    try { appendFileSync(path.join(home, "releases.log"), `${new Date().toISOString()} ${message}\n`); } catch { /* logging cannot stop the app */ }
  };
  updater.logger = { info: log, warn: log, error: log, debug: log };
  const check = async (): Promise<void> => {
    try {
      if (await updater.check() === "waiting") log("downloaded; waiting until the library seed has finished");
    } catch (error) { log(error); }
  };
  const timer = setInterval(() => void check(), 3 * 60_000);
  timer.unref();
  app.once("before-quit", () => { clearInterval(timer); updater.stop(); });
  void check();
}
