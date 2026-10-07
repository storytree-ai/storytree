/**
 * The storytree 0.3 desktop app's main process. It starts the app's own Postgres on its data
 * directory (~/.storytree/0.3/pgdata) through local-postgres, or, when the user's library setting
 * names a Cloud SQL instance, starts none and uses the instance; connects the library through its
 * public API, opens the project asked for (`--project <name>`, else `storytree` if there is one,
 * else the first), and shows it. It answers the page's questions (bridge.ts) through
 * @storytree/app's pageReads: the projects, a project's tree, and the library's changes and the
 * agent activity log's new lines since a point.
 *
 * Closing the window does not stop the app or its database (ADR-0636 D3): the app keeps running in
 * the background, with a tray icon, so agents' activity is still recorded. The tray's Quit is the
 * one way to stop it, and it stops Postgres before the app exits. Opening the app again, or the
 * tray's Open, brings the window back on the project it showed.
 *
 * Run from the runtime folder (~/.storytree/0.3/runtime, set up by `pnpm app:follow-main`), the app
 * follows merged main (ADR-0637 D2): every few minutes it fetches main, and when main has moved it
 * builds main's new commit beside itself and restarts into it (@storytree/app's follow-main).
 *
 * While it runs, it keeps a snapshot of every project, taken at start and once a day (ADR-0641 B1),
 * in ~/.storytree/0.3/backups: @storytree/app's keepBackups, which holds restarts while writing.
 *
 * Before it restarts into a new build, it starts that build with `--start-check`, which goes as far
 * as registering the main process's handlers and exits 0 without opening the library; a build that
 * cannot is never restarted into (./start-check.ts). A start that fails ends the app.
 *
 * `--smoke` renders the project without showing a window, saves a screenshot to the file given
 * with `--screenshot <file>`, prints the page's text to stdout, and quits: exit 0 only if the
 * surface on show says it drew every story of the project and every one of its capabilities.
 */
import { smokeArcSurface } from "@storytree/arc-surface";
import { arcSurfaces } from "@storytree/arc-surface/surfaces";
import { readCodeSurvey } from "@storytree/forest/code-survey";
import { forestSurfaces } from "@storytree/forest/surfaces";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { format } from "node:util";
import path from "node:path";

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, shell, Tray } from "electron";

import {
  agentActiveAt,
  appDirIn,
  background,
  keepBackups,
  buildLabel,
  electronIn,
  launchToRecord,
  openAppLibrary,
  pageReads,
  projectSelection,
  refreshOwnHealth,
  seedWriting,
  signIn,
  slotOf,
  slotSha,
  smokeProblems,
  surfaceOn,
  surfacesActions,
  SURFACES_CHANNELS,
  TRAY_MENU,
  mainUpdates,
  buildApp,
  updateToMain,
  whenToInstall,
  installChoice,
  type Launch,
  type PageReads,
} from "@storytree/app";
import { projectsOnThisComputer, setupHelpActions } from "@storytree/app-setup";
import { settingsActions, SETTINGS_CHANNELS } from "@storytree/agent-link/settings";
import { createJourneyRuntime, type JourneyRuntime } from "@storytree/journey-events/runtime";
import { JOURNEY_CHANNELS } from "@storytree/journey-events/bridge";
import { sourceVersion } from "@storytree/app/version";
import { connect, type AnnotatedTree, type Storytree } from "@storytree/library";
import { DataDirInUseError, findBinaries, start, type LocalPostgres } from "@storytree/local-postgres";

import { CHANNELS } from "../bridge.js";
import { APP_OWNER, appHome } from "../home.js";
import { parseArgs } from "./args.js";
import { createTrayIcon } from "./tray-icon.js";
import { startRefusal } from "./one-app.js";
import { followReleases, installedApp } from "./releases.js";
import { checkedUpdate, finishStartCheck, runWhenReady, startsCleanly } from "./start-check.js";

const args = parseArgs(process.argv);
const home = appHome();
/** The app's surfaces, as each story declares them (ADR-0750), in the Surfaces menu's order. */
const SURFACES = [...forestSurfaces, ...arcSurfaces];
/** How long the smoke check may take, start to finish, before it gives up. */
const SMOKE_TIMEOUT_MS = 180_000;

