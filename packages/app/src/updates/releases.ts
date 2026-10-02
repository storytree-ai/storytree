/** Capability 4 · Updates, contracts 4.4–4.5: installed Windows apps follow published releases. */
import { NsisUpdater } from "electron-updater";

import type { Launch } from "../lifecycle/background.js";
import type { UpdateState } from "./main-updates.js";
import { heldUpdateRuns } from "./update-holds.js";
import { STABLE_FEED, type ReleaseChannel } from "./release-channel.js";

export interface ReleaseOptions {
  /** The same database-stop/relaunch handoff the development updater uses. */
  readonly restart: (target: Launch, showing: boolean) => Promise<void>;
  /** False while a seed writes the library, or the app is shutting down. */
  readonly canRestart: () => Promise<boolean>;
  /** Whether now is a quiet moment to install (whenToInstall); the user's say-so skips it, never a seed. */
  readonly quiet: () => Promise<boolean>;
  /** This installed app's storytree home, where a named acceptance run can hold automatic updates. */
  readonly home?: string;
  /** Read on the first check so an unreadable channel fails the check, never app startup. */
  readonly releaseChannel?: () => ReleaseChannel;
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
  private asked = false;
  private next: string | undefined;
  private state: UpdateState;
  private selectedChannel: ReleaseChannel | undefined;

  constructor(private readonly options: ReleaseOptions, app?: ConstructorParameters<typeof NsisUpdater>[1]) {
    super(undefined, app);
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.allowPrerelease = false;
    this.allowDowngrade = false;
    this.disableWebInstaller = true;
    this.state = { phase: "idle", runningBuild: this.currentVersion.version };
  }

  check(): Promise<Check> {
    this.checking ??= this.checkOnce().catch((error: unknown) => {
      this.set("failed", { reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }).finally(() => { this.checking = undefined; });
    return this.checking;
  }

  /** The gear's Updates panel: "check" checks now, "install" installs a downloaded release at once. */
  request(action: unknown): UpdateState {
    if (action !== "check" && action !== "install" && action !== "status") throw new Error("Unknown update action");
    if (action === "install") this.asked = true;
    if (action !== "status") {
      if (this.checking === undefined && !this.downloaded) this.set("checking");
      const run = () => this.check().catch(() => { /* the state says why */ });
      // A check already past its quiet test would not install: asking runs another once it ends.
      void (action === "install" && this.checking !== undefined ? this.checking.catch(() => {}).then(run) : run());
    }
    return this.state;
  }

  stop(): void {
    this.stopped = true;
    this.cancellation?.cancel();
  }

  private async checkOnce(): Promise<Check> {
    if (this.stopped) return "stopped";
    if (this.restarting !== undefined) return "restarting";
    if (this.selectedChannel === undefined && this.options.releaseChannel !== undefined) {
      const channel = this.options.releaseChannel();
      if (channel === "stable") this.setFeedURL({ provider: "generic", url: STABLE_FEED });
      this.selectedChannel = channel;
      this._logger.info(`Following the ${channel} release channel`);
    }
    if (!this.downloaded) {
      const result = await this.checkForUpdates();
      if (this.stopped) return "stopped";
      if (!result?.isUpdateAvailable) { this.set("up-to-date"); return "current"; }
      this.cancellation = result.cancellationToken;
      await this.downloadUpdate(result.cancellationToken);
      this.downloaded = true;
      this.cancellation = undefined;
      this.next = result.updateInfo.version;
      this.set("pending");
    }
    if (this.stopped) return "stopped";
    const ready = await this.options.canRestart() && (this.asked || await this.options.quiet());
    if (this.stopped) return "stopped";
    const holds = this.asked || this.options.home === undefined ? [] : heldUpdateRuns(this.options.home);
    if (holds.length > 0) {
      const reason = `Automatic updates are held for: ${holds.join(", ")}. They resume when the runs finish or their holds expire.`;
      this.set("pending", { reason });
      this._logger.info(reason);
      return "waiting";
    }
    if (!ready) { this.set("pending"); return "waiting"; }
    this.set("restarting");
    if (!this.install(true, true)) throw new Error("The downloaded release could not be installed");
    await this.restarting;
    return "restarting";
  }

  private set(phase: UpdateState["phase"], detail: Partial<UpdateState> = {}): void {
    this.state = { phase, runningBuild: this.currentVersion.version, ...(this.next === undefined ? {} : { nextBuild: this.next }), ...detail };
  }

  protected override spawnLog(command: string, args: string[] = []): Promise<boolean> {
    this.restarting = this.options.restart({ execPath: command, args }, true).then(() => true);
    return this.restarting;
  }
}
