/** Capability 4 · Updates, contracts 4.4–4.5: installed Windows apps follow published releases. */
import { NsisUpdater } from "electron-updater";

import type { Launch } from "../lifecycle/background.js";

export interface ReleaseOptions {
  /** The same database-stop/relaunch handoff the development updater uses. */
  readonly restart: (target: Launch, showing: boolean) => Promise<void>;
  /** False while a seed writes the library, or the app is shutting down. */
  readonly canRestart: () => Promise<boolean>;
}

type Check = "current" | "waiting" | "restarting" | "stopped";

/**
 * electron-updater owns version selection, download verification and NSIS's install command.
 * Only its process launch is adapted: background().restart stops the database, schedules the
 * installer through Electron's relaunch, then exits. `install` deliberately replaces
 * `quitAndInstall`, whose separate app.quit would race that shared handoff.
 */
export class ReleaseUpdater extends NsisUpdater {
  private checking: Promise<Check> | undefined;
  private downloaded = false;
  private stopped = false;
  private cancellation: { cancel(): void } | undefined;
  private restarting: Promise<boolean> | undefined;

  constructor(private readonly options: ReleaseOptions, app?: ConstructorParameters<typeof NsisUpdater>[1]) {
    super(undefined, app);
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.allowPrerelease = false;
    this.allowDowngrade = false;
    this.disableWebInstaller = true;
  }

  check(): Promise<Check> {
    this.checking ??= this.checkOnce().finally(() => { this.checking = undefined; });
    return this.checking;
  }

  stop(): void {
    this.stopped = true;
    this.cancellation?.cancel();
  }

  private async checkOnce(): Promise<Check> {
    if (this.stopped) return "stopped";
    if (this.restarting !== undefined) return "restarting";
    if (!this.downloaded) {
      const result = await this.checkForUpdates();
      if (this.stopped) return "stopped";
      if (!result?.isUpdateAvailable) return "current";
      this.cancellation = result.cancellationToken;
      await this.downloadUpdate(result.cancellationToken);
      this.downloaded = true;
      this.cancellation = undefined;
    }
    if (this.stopped) return "stopped";
    const ready = await this.options.canRestart();
    if (this.stopped) return "stopped";
    if (!ready) return "waiting";
    if (!this.install(true, true)) throw new Error("The downloaded release could not be installed");
    await this.restarting;
    return "restarting";
  }

  protected override spawnLog(command: string, args: string[] = []): Promise<boolean> {
    this.restarting = this.options.restart({ execPath: command, args }, true).then(() => true);
    return this.restarting;
  }
}
