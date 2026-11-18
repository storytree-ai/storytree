// Capability 4 · Updates
import { rm } from "node:fs/promises";
import path from "node:path";

import { AppImageUpdater, MacUpdater, NsisUpdater, type Logger, type UpdateInfo } from "electron-updater";

import type { Launch } from "../lifecycle/background.js";
import type { UpdateState } from "./update-state.js";
import { heldUpdateRuns } from "./update-holds.js";
import { markInstalling } from "./install-underway.js";
import { STABLE_FEED, type ReleaseChannel } from "./release-channel.js";

export interface ReleaseOptions {
  readonly restart: (target: Launch, showing: boolean) => Promise<void>;
  readonly canRestart: () => Promise<boolean>;
  readonly quiet: () => Promise<boolean>;
  readonly home?: string;
  readonly releaseChannel?: () => ReleaseChannel;
  readonly bundle?: string;
  readonly sandboxOff?: boolean;
  readonly recheck?: number;
}

type Check = "current" | "waiting" | "restarting" | "stopped";
type AppAdapter = ConstructorParameters<typeof NsisUpdater>[1];
type Handoff = (target: Launch) => Promise<void>;

class NsisRelease extends NsisUpdater {
  private started: Promise<void> | undefined;

  constructor(private readonly handoff: Handoff, app?: AppAdapter) {
    super(undefined, app);
    this.disableWebInstaller = true;
  }

  async installRelease(): Promise<void> {
    if (!this.install(false, true)) throw new Error("The downloaded release could not be installed");
    await this.started;
  }

  protected override spawnLog(command: string, args: string[] = []): Promise<boolean> {
    this.started = this.handoff({ execPath: command, args });
    return this.started.then(() => true);
  }

  protected override async differentialDownloadInstaller(...args: Parameters<NsisUpdater["differentialDownloadInstaller"]>): Promise<boolean> {
    await rm(path.join(this.downloadedUpdateHelper!.cacheDir, "current.blockmap"), { force: true });
    return super.differentialDownloadInstaller(...args);
  }
}

class MacRelease extends MacUpdater {
  constructor(private readonly handoff: Handoff, app?: AppAdapter, private readonly bundle?: string) {
    super(undefined, app);
  }

  async installRelease(): Promise<void> {
    const squirrel = (this as unknown as { nativeUpdater: Squirrel }).nativeUpdater;
    await new Promise<void>((resolve, reject) => {
      const staged = () => { squirrel.removeListener("error", failed); resolve(); };
      const failed = (error: Error) => { squirrel.removeListener("update-downloaded", staged); reject(error); };
      squirrel.once("update-downloaded", staged);
      squirrel.once("error", failed);
      squirrel.checkForUpdates();
    });
    const bundle = this.bundle ?? path.resolve(process.execPath, "../../..");
    await this.handoff({ execPath: "/bin/sh", args: ["-c", OPEN_AFTER_SHIPIT, "storytree-update", bundle] });
  }
}

class AppImageRelease extends AppImageUpdater {
  private started: Promise<void> | undefined;

  constructor(private readonly handoff: Handoff, app?: AppAdapter, _bundle?: string, private readonly sandboxOff = false) {
    super(undefined, app);
  }

  async installRelease(): Promise<void> {
    if (!this.install(true, true)) throw new Error("The downloaded release could not be installed");
    await this.started;
  }

  protected override spawnLog(command: string, args: string[] = []): Promise<boolean> {
    this.started = this.handoff({ execPath: command, args: this.sandboxOff ? ["--no-sandbox", ...args] : args });
    return this.started.then(() => true);
  }
}

interface Squirrel {
  checkForUpdates(): void;
  once(event: "update-downloaded" | "error", listener: (error: Error) => void): unknown;
  removeListener(event: "update-downloaded" | "error", listener: (error: Error) => void): unknown;
}

const OPEN_AFTER_SHIPIT = 'app=$1; shift; i=0; while pgrep -x ShipIt >/dev/null && [ "$i" -lt 300 ]; do sleep 1; i=$((i + 1)); done; exec /usr/bin/open "$app" --args "$@"';

type Release = NsisRelease | MacRelease | AppImageRelease;

const RELEASES = "https://github.com/storytree-ai/storytree/releases/download/";

function servedFromRelease(base: Release, info: UpdateInfo): void {
  const { provider } = (base as unknown as { updateInfoAndProvider: { provider: { resolveFiles(info: UpdateInfo): readonly { url: URL }[] } } }).updateInfoAndProvider;
  const release = `${RELEASES}v${info.version}/`;
  for (const { url } of provider.resolveFiles(info)) {
    if (!url.href.startsWith(release)) throw new Error(`The update to ${info.version} is not served from storytree's releases (${url.origin}), so it was not downloaded`);
  }
}