// Electron's own files (cache, local storage) live in the app's home too, apart from any other app.
app.setPath("userData", home.electron);

let postgres: LocalPostgres | undefined;
let storytree: Storytree | undefined;
let reads: PageReads | undefined;
/** How often the app looks at each project's branches itself; the look is shared with the hooks', once a minute a machine. */
const LOOK_EVERY_MS = 60_000;
let projects: ReturnType<typeof projectSelection> | undefined;
let shutDown: Promise<void> | undefined;
let updates: ReturnType<typeof mainUpdates> | undefined;
let backups: ReturnType<typeof keepBackups> | undefined;
let journey: JourneyRuntime | undefined;
/** An installed app's release updater, which answers the gear's Updates panel in its place. */
let releases: ReturnType<typeof followReleases>;
/** What the window was opened with, so it can be opened again after it is closed. */
let windowQuery: { project?: string; problem?: string } = {};
/** Held here so it is not garbage-collected, which would remove the icon. */
let tray: Tray | undefined;
/** Which build this is (`main 80bcc63`, or the development checkout), shown in the title and the tray. */
let build = "";
/** The runtime slot this app runs from, when it is the app that follows merged main. */
const slot = slotOf(home.runtime, app.getAppPath());
const lifecycle = background({
  // End every renderer (project polling and live reading) before closing what it reads.
  stopPages: () => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); },
  stopDatabase: shutdown,
  exit: (code) => app.exit(code),
  relaunch,
});
// The app that follows merged main runs with no terminal, so what it says goes to a log beside its data.
if (slot !== undefined && !args.smoke && !args.startCheck) logTo(path.join(home.dir, "app.log"));

// One storytree app per machine (ADR-0940 D1): beside the other copy, say which and how to remove it, and start nothing.
const refusal = args.smoke || args.startCheck ? undefined : startRefusal({ slot, installed: installedApp(), home: home.dir });

