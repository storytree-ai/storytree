/**
 * Capability 1 · Lifecycle. The storytree 0.3 desktop app's main process. It starts the app's own Postgres on its data
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
 * Installed, the app takes published releases on its channel (./releases.ts), installing them when the user's install
 * choice allows; a development copy run from a checkout does not update itself.
 *
 * While it runs, it keeps a snapshot of every project, taken at start and once a day (ADR-0641 B1),
 * in ~/.storytree/0.3/backups: @storytree/app's keepBackups, which holds restarts while writing.
 *
 * `--start-check` goes as far as registering the main process's handlers and exits 0 without opening the library: the
 * release's install checks start the installed build with it, so a release that cannot start never publishes
 * (./start-check.ts). With `--page-check` too, it first loads the page hidden and hears its road worker answer, or exits 1
 * saying why (./page-scheme.ts, contract 1.41). A start that fails ends the app.
 *
 * `--callback-check` holds the single-instance lock with no window and no library, and prints a line for each sign-in
 * callback a later start hands it, saying whether it reached the sign-in session (./callback-check.ts): CI's proof that a
 * deep link reaches the running app, with no live sign-in.
 *
 * `--smoke` renders the project without showing a window, saves a screenshot to the file given
 * with `--screenshot <file>`, prints the page's text to stdout, and quits: exit 0 only if the
 * surface on show says it drew every story of the project and every one of its capabilities. With `--stress <rounds>` it
 * then closes and reopens its window at awkward moments before it quits (./smoke-stress.ts), and any main-process error
 * it logs, while it quits included, turns its exit red; it never waits on an error box (./smoke-verdict.ts, contract 1.30).
 * It prints a `smoke:` line as each phase starts, keeps Electron's files in a scratch folder of its own, and a run that gives
 * up names the phase it was stuck in (./smoke-phases.ts, contract 1.36).
 */
import { smokeArcSurface } from "@storytree/arc-surface";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The app's surfaces (ADR-0750), in the Surfaces menu's order: the plugin loader composes them into the bundle
// from the manifests of the story packages this app depends on (ADR-1021; build.mjs).
import NAMED_SURFACES from "#parts/namedSurfaces";
import SURFACES from "#parts/surfaces";
// The page operations the stories' manifests name, composed in the same way, with the channels they travel on.
import PAGE_ANSWERS from "#parts/pageAnswers";
import PAGE_CHANNELS from "#parts/pageChannels";
// The records the stories keep for a project outside its library, which Delete forgets with it (ADR-1170 D2).
import PROJECT_RECORDS from "#parts/projectRecords";
import { standIn } from "@storytree/plugin-loader/factory";
import { mount } from "@storytree/plugin-loader/switch";
import { readPartsOff, readStandIns } from "@storytree/project-and-caller";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, protocol, safeStorage, shell, Tray } from "electron";

import {
  agentActiveAt,
  background,
  thisBuild,
  keepBackups,
  buildLabel,
  checkoutSha,
  installedAppDir,
  launchToRecord,
  loginItemsFor,
  noUpdates,
  openAppLibrary,
  pageReads,
  PAGE_READS_CHANNELS,
  projectSelection,
  seedWriting,
  signIn,
  smokeProblems,
  surfaceOn,
  surfacesActions,
  SURFACES_CHANNELS,
  TRAY_MENU,
  quietMoment,
  installChoice,
  type Launch,
  type PageReads,
} from "@storytree/app";
import { projectsOnThisComputer, setupHelpActions } from "@storytree/app-setup";
import { FEEDBACK_IDENTITY_CHANNELS, FEEDBACK_IDENTITY_OFFERED, SETUP_HELP_CHANNELS } from "@storytree/app-setup/bridge";
import { createJourneyRuntime, type JourneyRuntime } from "@storytree/app-setup/journey-events/runtime";
import { JOURNEY_CHANNELS } from "@storytree/app-setup/journey-events/bridge";
import { LIFECYCLE_CHANNELS } from "@storytree/app/lifecycle/bridge";
import { restartLimit } from "@storytree/app/lifecycle/restart-limit";
import { PROJECTS_CHANNELS } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS } from "@storytree/app/updates/bridge";
import { sourceVersion } from "@storytree/app/version";
import { connect, type AnnotatedTree, type Storytree } from "@storytree/library";
import { DataDirInUseError, findBinaries, start, type LocalPostgres } from "@storytree/local-postgres";
import {
  AUTH_CALLBACK,
  AUTH_SCHEME,
  callbackSession,
  callbackUrls,
  createFeedbackIdentity,
  feedbackIdentityConfig,
  type CallbackSession,
  type FeedbackIdentityConfig,
} from "@storytree/project-and-caller/identity/desktop";
import { createDefaultStorage } from "@workos/authkit-electron";
import { createCeremony, createPublicWorkOS, createSessionManager, registerProtocol, toAuthKitConfig } from "@workos/authkit-electron/internals";
import { AuthKitCore, AuthOperations, sessionEncryption } from "@workos/authkit-session";

