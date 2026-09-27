/**
 * Capability 1 · Lifecycle, contract 1.6: how the app is opened again, and what it says it is.
 *
 * While it runs, the app records how it was started (app.json), and an agent's session start opens
 * storytree from that record when it is closed. On a machine where the app follows merged main
 * (`pnpm app:follow-main`), that app is the one to open: a development copy (`pnpm desktop` in a
 * checkout) must never take the record from it, or every later open runs the checkout's old work
 * (seen 2026-09-27). The app also names its build, in its window's title and tray icon, so nobody
 * has to guess which one is on screen.
 */
import path from "node:path";

import { slotOf } from "../updates/follow-main.js";

/** How to start the app: a program and its arguments (app.json). */
export interface LaunchRecord {
  readonly command: string;
  readonly args: string[];
}

export interface LaunchOptions {
  /** The app that follows merged main lives here: ~/.storytree/0.3/runtime */
  readonly runtimeDir: string;
  /** The app's folder (Electron's app path). */
  readonly appPath: string;
  /** The program running it (Electron, or the packaged app). */
  readonly execPath: string;
  /** Set when the app is a packaged build; a portable one runs from a temporary copy of `portableFile`. */
  readonly packaged?: { readonly portableFile?: string };
  /** Whether this machine has the app that follows merged main set up (a built slot in the runtime). */
  readonly followsMainSetUp: boolean;
}

/** The record this app should leave of how to open it, or undefined when it must leave the one there alone. */
export function launchToRecord({ runtimeDir, appPath, execPath, packaged, followsMainSetUp }: LaunchOptions): LaunchRecord | undefined {
  if (packaged !== undefined) return { command: packaged.portableFile ?? execPath, args: [] };
  if (slotOf(runtimeDir, appPath) === undefined && followsMainSetUp) return undefined;
  return { command: execPath, args: [appPath] };
}

export interface BuildOptions {
  readonly runtimeDir: string;
  readonly appPath: string;
  /** The commit it was built from, when known. */
  readonly sha?: string;
  /** Set when the app is a packaged build. */
  readonly packaged?: { readonly version: string };
}

/** Which build this is, in a few words: `main 80bcc63`, `version 0.3.0`, or the development checkout it runs from. */
export function buildLabel({ runtimeDir, appPath, sha, packaged }: BuildOptions): string {
  if (packaged !== undefined) return `version ${packaged.version}`;
  const short = sha === undefined ? "" : ` ${sha.slice(0, 7)}`;
  if (slotOf(runtimeDir, appPath) !== undefined) return `main${short}`;
  return `development build${short} from ${path.resolve(appPath, "..", "..")} (does not update itself)`;
}
