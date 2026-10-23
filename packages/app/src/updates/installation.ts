/**
 * Capability 4 · Updates, contract 4.21: whether the running app is the one the installer put here, and
 * whether it follows published releases. Unpacked development bundles, portable executables, copies and
 * smoke runs must never replace themselves with an installed release, nor register to open at sign-in.
 *
 * On Windows the NSIS installer writes resources/storytree-installed, which also names the old channel.
 * On a Mac nothing may be written inside the bundle (it would break the code signature), so the app is
 * installed when the one-liner's delivery record ($STORYTREE_HOME/delivery.json) names its bundle; its
 * channel is release-channel.json alone. Squirrel.Mac refuses an update to an app that is not Developer
 * ID signed, so a Mac app follows releases only when its build recorded that mode in its package.json
 * (apps/desktop/dist.mjs); an ad-hoc build is installed but does not update itself.
 *
 * On Linux the one-liner installs a folder holding the AppImage as storytree-0.3, which its record names as
 * installDir; the app running from that AppImage (APPIMAGE) is installed, and replacing the file needs no
 * signature or admin password, so it follows releases.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface RunningApp {
  readonly platform: NodeJS.Platform;
  /** Electron's app.isPackaged. */
  readonly packaged: boolean;
  /** Electron's process.resourcesPath. */
  readonly resourcesPath: string;
  /** Electron's app.getAppPath(), which holds the packaged package.json. */
  readonly appPath: string;
  /** The app's home: ~/.storytree/0.3, or STORYTREE_HOME. */
  readonly home: string;
  /** PORTABLE_EXECUTABLE_FILE, which only the Windows portable build sets. */
  readonly portable?: string | undefined;
  /** APPIMAGE, the AppImage file a Linux build runs from; its resources sit in a mount that moves each run. */
  readonly appImage?: string | undefined;
}

export interface Installation {
  readonly installed: boolean;
  readonly followsReleases: boolean;
  /** The Windows installer's marker, whose text releaseChannel reads on the first check; none on a Mac. */
  readonly markerFile: string | undefined;
}

const MARKER = "storytree-installed";

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

/** The folder the one-liner's delivery record says it installed into, if it says one. */
function recordedInstallDir(home: string): string | undefined {
  const record = readJson(path.join(home, "delivery.json")) as { schema?: unknown; installDir?: unknown } | undefined;
  return record?.schema === 1 && typeof record.installDir === "string" ? record.installDir : undefined;
}

function macInstalled(app: RunningApp): boolean {
  const installDir = recordedInstallDir(app.home);
  // The bundle is <name>.app, holding Contents/Resources.
  return installDir !== undefined && path.resolve(installDir) === path.resolve(app.resourcesPath, "..", "..");
}

function linuxInstalled(app: RunningApp): boolean {
  if (app.appImage === undefined) return false;
  const installDir = recordedInstallDir(app.home);
  // The installation is a folder holding the AppImage as storytree-0.3, its agent tools beside it.
  return installDir !== undefined && path.resolve(installDir, "storytree-0.3") === path.resolve(app.appImage);
}

function developerId(app: RunningApp): boolean {
  const pkg = readJson(path.join(app.appPath, "package.json")) as { storytree?: { macSigning?: unknown } } | undefined;
  return pkg?.storytree?.macSigning === "developer-id";
}

export function installation(app: RunningApp): Installation {
  const none: Installation = { installed: false, followsReleases: false, markerFile: undefined };
  if (!app.packaged) return none;
  if (app.platform === "win32") {
    const markerFile = path.join(app.resourcesPath, MARKER);
    if (app.portable !== undefined || !existsSync(markerFile)) return none;
    return { installed: true, followsReleases: true, markerFile };
  }
  if (app.platform === "darwin" && macInstalled(app)) return { installed: true, followsReleases: developerId(app), markerFile: undefined };
  if (app.platform === "linux" && linuxInstalled(app)) return { installed: true, followsReleases: true, markerFile: undefined };
  return none;
}

/**
 * The folder of the app the installer put on this machine, if there is one, seen from any copy of the app: on Windows the
 * per-user NSIS folder (%LOCALAPPDATA%\Programs\storytree-0.3) holding the installer's marker; on a Mac or Linux the folder
 * the delivery record names, while it is still there (a Mac bundle with its Contents, a Linux folder with its AppImage).
 */
export function installedAppDir(home: string, localAppData = process.env.LOCALAPPDATA): string | undefined {
  if (localAppData !== undefined && localAppData !== "") {
    const dir = path.join(localAppData, "Programs", "storytree-0.3");
    if (existsSync(path.join(dir, "resources", MARKER))) return dir;
  }
  const installDir = recordedInstallDir(home);
  if (installDir === undefined) return undefined;
  return existsSync(path.join(installDir, installDir.endsWith(".app") ? "Contents" : "storytree-0.3")) ? installDir : undefined;
}