if (refusal !== undefined) {
  console.error(`storytree 0.3 cannot start: ${refusal}`);
  if (!args.background) dialog.showErrorBox("storytree 0.3 cannot start", refusal);
  app.exit(1);
} else if (!args.smoke && !args.startCheck && !app.requestSingleInstanceLock()) {
  app.quit(); // the app is already open: that one is focused instead (or, with --quit, quits)
} else if (args.quit) {
  app.exit(0); // asked to quit, and none is running: start nothing
} else {
  // A second start shows the window; one that arrives while the app is quitting or restarting opens
  // it again once it has stopped, instead of being lost.
  app.on("second-instance", (_event, argv) => {
    if (lifecycle.secondStart({ quit: parseArgs(argv).quit }) === "show") showWindow();
  });
  app.on("activate", () => showWindow());
  // Closing the last window leaves the app, and its database, running in the background.
  app.on("window-all-closed", () => lifecycle.windowClosed());
  // Quitting waits for Postgres to stop; app.exit then ends the app without asking again.
  app.on("before-quit", (event) => {
    event.preventDefault();
    void lifecycle.quit();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());
  if (args.smoke) {
    setTimeout(() => {
      console.error(`smoke: gave up after ${SMOKE_TIMEOUT_MS / 1000} s`);
      void lifecycle.quit(1);
    }, SMOKE_TIMEOUT_MS).unref();
  }
  // A failure in run, not only in whenReady, ends the app: half-started, it would hold the lock with no handlers.
  void runWhenReady(app.whenReady(), run, fail);
}

async function run(): Promise<void> {
  // The bundled main is CommonJS with no import.meta, so its own build is named from Electron when packaged and from the checkout at its app path otherwise.
  journey = createJourneyRuntime({ home: home.dir, appVersion: app.isPackaged ? app.getVersion() : (sourceVersion(app.getAppPath())?.version ?? "0.3.0") });
  ipcMain.handle(JOURNEY_CHANNELS.readJourney, () => journey!.readJourney());
  ipcMain.handle(JOURNEY_CHANNELS.chooseJourney, (_event, on: boolean) => journey!.chooseJourney(on));
  ipcMain.handle(JOURNEY_CHANNELS.prepareJourneyDeletion, () => journey!.prepareJourneyDeletion());
  if (!args.smoke && !args.startCheck) journey.desktopStarted(installedApp());
  const settings = settingsActions(home.dir);
  ipcMain.handle(SETTINGS_CHANNELS.readSettings, () => settings.readSettings());
  ipcMain.handle(SETTINGS_CHANNELS.saveSetting, (_event, name: unknown, values: unknown) => settings.saveSetting(name, values));
  const surfaces = surfacesActions(SURFACES, home.dir);
  ipcMain.handle(SURFACES_CHANNELS.readSurfaces, () => surfaces.readSurfaces());
  ipcMain.handle(SURFACES_CHANNELS.saveSurface, (_event, words: unknown) => surfaces.saveSurface(words));
  const help = setupHelpActions({
    licenseFile: path.join(app.isPackaged ? process.resourcesPath : __dirname, "LICENSE"),
    storytreeHome: home.dir,
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    openExternal: (url) => shell.openExternal(url),
    copyText: async (text) => { clipboard.writeText(text); },
    library: () => {
      if (storytree === undefined) throw new Error("The library is not open");
      return storytree;
    },
  });
  ipcMain.handle(CHANNELS.readSetupLicense, () => help.readSetupLicense());
  ipcMain.handle(CHANNELS.agentConnections, () => help.agentConnections());
  ipcMain.handle(CHANNELS.checkSetupFolder, () => help.checkSetupFolder());
  ipcMain.handle(CHANNELS.addProject, () => help.addProject().then(result => journey!.afterProjectAdded(result)));
  ipcMain.handle(CHANNELS.removeProject, (_event, name: unknown) => help.removeProject(name));
  ipcMain.handle(CHANNELS.deletableProjects, () => help.deletableProjects());
  ipcMain.handle(CHANNELS.deleteProject, (_event, name: unknown, typed: unknown, snapshot: unknown) => help.deleteProject(name, typed, snapshot));
  ipcMain.handle(CHANNELS.openFeedbackDraft, (_event, draft: unknown) => help.openFeedbackDraft(draft));
  ipcMain.handle(CHANNELS.copyHelpText, (_event, text: string) => help.copyHelpText(text));

  ipcMain.handle(CHANNELS.arcViews, (_event, name: unknown) => open().arcViews(name));
  ipcMain.handle(CHANNELS.holds, (_event, name: unknown) => open().holds(name));
  ipcMain.handle(CHANNELS.contextReadings, (_event, name: unknown, sessions: unknown) => open().contextReadings(name, sessions));
  ipcMain.handle(CHANNELS.idleAfterMs, () => open().idleAfterMs());
  ipcMain.handle(CHANNELS.leaveAfterMs, () => open().leaveAfterMs());
  ipcMain.handle(CHANNELS.windowReading, (_event, name: unknown, session: unknown) => open().windowReading(name, session));
  ipcMain.handle(CHANNELS.windowReadings, (_event, name: unknown, sessions: unknown) => open().windowReadings(name, sessions));

  ipcMain.handle(CHANNELS.listProjects, () => (reads === undefined ? [] : reads.listProjects()));
  ipcMain.handle(CHANNELS.projectSelection, () => projects?.read() ?? { projects: [], current: undefined });
  ipcMain.handle(CHANNELS.chooseProject, (_event, name: unknown) => {
    if (projects === undefined) throw new Error("The library is not open");
    return projects.choose(name);
  });
  // The code survey surveys the tree the page last read, rather than reading it a second time.
  const treesRead = new Map<unknown, AnnotatedTree>();
  ipcMain.handle(CHANNELS.projectTree, async (_event, name: unknown) => {
    const tree = await open().projectTree(name);
    treesRead.set(name, tree);
    return tree;
  });
  ipcMain.handle(CHANNELS.changesSince, (_event, name: unknown, cursor: unknown) => open().changesSince(name, cursor));
  ipcMain.handle(CHANNELS.linesSince, (_event, name: unknown, cursor: unknown) => open().linesSince(name, cursor));
  ipcMain.handle(CHANNELS.frontCovers, (_event, name: unknown, nodeId: unknown) => open().frontCovers(name, nodeId));
  ipcMain.handle(CHANNELS.relatedNotes, (_event, name: unknown, noteId: unknown) => open().relatedNotes(name, noteId));
  ipcMain.handle(CHANNELS.standingDelegations, (_event, name: unknown) => open().standingDelegations(name));
  ipcMain.handle(CHANNELS.codeSurvey, async (_event, name: unknown) => {
    const folder = await open().projectFolder(name);
    return folder === undefined ? {} : readCodeSurvey(folder, treesRead.get(name) ?? await open().projectTree(name));
  });

  if (args.startCheck) {
    await finishStartCheck((code) => app.exit(code));
    return;
  }

  let problem: string | undefined;
  let project: string | undefined;
  try {
    // Where the library lives is the user's library setting: this app's own Postgres (the default),
    // or a Cloud SQL instance, when no Postgres is started here at all (ADR-0734, ADR-0735 D4).
    const opened = await openAppLibrary({
      home: home.dir,
      startLocal: () => start({ dataDir: home.pgdata, owner: APP_OWNER, bin: postgresBinaries(), log: (message) => console.log(`Postgres: ${message}`) }),
      connect,
    });
    ({ storytree, postgres } = opened);
    console.log(`library: ${opened.where}`);
    reads = pageReads({ storytree, transcriptCacheHome: path.join(home.dir, "transcripts") });
    projects = projectSelection({ listProjects: async () => projectsOnThisComputer(await opened.storytree.projectIdentities(), home.dir), file: path.join(home.dir, "project-choice.json") });
    project = (await projects.read(args.project)).current;
    if (!args.smoke) recordLaunch();
  } catch (error) {
    problem =
      error instanceof DataDirInUseError
        ? `The app's library (${error.dataDir}) is in use by ${error.owner ?? "another program"} (process ${error.pid}). ` +
          "Close that, then open the app again."
        : `The app's library could not be opened: ${messageOf(error)}`;
    console.error(problem);
  }
  build = await whichBuild();
  const dir = slot === undefined ? undefined : path.join(home.runtime, slot);
  const running = slot === undefined || dir === undefined ? undefined : { slot, dir, sha: await slotSha(dir) };
  const canRestart = async () => shutDown === undefined
    && (postgres === undefined || !(await seedWriting(postgres.url)))
    && shutDown === undefined && (backups?.canRestart() ?? true);
  updates = mainUpdates({
    runtimeDir: home.runtime, runningBuild: build,
    ...(running === undefined ? {} : { running }),
    prepare: async () => {
      if (running !== undefined && storytree !== undefined) {
        await refreshOwnHealth({ running, home: home.dir, log: line => console.log(line) });
      }
    },
    canRestart,
    restart: next => lifecycle.restart(
      { execPath: electronIn(next.dir), args: [appDirIn(next.dir)] },
      BrowserWindow.getAllWindows().some(window => window.isVisible()),
    ),
    update: checkedUpdate(updateToMain, {
      build: buildApp,
      shaOf: slotSha,
      startCheck: next => startsCleanly({ execPath: electronIn(next), args: [appDirIn(next)] }),
    }),
    log: line => console.log(line),
  });
  ipcMain.handle(CHANNELS.checkForUpdates, (_event, action: unknown) => (releases ?? updates!).request(action));
  // The installed app opens at sign-in, in the tray, unless the user turned that off (lifecycle 1.12).
  const signingIn = signIn({ installed: !args.smoke && installedApp(), file: path.join(home.dir, "sign-in.json"), loginItems: { set: (item) => app.setLoginItemSettings(item) } });
  ipcMain.handle(CHANNELS.readSignIn, () => signingIn.read());
  ipcMain.handle(CHANNELS.setSignIn, (_event, on: unknown) => signingIn.set(on));
  // When a downloaded release may install itself (updates 4.13): meaningful only where releases install.
  const installing = installChoice({ available: !args.smoke && installedApp(), file: path.join(home.dir, "install-choice.json") });
  ipcMain.handle(CHANNELS.readInstallChoice, () => installing.read());
  ipcMain.handle(CHANNELS.setInstallChoice, (_event, choice: unknown) => installing.set(choice));
  console.log(`storytree 0.3: ${build}`);
  windowQuery = { ...(problem === undefined ? {} : { problem }) };
  if (args.smoke) await smoke(openWindow(windowQuery), project);
  else {
    if (!args.background) openWindow(windowQuery);
    showTray();
    addStartMenuShortcut();
    try { signingIn.apply(); } catch (error) { console.error(`opening at sign-in: ${messageOf(error)}`); }
    if (storytree !== undefined) backups = keepBackups({ storytree, dir: home.backups, log: line => console.log(line) });
    // The app looks at each project's branches itself, once a minute, so its sessions list never waits on a hook's look (agent link 4.21).
    setInterval(() => void reads?.lookAround(), LOOK_EVERY_MS).unref();
    updates.start();
    const launchedAt = Date.now();
    releases = followReleases({
      restart: lifecycle.restart,
      canRestart,
      // Installing stops the app and its database for a minute or two: not under a user or an agent.
      quiet: async () => {
        const now = Date.now();
        const clock = new Date(now);
        const showing = BrowserWindow.getAllWindows().some(window => window.isVisible() && !window.isMinimized());
        const agent = storytree === undefined ? undefined : await agentActiveAt(storytree);
        return whenToInstall({
          now, launchedAt, choice: installing.read().choice, minuteOfDay: clock.getHours() * 60 + clock.getMinutes(),
          ...(showing ? { windowActiveAt: now - powerMonitor.getSystemIdleTime() * 1000 } : {}),
          ...(agent === undefined ? {} : { agentActiveAt: agent }),
        }) === "now";
      },
    }, home.dir);
  }
}

/** The tray icon, whose menu brings the window back or quits the app. */
function showTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`storytree 0.3 · ${build}`);
  const actions = { show: showWindow, quit: () => app.quit() };
  tray.setContextMenu(Menu.buildFromTemplate(TRAY_MENU.map((item) => ({ label: item.label, click: actions[item.id] }))));
  tray.on("click", showWindow);
}

