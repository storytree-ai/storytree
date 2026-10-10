/** Capability 4 · Updates, contracts 4.4–4.5: installed apps follow published releases. */
import path from "node:path";

import { MacUpdater, NsisUpdater, type Logger } from "electron-updater";

import type { Launch } from "../lifecycle/background.js";
import type { UpdateState } from "./main-updates.js";
import { heldUpdateRuns } from "./update-holds.js";
import { STABLE_FEED, type ReleaseChannel } from "./release-channel.js";

export interface ReleaseOptions {
  /** The same database-stop/relaunch handoff the development updater uses. */
  readonly restart: (target: Launch, showing: boolean) => Promise<void>;
  /** False while a seed or snapshot is being written, or the app is shutting down. */
  readonly canRestart: () => Promise<boolean>;
  /** Whether now is a quiet moment to install (whenToInstall); the user's say-so skips it, never a seed or snapshot. */
  readonly quiet: () => Promise<boolean>;
  /** This installed app's storytree home, where a named acceptance run can hold automatic updates. */
  readonly home?: string;
  /** Read on the first check so an unreadable channel fails the check, never app startup. */
  readonly releaseChannel?: () => ReleaseChannel;
  /** On macOS, the app bundle a restart opens once Squirrel has installed into it; by default the one holding this executable. */
  readonly bundle?: string;
}

type Check = "current" | "waiting" | "restarting" | "stopped";
type AppAdapter = ConstructorParameters<typeof NsisUpdater>[1];
/** background().restart into a release: the one path by which an update quits the app. */
type Handoff = (target: Launch) => Promise<void>;

/**
 * NSIS's install command, with only its process launch adapted: background().restart stops the
 * database, schedules the installer through Electron's relaunch, then exits. `installRelease`
 * deliberately replaces `quitAndInstall`, whose separate app.quit would race that shared handoff.
 */
class NsisRelease extends NsisUpdater {
  private started: Promise<void> | undefined;

  constructor(private readonly handoff: Handoff, app?: AppAdapter) {
    super(undefined, app);
    this.disableWebInstaller = true;
  }

  /** Resolves once the handoff has stopped the app; rejects if the install could not start. */
  async installRelease(): Promise<void> {
    if (!this.install(true, true)) throw new Error("The downloaded release could not be installed");
    await this.started;
  }

  protected override spawnLog(command: string, args: string[] = []): Promise<boolean> {
    this.started = this.handoff({ execPath: command, args });
    return this.started.then(() => true);
  }
}

/**
 * Squirrel.Mac installs on quit: once it has staged a download, its ShipIt waits until every
 * instance of the app has exited, then swaps the app's bundle. So `installRelease` has Squirrel
 * stage the verified download, then restarts through the handoff into a shell that opens the app
 * once ShipIt is done; opening the app itself at once would keep ShipIt waiting. It never calls
 * `quitAndInstall`, whose own quit would race the handoff. Squirrel accepts only a Developer ID
 * signed app, so desktop turns this on only once the app is signed (increment_4dcfabc58d92).
 */
class MacRelease extends MacUpdater {
  constructor(private readonly handoff: Handoff, app?: AppAdapter, private readonly bundle?: string) {
    super(undefined, app);
  }

  /** Resolves once the handoff has stopped the app; rejects if Squirrel could not stage the release. */
  async installRelease(): Promise<void> {
    // MacUpdater keeps Electron's Squirrel.Mac autoUpdater to itself.
    const squirrel = (this as unknown as { nativeUpdater: Squirrel }).nativeUpdater;
    await new Promise<void>((resolve, reject) => {
      const staged = () => { squirrel.removeListener("error", failed); resolve(); };
      const failed = (error: Error) => { squirrel.removeListener("update-downloaded", staged); reject(error); };
      squirrel.once("update-downloaded", staged);
      squirrel.once("error", failed);
      squirrel.checkForUpdates();
    });
    // The executable is Contents/MacOS/<name> inside the app's bundle.
    const bundle = this.bundle ?? path.resolve(process.execPath, "../../..");
    await this.handoff({ execPath: "/bin/sh", args: ["-c", OPEN_AFTER_SHIPIT, "storytree-update", bundle] });
  }
}