import { APP_OWNER, appHome } from "../home.js";
import { answerPage, answerPageParts, declaredSurfaces, sayOutagesOnce, STAND_INS_OFFERED } from "../page-operations.js";
import { parseArgs } from "./args.js";
import { registersSignInScheme, routeCallback } from "./callback-check.js";
import { answerAppEvents, answerCallbackCheckEvents } from "./app-events.js";
import { iconColourway } from "./app-icon.js";
import { createTrayIcon, createWindowIcon } from "./tray-icon.js";
import { channelChoice, followReleases, installedApp, releasesInstall } from "./releases.js";
import { keepDrawingThroughGpuResets } from "./gpu-resets.js";
import { askToReportErrors, mainErrorRecords, reportBox } from "./main-error-records.js";
import { logMainErrors } from "./main-errors.js";
import { logPageErrors } from "./page-errors.js";
import { smokeElectronFiles, smokePhases } from "./smoke-phases.js";
import { stressWindow, windowSteps } from "./smoke-stress.js";
import { smokeVerdict } from "./smoke-verdict.js";
import { lateReads, projectAnswers } from "./late-reads.js";
import { keepPageInWindow } from "./page-window.js";
import { keepTray } from "./tray.js";
import { titleWindow } from "./window-title.js";
import { bringWindowForward } from "./window-shown.js";
import { PLUGIN_SCHEME, pluginResponse, windowKinds, windowStandIns } from "./stand-ins.js";
import { checkPage, PAGE_SCHEME, pageResponse, pageUrl } from "./page-scheme.js";
import { finishStartCheck, runWhenReady } from "./start-check.js";
import { answerStartMarks, processLaunchedAt, startMarks } from "./start-marks.js";
import { appLog, teeConsole } from "./app-log.js";
import { START_MARK } from "../bridge.js";

// A build that offers sign-in for feedback stamps in its public WorkOS client ID (build.mjs); others stamp none.
declare const STORYTREE_WORKOS_CLIENT_ID: string | undefined;

// The main process's own uncaught errors reach the log (app.log once teeConsole runs below, stderr in the checks), before startup work can throw.
// The box then offers Keep going or Restart; before the app is ready only the error box can show, so it keeps going.
// Each is also kept in the user's own library on every install, held until it opens (lifecycle 1.25), naming the build
// once it is known and the app's version before.
/** Which build this is (`main 80bcc63`, or the development checkout), shown in the title and the tray. */
let build = "";
const args = parseArgs(process.argv, { packaged: app.isPackaged, env: process.env });
// In a smoke check, every main-process error logged turns its exit red, and no error box waits for a person (lifecycle 1.30).
const verdict = smokeVerdict({ smoke: args.smoke, log: line => console.error(line) });
// A smoke check says each phase as it starts, so one that never reaches its page shows where it stopped (lifecycle 1.36).
const phases = smokePhases({ log: line => { if (args.smoke) console.log(line); } });
phases.phase("launched");
const errorRecords = mainErrorRecords({ build: () => build || app.getVersion(), log: line => console.error(line) });
logMainErrors(process, {
  log: verdict.error,
  record: errorRecords.record,
  ask: verdict.asking(async ({ title, message, detail, buttons }) => {
    if (!app.isReady()) {
      dialog.showErrorBox(title, `${message}\n\n${detail}`);
      return "keep-going";
    }
    const { response } = await dialog.showMessageBox({ type: "error", title, message, detail, buttons: [...buttons], defaultId: 0, cancelId: 0, noLink: true });
    return response === 1 ? "restart" : "keep-going";
  }),
  restart: () => {
    const appImage = process.env.APPIMAGE;
    lifecycle.restart(
      thisBuild({ execPath: process.execPath, argv: process.argv, ...(appImage === undefined ? {} : { appImage }) }),
      BrowserWindow.getAllWindows().some(window => window.isVisible()),
    ).catch((error: unknown) => console.error(messageOf(error)));
  },
});

