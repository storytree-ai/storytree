/**
 * Capability 1 · Lifecycle, contract 1.6: how the app is opened again, and what it says it is.
 *
 * While it runs, the app records how it was started (app.json), and an agent's session start opens
 * storytree from that record when it is closed. On a machine with the installed app, that app is the
 * one to open: a development copy (`pnpm desktop` in a checkout) must never take the record from it,
 * or every later open runs the checkout's old work (seen 2026-09-27). The app also names its build, in
 * its window's title and tray icon, so nobody has to guess which one is on screen.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

/** How to start the app: a program and its arguments (app.json). */
export interface LaunchRecord {
  readonly command: string;
  readonly args: string[];
}

export interface LaunchOptions {
  /** The app's folder (Electron's app path). */
  readonly appPath: string;
  /** The program running it (Electron, or the packaged app). */
  readonly execPath: string;
  /**
   * Set when the app is a packaged build. A portable one runs from a temporary copy of `portableFile`; an AppImage runs
   * from a mount of `appImage` that vanishes when it exits, started with --no-sandbox where the kernel blocks the sandbox.
   */
  readonly packaged?: { readonly portableFile?: string; readonly appImage?: string; readonly sandboxOff?: boolean };
  /** Whether this machine has the installed app (installedAppDir). */
  readonly installedHere: boolean;
}

/** The record this app should leave of how to open it, or undefined when it must leave the one there alone. */
export function launchToRecord({ appPath, execPath, packaged, installedHere }: LaunchOptions): LaunchRecord | undefined {
  if (packaged?.appImage !== undefined) return { command: packaged.appImage, args: packaged.sandboxOff === true ? ["--no-sandbox"] : [] };
  if (packaged !== undefined) return { command: packaged.portableFile ?? execPath, args: [] };
  if (installedHere) return undefined;
  return { command: execPath, args: [appPath] };
}

export interface BuildOptions {
  readonly appPath: string;
  /** The commit it was built from, when known. */
  readonly sha?: string;
  /** Set when the app is a packaged build. */
  readonly packaged?: { readonly version: string };
}

/** Which build this is, in a few words: `version 0.3.0`, or the development checkout it runs from. */
export function buildLabel({ appPath, sha, packaged }: BuildOptions): string {
  if (packaged !== undefined) return `version ${packaged.version}`;
  const short = sha === undefined ? "" : ` ${sha.slice(0, 7)}`;
  return `development build${short} from ${path.resolve(appPath, "..", "..")} (does not update itself)`;
}

/** The commit a development checkout has checked out, for its build label. */
export async function checkoutSha(dir: string): Promise<string> {
  const { stdout } = await promisify(execFile)("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
  return stdout.trim();
}
