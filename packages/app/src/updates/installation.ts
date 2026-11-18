// Capability 4 · Updates
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface RunningApp {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly home: string;
  readonly portable?: string | undefined;
  readonly appImage?: string | undefined;
}

export interface Installation {
  readonly installed: boolean;
  readonly followsReleases: boolean;
  readonly markerFile: string | undefined;
}

const MARKER = "storytree-installed";

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

function recordedInstallDir(home: string): string | undefined {
  const record = readJson(path.join(home, "delivery.json")) as { schema?: unknown; installDir?: unknown } | undefined;
  return record?.schema === 1 && typeof record.installDir === "string" ? record.installDir : undefined;
}

function macInstalled(app: RunningApp): boolean {
  const installDir = recordedInstallDir(app.home);
  return installDir !== undefined && path.resolve(installDir) === path.resolve(app.resourcesPath, "..", "..");
}

function linuxInstalled(app: RunningApp): boolean {
  if (app.appImage === undefined) return false;
  const installDir = recordedInstallDir(app.home);
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

export function installedAppDir(home: string, localAppData = process.env.LOCALAPPDATA): string | undefined {
  if (localAppData !== undefined && localAppData !== "") {
    const dir = path.join(localAppData, "Programs", "storytree-0.3");
    if (existsSync(path.join(dir, "resources", MARKER))) return dir;
  }
  const installDir = recordedInstallDir(home);
  if (installDir === undefined) return undefined;
  return existsSync(path.join(installDir, installDir.endsWith(".app") ? "Contents" : "storytree-0.3")) ? installDir : undefined;
}