const home = appHome();
/** app.log beside the app's data, bounded (contract 1.34): an installed app has no terminal, so what it says is kept here. */
const log = appLog(path.join(home.dir, "app.log"));
// The release's checks and the smoke check say what they say on stderr only, as before.
if (!args.smoke && !args.startCheck && !args.callbackCheck) teeConsole(console, log);
/** This start's timing marks, kept in app.log (contract 1.33); the release's checks write none. */
const marks = args.startCheck || args.callbackCheck ? { mark() {} } : startMarks({ launchedAt: processLaunchedAt(), log });
/** How long the smoke check may take, start to finish, before it gives up. */
const SMOKE_TIMEOUT_MS = 180_000;

// Electron's own files (cache, local storage) live in the app's home too, apart from any other app. A smoke check keeps
// them in a scratch folder instead: an app already open on this computer holds the home's (lifecycle 1.36).
// It is removed as the app exits; what Chromium writes after that, a later smoke run sweeps.
const scratch = args.smoke ? smokeElectronFiles({ shared: home.electron, tmp: tmpdir() }) : undefined;
if (scratch !== undefined) console.log(scratch.line);
app.setPath("userData", scratch?.dir ?? home.electron);
// The machine's GPU resets must not leave the globe white until a restart.
keepDrawingThroughGpuResets(app);

/** Sign-in for feedback (app setup contract 5.6): offered only when this build carries both public settings. */
const identityConfig = feedbackIdentityConfig(STORYTREE_WORKOS_CLIENT_ID);
let signInSession: CallbackSession | undefined;
/** Sign-in callbacks that arrived before the session was made (macOS delivers a cold start's before ready). */
const earlyCallbacks: string[] = [];

let postgres: LocalPostgres | undefined;
let storytree: Storytree | undefined;
let reads: PageReads | undefined;
/** How often the app looks at each project's branches itself; the look is shared with the hooks', once a minute a machine. */
const LOOK_EVERY_MS = 60_000;
let projects: ReturnType<typeof projectSelection> | undefined;
let shutDown: Promise<void> | undefined;
let backups: ReturnType<typeof keepBackups> | undefined;
let journey: JourneyRuntime | undefined;
/** The parts this computer switches off, read once as the app starts (ADR-1095). */
let partsOff: readonly string[] = [];
/** The window's parts with the factory plugins standing in for switched-off parts composed in, as the app starts. */
let parts = windowStandIns({ surfaces: SURFACES, pageAnswers: PAGE_ANSWERS, pageChannels: PAGE_CHANNELS }, { plugins: {} }, []);
/** An installed app's release updater, which answers the gear's Updates panel in its place. */
let releases: ReturnType<typeof followReleases>;
/** What the window was opened with, so it can be opened again after it is closed. */
let windowQuery: { project?: string; problem?: string } = {};
/** Held here so it is not garbage-collected, which would remove the icon. */
let tray: Tray | undefined;
const lifecycle = background({
  // End every renderer (project polling and live reading) before closing what it reads.
  stopPages: () => void verdict.stopping("the pages", () => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }),
  stopDatabase: () => verdict.stopping("the database", shutdown),
  exit: (code) => {
    scratch?.remove();
    app.exit(verdict.exitCode(code));
  },
  relaunch,
  // After five restarts in a row the app stops restarting itself, and the stop is an error the user is asked to report (lifecycle 1.32).
  ...(args.smoke || args.startCheck || args.callbackCheck ? {} : {
    limit: restartLimit({ file: path.join(home.dir, "restarts.json"), stopped: message => errorRecords.record("restarts-stopped", message) }),
  }),
});

