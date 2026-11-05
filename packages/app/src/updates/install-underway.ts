/**
 * Capability 4 · Updates, contract 4.41: a start on Windows while a release's installer runs says storytree
 * is still updating, instead of starting and being closed by that installer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The marker in the app's home naming the build being installed and its installer. */
export const INSTALLING_FILE = "installing.json";

/** Past this, a marker is stale whatever the installer: an install takes a few minutes. */
const STALE_MS = 10 * 60_000;

interface Installing {
  readonly nextBuild: string;
  readonly installer: string;
  readonly at: number;
}

/** Written just before the handoff to the installer, which closes every copy of the app it finds. */
export function markInstalling(home: string, install: { nextBuild: string; installer: string }, now = Date.now()): void {
  const marker: Installing = { ...install, at: now };
  writeFileSync(path.join(home, INSTALLING_FILE), `${JSON.stringify(marker)}\n`);
}

/**
 * The build still being installed, or undefined when the app may start. The build the marker names (the
 * new one, opened by its installer) clears it, as does a stale marker; one that cannot be read never stops a start.
 */
export function installUnderway(options: { home: string; runningBuild: string; now?: number; running?: (installer: string) => boolean }): { nextBuild: string } | undefined {
  const file = path.join(options.home, INSTALLING_FILE);
  let marker: Installing;
  try {
    marker = JSON.parse(readFileSync(file, "utf8")) as Installing;
  } catch {
    return undefined;
  }
  const age = (options.now ?? Date.now()) - marker.at;
  const underway = marker.nextBuild !== options.runningBuild && age >= 0 && age < STALE_MS && (options.running ?? installerRunning)(marker.installer);
  if (!underway) {
    rmSync(file, { force: true });
    return undefined;
  }
  return { nextBuild: marker.nextBuild };
}

/** The desktop app's start flags this answer reads. */
export interface StartFlags {
  readonly smoke: boolean;
  readonly startCheck: boolean;
  readonly callbackCheck: boolean;
  readonly quit: boolean;
  readonly background: boolean;
}

/** The box a start shows while a release installs, in Electron's message box options. */
export interface StillUpdatingBox {
  readonly type: "info";
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: string[];
  readonly noLink: boolean;
}

/** What a start needs to answer while a release installs, given by the desktop app's start-up. */
export interface StartWhileInstalling {
  readonly platform: NodeJS.Platform;
  readonly args: StartFlags;
  /** Whether this is the app the installer put here. */
  readonly installed: () => boolean;
  readonly underway: () => { nextBuild: string } | undefined;
  readonly whenReady: () => Promise<unknown>;
  readonly say: (box: StillUpdatingBox) => Promise<unknown>;
  readonly exit: (code: number) => void;
}

/**
 * True when this start was answered because a release is still installing: on Windows, an installed start that is no
 * check (smoke, start or callback, which never read the marker) quits at once if started with --quit or --background,
 * else says storytree is still updating once the app is ready, then quits. False when it may start.
 */
export function answerStartWhileInstalling(start: StartWhileInstalling): boolean {
  const { args } = start;
  if (start.platform !== "win32" || args.smoke || args.startCheck || args.callbackCheck || !start.installed()) return false;
  const installing = start.underway();
  if (installing === undefined) return false;
  if (args.quit || args.background) {
    start.exit(0);
    return true;
  }
  void start.whenReady()
    .then(() => start.say({
      type: "info",
      title: "storytree",
      message: "storytree is still updating",
      detail: `It is installing ${installing.nextBuild}, and opens by itself when that is done.`,
      buttons: ["OK"],
      noLink: true,
    }))
    .finally(() => start.exit(0));
  return true;
}

/** Whether a program named as `installer` is running, by Windows' tasklist; elsewhere, or if tasklist fails, false. */
export function installerRunning(installer: string): boolean {
  if (process.platform !== "win32") return false;
  const image = path.win32.basename(installer);
  try {
    const listed = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    return listed.toLowerCase().includes(`"${image.toLowerCase()}"`);
  } catch {
    return false;
  }
}
