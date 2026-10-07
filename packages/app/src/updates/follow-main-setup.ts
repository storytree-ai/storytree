/**
 * Capability 4 · Updates. `pnpm app:follow-main`: set up the 0.3 app that follows merged main (ADR-0637 D2, the half for
 * storytree 0.3's own development), and start it (capability 4 · Updates, the app story).
 *
 * It clones the repository into the app's runtime folder (~/.storytree/0.3/runtime, or under
 * STORYTREE_HOME), builds main's commit there, and starts the app from that build, in the
 * background with its tray icon unless --show is given. From then on the app keeps itself current:
 * every few minutes it fetches main, and when main has moved it builds the new commit beside itself
 * and restarts into it. Nobody rebuilds it by hand, and it never runs work that is not merged.
 *
 * It refuses where the installed app is present: one storytree app per machine (ADR-0940).
 *
 * Run it once, with storytree 0.3 quit (tray icon → Quit): it refuses while the app is running,
 * since that app may be running from the build this would replace. Run it again to start over.
 *
 *   --origin <url or folder>   where to clone from (default: the GitHub repository)
 *   --show                     open the window as well
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { storytreeHome } from "@storytree/agent-link";

import { appDirIn, buildApp, electronIn, setUpRuntime, type RunningBuild, type SetUpOptions } from "./follow-main.js";
import { installedAppDir, installedAppPresent } from "./one-app.js";

const ORIGIN = "https://github.com/storytree-ai/storytree.git";

export interface FollowMainOptions {
  /** The app's home: ~/.storytree/0.3, or STORYTREE_HOME. */
  home: string;
  /** Where to clone from: a URL or a folder (default: the GitHub repository). */
  origin?: string;
  /** Where Windows keeps a user's apps, where an installed app would be (default: LOCALAPPDATA). */
  localAppData?: string;
  /** Open the window as well, rather than starting in the background. */
  show?: boolean;
  /** Clone and build main in the runtime folder (default: the real setup with the real build). */
  setUp?: (options: Omit<SetUpOptions, "build">) => Promise<RunningBuild>;
  /** Start the app from a build, detached; gives its process id. */
  start?: (build: RunningBuild, show: boolean) => number | undefined;
  say?: (line: string) => void;
}

/** Set up the app that follows main and start it, unless the app is running. */
export async function followMain({ home, origin = ORIGIN, localAppData, show = false, setUp = (options) => setUpRuntime({ ...options, build: buildApp }), start = startApp, say = console.log }: FollowMainOptions): Promise<{ refused: number | string } | { started: number | undefined; build: RunningBuild }> {
  // One storytree app per machine (ADR-0940 D1, contract 4.18).
  const installed = installedAppPresent(localAppData);
  if (installed !== undefined) {
    say(`follow-main: ${installed}`);
    return { refused: installedAppDir(localAppData)! };
  }
  const running = runningApp(path.join(home, "pgdata"));
  if (running !== undefined) {
    say(`follow-main: storytree 0.3 is running (process ${running}). Quit it from its tray icon, then run this again.`);
    return { refused: running };
  }
  const runtimeDir = path.join(home, "runtime");
  say(`follow-main: building merged main from ${origin} in ${runtimeDir} (the first build installs everything; it takes a few minutes)`);
  const build = await setUp({ runtimeDir, origin });
  say(`follow-main: built ${build.sha.slice(0, 7)} in slot ${build.slot}`);
  const started = start(build, show);
  say(`follow-main: started storytree 0.3 (process ${started}); it now follows merged main by itself.`);
  return { started, build };
}

/** The process holding the app's database, if one is alive (local-postgres's owner record). */
function runningApp(pgdata: string): number | undefined {
  const file = `${pgdata}.owner.json`;
  if (!existsSync(file)) return undefined;
  try {
    const { pid } = JSON.parse(readFileSync(file, "utf8")) as { pid: number };
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

function startApp(build: RunningBuild, show: boolean): number | undefined {
  const child = spawn(electronIn(build.dir), [appDirIn(build.dir), ...(show ? [] : ["--background"])], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return child.pid;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const result = await followMain({ home: storytreeHome(), show: argv.includes("--show"), ...(argv.includes("--origin") ? { origin: argv[argv.indexOf("--origin") + 1]! } : {}) });
  if ("refused" in result) process.exitCode = 1;
}