if (!args.smoke && !args.startCheck && !app.requestSingleInstanceLock()) {
  app.quit(); // the app is already open: that one is focused instead (or, with --quit, quits)
} else if (args.quit) {
  app.exit(0); // asked to quit, and none is running: start nothing
} else if (args.callbackCheck) {
  // Hold the lock with no window or library, and report each callback a later start hands over; a later `--quit` ends it.
  answerCallbackCheckEvents(app, process, { deliver: deliverCallback, exit: (code) => app.exit(code) });
  void runWhenReady(app.whenReady(), checkCallbacks, fail);
} else {
  // A second start shows the window; one that arrives while the app is quitting or restarting opens
  // it again once it has stopped, instead of being lost. Closing the last window leaves the app, and its
  // database, running in the background; quitting waits for Postgres to stop.
  answerAppEvents(app, process, { deliver: deliverCallback, lifecycle, showWindow, quitApp: () => app.quit() });
  if (args.smoke) {
    setTimeout(() => {
      console.error(phases.gaveUp(SMOKE_TIMEOUT_MS));
      void lifecycle.quit(1);
    }, SMOKE_TIMEOUT_MS).unref();
  }
  // The page is served over the app's own scheme, and a stand-in's views over the window's; both must be named before
  // the app is ready. The page needs no file:// privileges, so the packaged app turns them off (contract 1.41).
  protocol.registerSchemesAsPrivileged([
    { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
  // A failure in run, not only in whenReady, ends the app: half-started, it would hold the lock with no handlers.
  void runWhenReady(app.whenReady(), run, fail);
}

async function run(): Promise<void> {
  marks.mark("app ready");
  phases.phase("starting the app's handlers");
  answerStartMarks(ipcMain, START_MARK, marks);
  // Every page operation is answered through one outage guard: a library that cannot be reached is said once in app.log, not a stack per poll (1.40).
  const page = sayOutagesOnce(ipcMain, (line) => console.error(line));
  // The bundled main is CommonJS with no import.meta, so its own build is named from Electron when packaged and from the checkout at its app path otherwise.
  const appVersion = app.isPackaged ? app.getVersion() : (sourceVersion(app.getAppPath())?.version ?? "0.3.0");
  // The journey stays in the frame, not in a manifest (ADR-1030 D4): the frame is its client too, telling it of the launch,
  // an added project, a failure and the quit, so the frame makes the one runtime and answers the page with it.
  journey = createJourneyRuntime({ home: home.dir, appVersion });
  answerPage(page, JOURNEY_CHANNELS, journey);
  // The tree the page last read for each project, which the code survey surveys rather than reading it a second time.
  const treesRead = new Map<unknown, AnnotatedTree>();
  // The parts this computer switches off (ADR-1095), read as the app starts: their surfaces and page operations are not mounted.
  partsOff = readPartsOff(home.dir);
  // A factory plugin named to stand in for a switched-off part is mounted in its place, read from the factory as the app starts.
  parts = windowStandIns({ surfaces: SURFACES, pageAnswers: PAGE_ANSWERS, pageChannels: PAGE_CHANNELS }, readStandIns(home.dir), partsOff);
  ipcMain.on(STAND_INS_OFFERED, (event) => { event.returnValue = parts.page; });
  protocol.handle(PAGE_SCHEME, (request) => pageResponse(request.url, path.join(__dirname, "renderer")));
  protocol.handle(PLUGIN_SCHEME, (request) => pluginResponse(request.url, parts.served));
  // The page operations the stories' manifests name, each answered with what the frame offers (ADR-1021, ADR-1030 D2).
  answerPageParts(page, parts.pageAnswers, parts.pageChannels, {
    home: home.dir,
    appVersion,
    library: open,
    treeRead: (project) => treesRead.get(project),
    surveyWorker: path.join(__dirname, "survey-worker.cjs"),
    declaredSurfaces: declaredSurfaces([SURFACES, NAMED_SURFACES], partsOff),
    server: () => storytree,
    // capturePage pictures the app's own page, so no screen-recording permission is asked for on any system.
    captureWindow: async (rect) => {
      const shown = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed() && each.isVisible());
      return shown === undefined ? undefined : new Uint8Array((await shown.webContents.capturePage(rect)).toJPEG(70));
    },
  }, partsOff);
  if (!args.smoke && !args.startCheck) journey.desktopStarted(installedApp());
  const surfaces = surfacesActions(mount(parts.surfaces, partsOff).mounted, home.dir);
  answerPage(page, SURFACES_CHANNELS, surfaces);
  // Setup help stays in the frame (ADR-1030 D4): its actions need Electron's dialog, shell and clipboard, the license
  // file's path and the open library, and adding a project also tells the journey, which the frame holds.
  const help = setupHelpActions({
    licenseFile: path.join(app.isPackaged ? process.resourcesPath : __dirname, "LICENSE"),
    storytreeHome: home.dir,
    // The guide connects agents to the tools the app carries, when the installer recorded none (ADR-1162 D3).
    agentTools: path.join(app.isPackaged ? process.resourcesPath : __dirname, "agent-tools"),
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
    projectRecords: mount(standIn(PROJECT_RECORDS, "projectRecords", readStandIns(home.dir)), partsOff).mounted,
  });
  // Adding a project also tells the journey, so the frame composes that answer from the two stories'.
  answerPage(page, SETUP_HELP_CHANNELS, { ...help, addProject: () => help.addProject().then(result => journey!.afterProjectAdded(result)) });
  // Sign-in for feedback, when this build offers it: the page asks for it before it loads, and gets only an id and an email.
  // It stays in the frame (ADR-1030 D4): the preload asks whether it is offered before the page loads, and its sign-in
  // returns through the frame's own app events (open-url, second-instance) and the protocol the frame registers.
  const feedbackIdentity = identityConfig === undefined ? undefined : startFeedbackIdentity(identityConfig);
  ipcMain.on(FEEDBACK_IDENTITY_OFFERED, (event) => { event.returnValue = feedbackIdentity !== undefined; });
  if (feedbackIdentity !== undefined) {
    answerPage(page, FEEDBACK_IDENTITY_CHANNELS, feedbackIdentity);
    if (registersSignInScheme(args, true)) {
      registerProtocol(AUTH_SCHEME);
      for (const url of [...earlyCallbacks.splice(0), ...callbackUrls(process.argv)]) deliverCallback(url);
    }
  }

  answerPage(page, PROJECTS_CHANNELS, projectAnswers({ reads: () => reads, projects: () => projects }));
  // Each read asks the library open by then: these are answered before it opens, and again after it reopens.
  answerPage(page, PAGE_READS_CHANNELS, {
    ...lateReads(Object.keys(PAGE_READS_CHANNELS) as (keyof typeof PAGE_READS_CHANNELS & keyof PageReads)[], open),
    projectTree: async (name: unknown) => {
      const tree = await open().projectTree(name);
      treesRead.set(name, tree);
      return tree;
    },
  });

  if (args.startCheck) {
    if (args.pageCheck) {
      const { window, loaded } = pageWindow({});
      const problem = await checkPage(loaded, window.webContents);
      if (problem !== undefined) {
        console.error(`page check: ${problem}`);
        app.exit(1);
        return;
      }
      console.log("page check: the page loaded and its road worker answered");
    }
    await finishStartCheck((code) => app.exit(code));
    return;
  }

  let problem: string | undefined;
  let project: string | undefined;
  let errorsOpened: Promise<void> | undefined;
  try {
    phases.phase("opening the library");
    // Where the library lives is the user's library setting: this app's own Postgres (the default),
    // or a Cloud SQL instance, when no Postgres is started here at all (ADR-0734, ADR-0735 D4).
    const opened = await openAppLibrary({
      home: home.dir,
      startLocal: () => start({ dataDir: home.pgdata, owner: APP_OWNER, bin: postgresBinaries(), log: (message) => console.log(`Postgres: ${message}`) }),
      connect,
    });
    ({ storytree, postgres } = opened);
    errorsOpened = errorRecords.open(opened.storytree);
    console.log(`library: ${opened.where}`);
    marks.mark("library open");
    // Each project is opened with the kinds of record the factory plugins mounted here declare (ADR-1178 D3).
    const kinds = windowKinds(SURFACES.graph, readStandIns(home.dir), partsOff, (line) => console.log(line));
    reads = pageReads({ storytree, transcriptCacheHome: path.join(home.dir, "transcripts"), kinds });
    const pages = reads;
    projects = projectSelection({
      listProjects: async () => projectsOnThisComputer(await opened.storytree.projectIdentities(), home.dir),
      file: path.join(home.dir, "project-choice.json"),
      // The app bar's switch to the factory and back reads each project's lineage through the libraries the page reads keep open.
      lineageOf: (name) => pages.projectLineage(name),
      buildsItself: (name) => pages.projectBuildsItself(name),
    });
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
  const canRestart = async () => shutDown === undefined
    && (postgres === undefined || !(await seedWriting(postgres.url)))
    && shutDown === undefined && (backups?.canRestart() ?? true);
  // When an update may install itself (updates 4.13): offered only where releases install themselves.
  const installing = installChoice({ available: !args.smoke && releasesInstall(), file: path.join(home.dir, "install-choice.json") });
  // Which release channel the updater follows (updates 4.24): stable unless the user opts in to alpha.
  const channels = channelChoice(home.dir, !args.smoke);
  // Restarting into an update stops the app and its database for a minute or two: not under a user or an agent (4.4).
  const quiet = quietMoment({
    launchedAt: Date.now(),
    choice: () => installing.read().choice,
    windowActiveAt: () => BrowserWindow.getAllWindows().some(window => window.isVisible() && !window.isMinimized())
      ? Date.now() - powerMonitor.getSystemIdleTime() * 1000 : undefined,
    agentActiveAt: async () => storytree === undefined ? undefined : await agentActiveAt(storytree),
    log: (line) => console.error(line),
  });
  // The installed app opens at sign-in, in the tray, unless the user turned that off (lifecycle 1.12). An installed Mac app
  // (updates 4.21) does too, through its LaunchAgent; the journey's desktopStarted uses installedApp as Windows does.
  // The install choice is offered only where releases install themselves, which an ad-hoc Mac build does not.
  // On Linux the autostart entry starts the AppImage itself (APPIMAGE), not the executable inside its mount, which is gone
  // once it quits, and keeps the menu entry's --no-sandbox where the kernel blocks the sandbox; appData there is
  // $XDG_CONFIG_HOME, or ~/.config.
  const signingIn = signIn({ installed: !args.smoke && installedApp(), file: path.join(home.dir, "sign-in.json"), loginItems: loginItemsFor(process.platform, {
    electron: { set: (item) => app.setLoginItemSettings(item) },
    execPath: process.env.APPIMAGE ?? process.execPath,
    launchAgents: path.join(app.getPath("home"), "Library", "LaunchAgents"),
    autostart: path.join(app.getPath("appData"), "autostart"),
    sandboxOff: app.commandLine.hasSwitch("no-sandbox"),
  }) });
  answerPage(page, LIFECYCLE_CHANNELS, { readSignIn: () => signingIn.read(), setSignIn: (on: unknown) => signingIn.set(on) });
  answerPage(page, UPDATES_CHANNELS, {
    checkForUpdates: (action: unknown) => (releases ?? noUpdates(() => build)).request(action),
    readInstallChoice: () => installing.read(),
    setInstallChoice: (choice: unknown) => installing.set(choice),
    readReleaseChannel: () => channels.read(),
    setReleaseChannel: (channel: unknown) => channels.set(channel),
  });
  console.log(`storytree 0.3: ${build}`);
  windowQuery = { ...(problem === undefined ? {} : { problem }) };
  if (args.smoke) {
    phases.phase("opening the window");
    await smoke(openWindow(windowQuery), project);
  }
  else {
    if (!args.background) openWindow(windowQuery);
    showTray();
    // An error the library holds that is not yet reported asks to be, until it is marked submitted (lifecycle 1.31, ADR-1122).
    void errorsOpened?.then(() => errorRecords.settled())
      .then(() => askToReportErrors(errorRecords, { ask: reportBox(options => dialog.showMessageBox(options)) }))
      .catch((error: unknown) => console.error(`asking to report the app's errors: ${messageOf(error)}`));
    try { signingIn.apply(); } catch (error) { console.error(`opening at sign-in: ${messageOf(error)}`); }
    if (storytree !== undefined) backups = keepBackups({ storytree, dir: home.backups, log: line => console.log(line) });
    // The app looks at each project's branches itself, once a minute, so its sessions list never waits on a hook's look (Session management 4.21).
    setInterval(() => void reads?.lookAround(), LOOK_EVERY_MS).unref();
    releases = followReleases({ restart: lifecycle.restart, canRestart, quiet }, home.dir, () => installing.read().choice);
  }
}

/** The tray icon, whose menu brings the window back or quits the app. */
function showTray(): void {
  // The mark, in the colourway of the taskbar it sits on, worn again when that setting changes (contract 1.17).
  tray = keepTray({
    theme: nativeTheme,
    items: TRAY_MENU,
    build,
    makeTray: (image) => new Tray(image),
    trayIcon: createTrayIcon,
    windowIcon: createWindowIcon,
    windows: () => BrowserWindow.getAllWindows(),
    buildMenu: (items) => Menu.buildFromTemplate(items),
    show: showWindow,
    quit: () => app.quit(),
  });
}

/**
 * Sign-in for feedback through WorkOS's official Electron SDK (app setup contract 5.6, Context 6.5): its session manager, protected storage
 * and system-browser PKCE ceremony, composed here without the SDK's own page bridge, so no token reaches the page. The
 * storytree-auth callback is completed by this app's own deep-link handling, under its own single-instance lock.
 */
function startFeedbackIdentity(config: FeedbackIdentityConfig): ReturnType<typeof createFeedbackIdentity> {
  const authKit = { clientId: config.clientId, redirectUri: AUTH_CALLBACK };
  const storage = createDefaultStorage({ name: "feedback-sign-in" });
  const authKitConfig = toAuthKitConfig(authKit, () => storage.getOrCreateCookiePassword());
  const client = createPublicWorkOS(config.clientId);
  const core = new AuthKitCore(authKitConfig, client, sessionEncryption);
  const operations = new AuthOperations(core, client, authKitConfig, sessionEncryption);
  const manager = createSessionManager({ core, operations, storage, client, clientId: config.clientId, ceremony: createCeremony(authKit) });
  signInSession = callbackSession(
    {
      beginSignIn: () => manager.beginSignIn(),
      completeCallback: (code, state) => manager.completeCallback(code, state),
      getUser: () => manager.getUser(),
      signOut: () => manager.signOut(),
    },
    () => safeStorage.isEncryptionAvailable(),
  );
  return createFeedbackIdentity({ clientId: config.clientId, session: signInSession });
}

/** Hand a sign-in callback to the session, or keep it until the session is made; with no sign-in offered, drop it. */
function deliverCallback(url: string): void {
  routeCallback(url, { offered: identityConfig !== undefined, session: signInSession, early: earlyCallbacks, report: args.callbackCheck ? console.log : undefined });
}

/** A `--callback-check` start once ready: make the sign-in session when this build offers one, then take callbacks. */
async function checkCallbacks(): Promise<void> {
  if (identityConfig !== undefined) startFeedbackIdentity(identityConfig);
  // Claim the scheme as a normal start does, so a callback opened through the OS's protocol handler reaches this app.
  if (registersSignInScheme(args, identityConfig !== undefined)) registerProtocol(AUTH_SCHEME);
  console.log("callback check: waiting for sign-in callbacks");
  for (const url of [...earlyCallbacks.splice(0), ...callbackUrls(process.argv)]) deliverCallback(url);
}

/** Bring the window forward, opening it again on the same project if it was closed. */
function showWindow(): void {
  bringWindowForward(BrowserWindow.getAllWindows(), { stopping: shutDown !== undefined, open: () => openWindow(windowQuery) });
}

/**
 * Record how this app was started, so that an agent's session start can open it again when it is
 * closed (the app setup's setup check). A packaged portable build runs from a temporary copy, and an
 * AppImage from a mount that vanishes when it exits, so the portable file or the AppImage itself is
 * what is recorded; in development, Electron and the app's folder.
 */
function recordLaunch(): void {
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
  const appImage = process.env.APPIMAGE;
  const packaged = {
    ...(portableFile === undefined ? {} : { portableFile }),
    ...(appImage === undefined ? {} : { appImage, sandboxOff: app.commandLine.hasSwitch("no-sandbox") }),
  };
  const record = launchToRecord({
    appPath: app.getAppPath(),
    execPath: process.execPath,
    ...(app.isPackaged ? { packaged } : {}),
    installedHere: installedAppDir(home.dir) !== undefined,
  });
  if (record === undefined) {
    console.log(`not recording how to open the app: ${home.launchRecord} stays with the installed app`);
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

/** Which build this is, for the title and the tray: a version, or the checkout. */
async function whichBuild(): Promise<string> {
  if (app.isPackaged) return buildLabel({ appPath: app.getAppPath(), packaged: { version: app.getVersion() } });
  const sha = await checkoutSha(app.getAppPath()).catch(() => undefined);
  return buildLabel({ appPath: app.getAppPath(), ...(sha === undefined ? {} : { sha }) });
}

/**
 * Start the app again once this one has stopped (a restart into a newer build, or a start that
 * arrived while it was quitting): `target`, or this same build (from an AppImage, the AppImage file).
 */
function relaunch(target: Launch | undefined, inBackground: boolean): void {
  const appImage = process.env.APPIMAGE;
  const launch = target ?? thisBuild({ execPath: process.execPath, argv: process.argv, ...(appImage === undefined ? {} : { appImage }) });
  app.relaunch({ execPath: launch.execPath, args: [...launch.args, ...(inBackground ? ["--background"] : [])] });
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
  return pageWindow(query).window;
}

/** The app's window on its page, and the page's load, which fails if the page cannot be loaded. */
function pageWindow(query: { project?: string; problem?: string }): { window: BrowserWindow; loaded: Promise<void> } {
  const window = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "storytree 0.3",
    icon: createWindowIcon(iconColourway(nativeTheme)),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17191c" : "#fbfbfa",
    autoHideMenuBar: true,
    webPreferences: pageWebPreferences(),
  });
  // The page is the app: it never navigates away, opens other windows or gets a permission.
  keepPageInWindow(window, { headless: args.smoke || args.pageCheck });
  // A failure inside the page (a surface's failed refresh, an uncaught throw) is kept in app.log with the rest.
  logPageErrors(window.webContents, line => console.error(line));
  // The page names the project; the title adds which build this is.
  titleWindow(window, build);
  // The lag instrument measures the catalogue with the page's lag recorder on and off (STORYTREE_LAG_RECORDER=off).
  const recorder = process.env.STORYTREE_LAG_RECORDER === "off" ? { "lag-recorder": "off" } : {};
  window.once("ready-to-show", () => marks.mark("window ready to show"));
  const loaded = window.loadURL(pageUrl({ ...query, ...recorder }));
  loaded.catch(() => { /* the page's own error logging says it; the page check reads it */ });
  return { window, loaded };
}

/** The page's preferences: its preload, isolated and sandboxed, with no Node. */
function pageWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

/**
 * The smoke check: wait for the page, screenshot it, print its text, and judge the surface on show
 * by what it says it drew (@storytree/app's smokeProblems).
 */
async function smoke(window: BrowserWindow, project: string | undefined): Promise<void> {
  let code = 1;
  try {
    phases.phase("waiting for the page");
    const state = await pageState(window);
    phases.phase(`reading the page (${state})`);
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
    const read = await surfacesActions(mount(parts.surfaces, partsOff).mounted, home.dir).readSurfaces();
    const arcsOn = !read.ok || surfaceOn(read.value, "arcs");
    const arcProblems = project !== undefined && state === "ready" && arcsOn ? await smokeArcSurface(window.webContents, project, open()) : [];
    if (state === "ready" && args.forestMode !== undefined) {
      // The Library mode is the globe's Stories switch off (ADR-1002 D2), with its Library switch on: a launch opens it off.
      const mode = args.forestMode, stories = mode === "forest";
      await window.webContents.executeJavaScript(`(async () => {
        if (${!stories}) document.querySelector('.forest-views [data-globe-switch="library"][aria-pressed="false"]')?.click();
        const button = document.querySelector('.forest-views [data-globe-switch="stories"]');
        if (!button) throw new Error('Stories switch is missing');
        if (button.getAttribute('aria-pressed') !== '${stories}') button.click();
        for (let tries = 0; tries < 100; tries++) {
          if (button.getAttribute('aria-pressed') === '${stories}') return;
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

    phases.phase("taking the screenshot");
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
    if (args.stress > 0) phases.phase(`closing and reopening the window ${args.stress} time(s)`);
    // The window is closed and reopened at awkward moments, and the quit below lands while the last one loads.
    await stressWindow(window, args.stress, windowSteps({
      windows: () => BrowserWindow.getAllWindows(),
      reopen: showWindow,
      loaded: pageState,
      log: (line) => console.log(line),
    }));
  } catch (error) {
    code = 1;
    console.error(`smoke: ${messageOf(error)}`);
  } finally {
    phases.phase("quitting");
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
  backups?.stop();
  shutDown ??= (async () => {
    await journey?.finish();
    await reads?.close().catch((error: unknown) => verdict.error(`closing the projects: ${messageOf(error)}`));
    reads = undefined;
    await storytree?.close().catch((error: unknown) => verdict.error(`closing the library: ${messageOf(error)}`));
    storytree = undefined;
    await postgres?.stop().catch((error: unknown) => verdict.error(`stopping Postgres: ${messageOf(error)}`));
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
