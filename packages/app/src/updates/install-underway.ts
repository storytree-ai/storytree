// Capability 4 · Updates
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const INSTALLING_FILE = "installing.json";

const STALE_MS = 10 * 60_000;

interface Installing {
  readonly nextBuild: string;
  readonly installer: string;
  readonly at: number;
}

export function markInstalling(home: string, install: { nextBuild: string; installer: string }, now = Date.now()): void {
  const marker: Installing = { ...install, at: now };
  writeFileSync(path.join(home, INSTALLING_FILE), `${JSON.stringify(marker)}\n`);
}

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

export interface StartFlags {
  readonly smoke: boolean;
  readonly startCheck: boolean;
  readonly callbackCheck: boolean;
  readonly quit: boolean;
  readonly background: boolean;
}

export interface StillUpdatingBox {
  readonly type: "info";
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: string[];
  readonly noLink: boolean;
}

export interface StartWhileInstalling {
  readonly platform: NodeJS.Platform;
  readonly args: StartFlags;
  readonly installed: () => boolean;
  readonly underway: () => { nextBuild: string } | undefined;
  readonly whenReady: () => Promise<unknown>;
  readonly say: (box: StillUpdatingBox) => Promise<unknown>;
  readonly exit: (code: number) => void;
}

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

export function installerRunning(installer: string, timeoutMs = 5_000): boolean {
  if (process.platform !== "win32") return false;
  const image = path.win32.basename(installer);
  try {
    const listed = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: timeoutMs });
    return listed.toLowerCase().includes(`"${image.toLowerCase()}"`);
  } catch {
    return false;
  }
}