interface Squirrel {
  checkForUpdates(): void;
  once(event: "update-downloaded" | "error", listener: (error: Error) => void): unknown;
  removeListener(event: "update-downloaded" | "error", listener: (error: Error) => void): unknown;
}

/** Waits (at most five minutes) for ShipIt to finish installing, then opens the app with any arguments the restart adds. */
const OPEN_AFTER_SHIPIT = 'app=$1; shift; i=0; while pgrep -x ShipIt >/dev/null && [ "$i" -lt 300 ]; do sleep 1; i=$((i + 1)); done; exec /usr/bin/open "$app" --args "$@"';

/**
 * Each platform's base: Windows installs through NSIS, macOS through Squirrel.Mac. The Linux arc
 * adds AppImageUpdater here (increment_4e9232f6bd10). Elsewhere installed apps do not update.
 */
const BASES: Partial<Record<NodeJS.Platform, new (handoff: Handoff, app?: AppAdapter, bundle?: string) => NsisRelease | MacRelease>> = {
  win32: NsisRelease,
  darwin: MacRelease,
};

/** The updater base installed apps use on `platform`, or undefined where they do not update from releases. */
export function releaseBase(platform: NodeJS.Platform) {
  return BASES[platform];
}

/**
 * electron-updater (the platform's `base`) owns version selection, download verification and the
 * install itself. This decides when: a quiet moment or the user's say-so, never while the library
 * is writing, and not while a named run holds automatic updates.
 */
export class ReleaseUpdater {
  /** electron-updater's own updater for this platform. */
  readonly base: NsisRelease | MacRelease;
  private checking: Promise<Check> | undefined;
  private downloaded = false;
  private stopped = false;
  private cancellation: { cancel(): void } | undefined;
  private restarting: Promise<void> | undefined;
  private asked = false;
  private next: string | undefined;
  private state: UpdateState;
  private selectedChannel: ReleaseChannel | undefined;

  constructor(private readonly options: ReleaseOptions, app?: AppAdapter, platform: NodeJS.Platform = process.platform) {
    const Base = releaseBase(platform);
    if (Base === undefined) throw new Error(`Installed apps do not update from releases on ${platform}`);
    this.base = new Base((target) => this.options.restart(target, true), app, options.bundle);
    this.base.autoDownload = false;
    this.base.autoInstallOnAppQuit = false;
    this.base.allowPrerelease = false;
    this.base.allowDowngrade = false;
    this.state = { phase: "idle", runningBuild: this.base.currentVersion.version };
  }

  set logger(logger: Logger | null) {
    this.base.logger = logger;
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
      if (channel === "stable") this.base.setFeedURL({ provider: "generic", url: STABLE_FEED });
      this.selectedChannel = channel;
      this.base.logger?.info(`Following the ${channel} release channel`);
    }
    if (!this.downloaded) {
      const result = await this.base.checkForUpdates();
      if (this.stopped) return "stopped";
      if (!result?.isUpdateAvailable) { this.set("up-to-date"); return "current"; }
      this.cancellation = result.cancellationToken;
      await this.base.downloadUpdate(result.cancellationToken);
      this.downloaded = true;
      this.cancellation = undefined;
      this.next = result.updateInfo.version;
      this.set("pending");
    }
    if (this.stopped) return "stopped";
    // The quiet read may yield long enough for a daily snapshot to start. Check safety last.
    const quiet = this.asked || await this.options.quiet();
    const canRestart = await this.options.canRestart();
    if (this.stopped) return "stopped";
    const holds = this.asked || this.options.home === undefined ? [] : heldUpdateRuns(this.options.home);
    if (holds.length > 0) {
      const reason = `Automatic updates are held for: ${holds.join(", ")}. They resume when the runs finish or their holds expire.`;
      this.set("pending", { reason });
      this.base.logger?.info(reason);
      return "waiting";
    }
    if (!canRestart) {
      this.set("pending", { reason: "Waiting for the library to finish writing before restarting." });
      return "waiting";
    }
    if (!quiet) { this.set("pending"); return "waiting"; }
    this.set("restarting");
    this.restarting = this.base.installRelease();
    await this.restarting;
    return "restarting";
  }

  private set(phase: UpdateState["phase"], detail: Partial<UpdateState> = {}): void {
    this.state = { phase, runningBuild: this.base.currentVersion.version, ...(this.next === undefined ? {} : { nextBuild: this.next }), ...detail };
  }
}