/** Bring the window forward, opening it again on the same project if it was closed. */
function showWindow(): void {
  if (shutDown !== undefined) return;
  const [open] = BrowserWindow.getAllWindows();
  const window = open ?? openWindow(windowQuery);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Record how this app was started, so that an agent's session start can open it again when it is
 * closed (the agent link's setup check). A packaged portable build runs from a temporary copy, so
 * the portable file itself is what is recorded; in development, Electron and the app's folder.
 */
function recordLaunch(): void {
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
  const record = launchToRecord({
    runtimeDir: home.runtime,
    appPath: app.getAppPath(),
    execPath: process.execPath,
    ...(app.isPackaged ? { packaged: portableFile === undefined ? {} : { portableFile } } : {}),
    followsMainSetUp: (["a", "b"] as const).some((name) => existsSync(path.join(appDirIn(path.join(home.runtime, name)), "node_modules", "electron", "path.txt"))),
  });
  if (record === undefined) {
    console.log(`not recording how to open the app: ${home.launchRecord} stays with the app that follows merged main`);
    return;
  }
  try {
    // With its own process id: on a Cloud SQL library there is no local database's owner record, so
    // this is how `storytree app quit` finds the running app (app lifecycle 1.11).
    writeFileSync(home.launchRecord, `${JSON.stringify({ ...record, pid: process.pid }, null, 2)}\n`);
  } catch (error) {
    console.error(`recording how to open the app: ${messageOf(error)}`);
  }
}

/** Which build this is, for the title and the tray: main's commit, a version, or the checkout. */
async function whichBuild(): Promise<string> {
  if (app.isPackaged) return buildLabel({ runtimeDir: home.runtime, appPath: app.getAppPath(), packaged: { version: app.getVersion() } });
  const sha = await slotSha(app.getAppPath()).catch(() => undefined);
  return buildLabel({ runtimeDir: home.runtime, appPath: app.getAppPath(), ...(sha === undefined ? {} : { sha }) });
}

/**
 * On Windows, the app that follows merged main keeps a Start menu entry, "storytree 0.3", pointing
 * at the build now running, so opening it never means reading app.json by hand. Only for the real
 * home: an app pointed at a throwaway one (STORYTREE_HOME) leaves the Start menu alone.
 */
function addStartMenuShortcut(): void {
  if (process.platform !== "win32" || slot === undefined || (process.env.STORYTREE_HOME ?? "") !== "") return;
  const link = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "storytree 0.3.lnk");
  const written = shell.writeShortcutLink(link, existsSync(link) ? "replace" : "create", {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    cwd: path.dirname(process.execPath),
    description: `storytree 0.3 (${build})`,
  });
  if (!written) console.error(`could not write the Start menu entry ${link}`);
}

/**
 * Start the app again once this one has stopped (a restart into a newer build, or a start that
 * arrived while it was quitting): `target`, or this same build.
 */
function relaunch(target: Launch | undefined, inBackground: boolean): void {
  const own = process.argv.slice(1).filter((arg) => arg !== "--background");
  app.relaunch({
    ...(target === undefined ? {} : { execPath: target.execPath }),
    args: [...(target === undefined ? own : target.args), ...(inBackground ? ["--background"] : [])],
  });
}

/** Also append everything the app says to `file`, stamped with the time. */
function logTo(file: string): void {
  for (const level of ["log", "error"] as const) {
    const write = console[level].bind(console);
    console[level] = (...parts: unknown[]) => {
      write(...parts);
      try {
        appendFileSync(file, `${new Date().toISOString()} ${format(...parts)}\n`);
      } catch {
        // a log that cannot be written must never stop the app
      }
    };
  }
}

/** The Postgres binaries: shipped in the packaged app's resources, or from node_modules in development. */
function postgresBinaries(): string {
  return app.isPackaged
    ? findBinaries({ dir: path.join(process.resourcesPath, "postgres", "bin") })
    : findBinaries({ resolveFrom: app.getAppPath() });
}

/** The page's reads, once the library is open. */
function open(): PageReads {
  if (reads === undefined) throw new Error("the library is not open");
  return reads;
}

function openWindow(query: { project?: string; problem?: string }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "storytree 0.3",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17191c" : "#fbfbfa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // The page is the app: it never navigates away or opens other windows.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (!args.smoke) window.once("ready-to-show", () => window.show());
  // The page names the project; the title adds which build this is.
  window.setTitle(`storytree 0.3 · ${build}`);
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    window.setTitle(build === "" ? title : `${title} · ${build}`);
  });
  void window.loadFile(path.join(__dirname, "renderer", "index.html"), { query });
  return window;
}

