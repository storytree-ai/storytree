/**
 * Capability 4 · Updates (contract 4.18): one storytree desktop app per machine (ADR-0940 D1). The
 * installed app and the app that follows merged main share one home and one single-instance lock, so
 * where both are present the installed one never starts and its hooks lag main. Each refuses where
 * the other is, naming the other copy's folder and how to remove it; nothing here removes either.
 *
 * The installed app is the Windows one-click install: its folder is %LOCALAPPDATA%\Programs\storytree-0.3
 * (the packaging config's per-user NSIS target and product name), marked by resources\storytree-installed,
 * which the installer writes (apps/desktop/installer.nsh). The packaging config ships no installer for
 * macOS or Linux, so there is none to find there. The app that follows main is set up when a runtime
 * slot holds a built app (`pnpm app:follow-main`).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { appDirIn } from "./follow-main.js";

export interface Machine {
  /** The app's home: ~/.storytree/0.3, or STORYTREE_HOME. */
  home: string;
  /** Where Windows keeps a user's apps (%LOCALAPPDATA%). By default, LOCALAPPDATA. */
  localAppData?: string | undefined;
}

/** The installed app's folder, when this machine has one. */
export function installedAppDir(localAppData = process.env.LOCALAPPDATA): string | undefined {
  if (localAppData === undefined || localAppData === "") return undefined;
  const dir = path.join(localAppData, "Programs", "storytree-0.3");
  return existsSync(path.join(dir, "resources", "storytree-installed")) ? dir : undefined;
}

/** The follow-main app's runtime folder, when it is set up here. */
export function followMainDir(home: string): string | undefined {
  const runtime = path.join(home, "runtime");
  return (["a", "b"] as const).some((slot) => existsSync(path.join(appDirIn(path.join(runtime, slot)), "node_modules", "electron", "path.txt"))) ? runtime : undefined;
}

/** Why the follow-main app may not be set up or started here, naming the installed app; undefined when it may. */
export function installedAppPresent(localAppData?: string): string | undefined {
  const installed = installedAppDir(localAppData);
  if (installed === undefined) return undefined;
  return `the installed storytree 0.3 app is on this machine (${installed}), and only one storytree app may run per machine. ` +
    `Uninstall it first (Settings → Apps → storytree-0.3 → Uninstall, or run "Uninstall storytree-0.3.exe" in that folder), then run this again.`;
}

/** Why the installed app may not start here, naming the follow-main app; undefined when it may. */
export function followMainPresent(home: string): string | undefined {
  const runtime = followMainDir(home);
  if (runtime === undefined) return undefined;
  return `the storytree 0.3 app that follows merged main is set up on this machine (${runtime}), and only one storytree app may run per machine. ` +
    `Quit it from its tray icon and delete that folder to switch to this installed app, or uninstall this one to keep following main.`;
}

/** Why the app `starting` may not start beside the other copy; undefined when it may. */
export function otherApp({ starting, home, localAppData }: Machine & { starting: "installed" | "follow-main" }): string | undefined {
  return starting === "installed" ? followMainPresent(home) : installedAppPresent(localAppData);
}
