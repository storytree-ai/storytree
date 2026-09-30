// `pnpm app:follow-main`: set up the 0.3 app that follows merged main (ADR-0637 D2, the half for
// storytree 0.3's own development), and start it.
//
// It clones the repository into the app's runtime folder (~/.storytree/0.3/runtime, or under
// STORYTREE_HOME), builds main's commit there, and starts the app from that build, in the
// background with its tray icon unless --show is given. From then on the app keeps itself current:
// every few minutes it fetches main, and when main has moved it builds the new commit beside itself
// and restarts into it. Nobody rebuilds it by hand, and it never runs work that is not merged.
//
// Run it once, with storytree 0.3 quit (tray icon → Quit): it refuses while the app is running,
// since that app may be running from the build this would replace. Run it again to start over.
//
//   --origin <url or folder>   where to clone from (default: the GitHub repository)
//   --show                     open the window as well

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { appDirIn, buildApp, electronIn, setUpRuntime } from "@storytree/app";
import { appHome } from "../../../apps/desktop/src/home.ts";

const ORIGIN = "https://github.com/storytree-ai/storytree.git";

const argv = process.argv.slice(2);
const origin = argv.includes("--origin") ? argv[argv.indexOf("--origin") + 1] : ORIGIN;
const home = appHome();

const running = runningApp();
if (running !== undefined) {
  console.error(`follow-main: storytree 0.3 is running (process ${running}). Quit it from its tray icon, then run this again.`);
  process.exit(1);
}

console.log(`follow-main: building merged main from ${origin} in ${home.runtime} (the first build installs everything; it takes a few minutes)`);
const build = await setUpRuntime({ runtimeDir: home.runtime, origin, build: buildApp });
console.log(`follow-main: built ${build.sha.slice(0, 7)} in slot ${build.slot}`);

const child = spawn(electronIn(build.dir), [appDirIn(build.dir), ...(argv.includes("--show") ? [] : ["--background"])], {
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});
child.unref();
console.log(`follow-main: started storytree 0.3 (process ${child.pid}); it now follows merged main by itself.`);

/** The process holding the app's database, if one is alive (local-postgres's owner record). */
function runningApp() {
  const file = `${home.pgdata}.owner.json`;
  if (!existsSync(file)) return undefined;
  try {
    const { pid } = JSON.parse(readFileSync(file, "utf8"));
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}