/**
 * The smoke check: wait for the page, screenshot it, print its text, and judge the surface on show
 * by what it says it drew (@storytree/app's smokeProblems).
 */
async function smoke(window: BrowserWindow, project: string | undefined): Promise<void> {
  let code = 1;
  try {
    const state = await pageState(window);
    project = await window.webContents.executeJavaScript("document.body.dataset.project") as string | undefined;
    // Open one capability, as a click would, so the screenshot shows contracts too: the first
    // whose verified column is not passing, else the first.
    const opened = (await window.webContents.executeJavaScript(`(() => {
      const all = [...document.querySelectorAll("details.capability")];
      const pick = all.find((node) => node.querySelector("summary [data-column=verified] .badge-passing") === null) ?? all[0];
      if (pick === undefined) return null;
      pick.querySelector("summary").click();
      return { title: pick.querySelector("summary .row-title").innerText, contracts: pick.querySelectorAll("[data-contract-id]").length };
    })()`)) as { title: string; contracts: number } | null;
    // A surface switched off draws nothing to judge (ADR-0750); the forest's globe is always on.
    const read = await surfacesActions(SURFACES, home.dir).readSurfaces();
    const arcsOn = !read.ok || surfaceOn(read.value, "arcs");
    const arcProblems = project !== undefined && state === "ready" && arcsOn ? await smokeArcSurface(window.webContents, project, open()) : [];
    if (state === "ready" && args.forestMode !== undefined) {
      const mode = args.forestMode;
      await window.webContents.executeJavaScript(`(async () => {
        const button = document.querySelector('.forest-views [data-forest-mode="${mode}"]');
        if (!button) throw new Error('Forest mode control is missing');
        button.click();
        for (let tries = 0; tries < 100; tries++) {
          if (button.getAttribute('aria-pressed') === 'true') return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Forest mode did not change to ${mode}');
      })()`);
      console.log(`smoke: globe mode ${mode}`);
    }
    const page = (await window.webContents.executeJavaScript(`(() => ({
      text: document.body.innerText,
      drew: document.body.dataset.drew,
    }))()`)) as { text: string; drew?: string };

    // A screenshot holds only what is in view, so the window is made as tall as the page first.
    const [width] = window.getContentSize();
    const height = Number(await window.webContents.executeJavaScript("document.documentElement.scrollHeight"));
    window.setContentSize(width ?? 1120, Math.min(Math.max(height, 480), 4000));
    // A window that was never shown does not composite a WebGL canvas (the forest), so it is shown,
    // without taking focus, before the screenshot, and given a moment to paint.
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 800));
    let image = await window.webContents.capturePage();
    if (image.isEmpty()) {
      window.showInactive(); // some systems will not paint a window that has never been shown
      await new Promise((resolve) => setTimeout(resolve, 500));
      image = await window.webContents.capturePage();
    }
    if (args.screenshot !== undefined) {
      const file = path.resolve(args.screenshot);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, image.toPNG());
      console.log(`smoke: screenshot ${file} (${image.getSize().width}x${image.getSize().height})`);
    }
    process.stdout.write(`${page.text.trim()}\n`);
    if (opened !== null) console.log(`smoke: opened "${opened.title}", showing its ${opened.contracts} contract(s)`);

    const tree = project === undefined || state !== "ready" ? undefined : await open().projectTree(project);
    const problems = [...smokeProblems(state, tree, page.drew), ...arcProblems];
    if (problems.length === 0 && tree !== undefined) {
      console.log(`smoke: project "${project}": ${drewText(tree, page.drew)}`);
      code = 0;
    } else {
      for (const problem of problems) console.error(`smoke: ${problem}`);
    }
  } catch (error) {
    console.error(`smoke: ${messageOf(error)}`);
  } finally {
    await lifecycle.quit(code);
  }
}