const BASES: Partial<Record<NodeJS.Platform, new (handoff: Handoff, app?: AppAdapter, bundle?: string, sandboxOff?: boolean) => Release>> = {
  win32: NsisRelease,
  darwin: MacRelease,
  linux: AppImageRelease,
};

export function releaseBase(platform: NodeJS.Platform) {
  return BASES[platform];
}

export class ReleaseUpdater {
  readonly base: Release;
  private checking: Promise<Check> | undefined;
  private downloaded = false;
  private stopped = false;
  private cancellation: { cancel(): void } | undefined;
  private restarting: Promise<void> | undefined;
  private asked = false;
  private next: string | undefined;
  private state: UpdateState;
  private selectedChannel: ReleaseChannel | undefined;
  private recheck: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ReleaseOptions, app?: AppAdapter, platform: NodeJS.Platform = process.platform) {
    const Base = releaseBase(platform);
    if (Base === undefined) throw new Error(`Installed apps do not update from releases on ${platform}`);
    this.base = new Base((target) => {
      if (platform === "win32") this.markInstalling(target);
      return this.options.restart(target, true);
    }, app, options.bundle, options.sandboxOff);
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

  request(action: unknown): UpdateState {
    if (action !== "check" && action !== "install" && action !== "status") throw new Error("Unknown update action");
    if (action === "install") this.asked = true;
    if (action !== "status") {
      if (action === "install" && this.downloaded && this.restarting === undefined) this.set("restarting");
      else if (this.checking === undefined && !this.downloaded) this.set("checking");
      const run = () => this.check().catch(() => { });
      void (action === "install" && this.checking !== undefined ? this.checking.catch(() => {}).then(run) : run());
    }
    return this.state;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.recheck);
    this.cancellation?.cancel();
  }

  private async checkOnce(): Promise<Check> {
    if (this.stopped) return "stopped";
    if (this.restarting !== undefined) return "restarting";
    const channel = this.options.releaseChannel?.();
    if (channel !== undefined && channel !== this.selectedChannel) {
      if (channel === "stable") this.base.setFeedURL({ provider: "generic", url: STABLE_FEED });
      else if (this.selectedChannel !== undefined) (this.base as unknown as { clientPromise: unknown }).clientPromise = null;
      if (this.selectedChannel !== undefined) { this.downloaded = false; this.next = undefined; }
      this.selectedChannel = channel;
      this.base.logger?.info(`Following the ${channel} release channel`);
    }
    if (!this.downloaded) {
      const result = await this.base.checkForUpdates();
      if (this.stopped) return "stopped";
      if (!result?.isUpdateAvailable) { this.set("up-to-date", { ...(this.selectedChannel === undefined ? {} : { channel: this.selectedChannel }), checkedAt: new Date().toISOString() }); return "current"; }
      servedFromRelease(this.base, result.updateInfo);
      this.cancellation = result.cancellationToken;
      await this.base.downloadUpdate(result.cancellationToken);
      this.downloaded = true;
      this.cancellation = undefined;
      this.next = result.updateInfo.version;
      this.set("pending");
    }
    if (this.stopped) return "stopped";
    const quiet = this.asked || await this.options.quiet();
    const canRestart = await this.options.canRestart();
    if (this.stopped) return "stopped";
    const holds = this.asked || this.options.home === undefined ? [] : heldUpdateRuns(this.options.home);
    if (holds.length > 0) {
      const reason = `Automatic updates are held for: ${holds.join(", ")}. They resume when the runs finish or their holds expire.`;
      if (!this.asked) this.set("pending", { reason });
      this.base.logger?.info(reason);
      return "waiting";
    }
    if (!canRestart) {
      const reason = "Waiting for the library to finish writing before restarting.";
      if (!this.asked) { this.set("pending", { reason }); return "waiting"; }
      this.set("ready", { reason });
      this.recheck ??= setTimeout(() => {
        this.recheck = undefined;
        this.check().catch(() => { });
      }, this.options.recheck ?? 5_000);
      this.recheck.unref?.();
      return "waiting";
    }
    if (!quiet) { if (!this.asked) this.set("pending"); return "waiting"; }
    this.set("restarting");
    this.restarting = this.base.installRelease();
    await this.restarting;
    return "restarting";
  }

  private markInstalling(installer: Launch): void {
    if (this.options.home === undefined || this.next === undefined) return;
    try {
      markInstalling(this.options.home, { nextBuild: this.next, installer: installer.execPath });
    } catch (error) {
      this.base.logger?.warn(`Could not mark the install as underway: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private set(phase: UpdateState["phase"], detail: Partial<UpdateState> = {}): void {
    this.state = { phase, runningBuild: this.base.currentVersion.version, ...(this.next === undefined ? {} : { nextBuild: this.next }), ...detail };
  }
}