/** Wait until the page has finished loading its project (or found it cannot), and return its state. */
async function pageState(window: BrowserWindow): Promise<string> {
  for (;;) {
    const state = window.webContents.isLoading()
      ? "loading"
      : String(await window.webContents.executeJavaScript("document.body?.dataset.state ?? 'loading'"));
    if (state !== "loading") return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A passing check's summary: which surface drew the project's stories, and how many capabilities. */
function drewText(tree: AnnotatedTree, drew: string | undefined): string {
  const { surface } = JSON.parse(drew ?? "{}") as { surface?: string };
  const capabilities = tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0);
  return `the ${surface ?? "surface"} drew ${tree.stories.map((story) => `story "${story.title}"`).join(", ")} and all ${capabilities} capabilities`;
}

/** Close the library and stop Postgres. Safe to call more than once. */
function shutdown(): Promise<void> {
  updates?.stop();
  backups?.stop();
  shutDown ??= (async () => {
    await journey?.finish();
    await reads?.close().catch((error: unknown) => console.error(`closing the projects: ${messageOf(error)}`));
    reads = undefined;
    await storytree?.close().catch((error: unknown) => console.error(`closing the library: ${messageOf(error)}`));
    storytree = undefined;
    await postgres?.stop().catch((error: unknown) => console.error(`stopping Postgres: ${messageOf(error)}`));
    postgres = undefined;
  })();
  return shutDown;
}

function fail(error: unknown): void {
  journey?.record("error");
  console.error(`storytree 0.3: ${messageOf(error)}`);
  void lifecycle.quit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
