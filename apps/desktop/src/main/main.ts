// Capability 1 · Lifecycle
import { smokeArcSurface } from "@storytree/arc-surface";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import NAMED_SURFACES from "#parts/namedSurfaces";
import SURFACES from "#parts/surfaces";
import PAGE_ANSWERS from "#parts/pageAnswers";
import PAGE_CHANNELS from "#parts/pageChannels";
import PROJECT_RECORDS from "#parts/projectRecords";
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
  keepTryingBehind,
  openAppLibrary,
  openAtStartup,
  type LibraryQuery,
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
import { restartLimit } from "@storytree/app/updates/restart-limit";
import { answerStartWhileInstalling, installUnderway } from "@storytree/app/updates/install-underway";
import { appShutdown } from "@storytree/app/lifecycle/stopping";
import { restartAllowed } from "@storytree/app/updates/restart-allowed";
import { PROJECTS_CHANNELS } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS } from "@storytree/app/updates/bridge";
import { appVersion as runningVersion } from "@storytree/app/version";
import { connect, type AnnotatedTree, type Storytree } from "@storytree/library";
import { asReader, nameReader } from "@storytree/library/reads";
import { findBinaries, start, type LocalPostgres } from "@storytree/local-postgres";
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
import { packagedBuild } from "./packaged-build.js";
import { logMainErrors } from "./main-errors.js";
import { logPageErrors } from "./page-errors.js";
import { CLEAR_FIRST_LAUNCH } from "./smoke-first-launch.js";
import { smokeElectronFiles, smokePhases } from "./smoke-phases.js";
import { stressWindow, windowSteps } from "./smoke-stress.js";
import { smokeVerdict } from "./smoke-verdict.js";
import { lateReads, projectAnswers, readerPerChannel } from "./late-reads.js";
import { keepPageInWindow } from "./page-window.js";
import { keepTray } from "./tray.js";
import { titleWindow } from "./window-title.js";
import { bringWindowForward, showPageQuery } from "./window-shown.js";
import { PLUGIN_SCHEME, pluginResponse, windowKinds, windowProjectRecords, windowStandIns } from "./stand-ins.js";
import { checkPage, PAGE_SCHEME, pageResponse, pageUrl } from "./page-scheme.js";
import { finishStartCheck, runWhenReady } from "./start-check.js";
import { answerStartMarks, processLaunchedAt, startMarks } from "./start-marks.js";
import { appLog, teeConsole } from "./app-log.js";
import { START_MARK } from "../bridge.js";

declare const STORYTREE_WORKOS_CLIENT_ID: string | undefined;

let build = app.isPackaged ? packagedBuild(app.getVersion()) : "";
const args = parseArgs(process.argv, { packaged: app.isPackaged, env: process.env });
nameReader("app");
const verdict = smokeVerdict({ smoke: args.smoke, log: line => console.error(line) });
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
const log = appLog(path.join(home.dir, "app.log"));
if (!args.smoke && !args.startCheck && !args.callbackCheck) teeConsole(console, log);
const marks = args.startCheck || args.callbackCheck ? { mark() {} } : startMarks({ launchedAt: processLaunchedAt(), log });
const SMOKE_TIMEOUT_MS = 180_000;

const scratch = args.smoke ? smokeElectronFiles({ shared: home.electron, tmp: tmpdir() }) : undefined;
if (scratch !== undefined) console.log(scratch.line);
app.setPath("userData", scratch?.dir ?? home.electron);
keepDrawingThroughGpuResets(app);

const identityConfig = feedbackIdentityConfig(STORYTREE_WORKOS_CLIENT_ID);
let signInSession: CallbackSession | undefined;
const earlyCallbacks: string[] = [];

let postgres: LocalPostgres | undefined;
let storytree: Storytree | undefined;
let reads: PageReads | undefined;
const LOOK_EVERY_MS = 60_000;
let projects: ReturnType<typeof projectSelection> | undefined;
let backups: ReturnType<typeof keepBackups> | undefined;
let journey: JourneyRuntime | undefined;
const stopping = appShutdown({
  backups: { held: () => backups },
  journey: { held: () => journey },
  reads: { held: () => reads, letGo: () => { reads = undefined; } },
  library: { held: () => storytree, letGo: () => { storytree = undefined; } },
  postgres: { held: () => postgres, letGo: () => { postgres = undefined; } },
  error: (line) => verdict.error(line),
});
let partsOff: readonly string[] = [];
let parts = windowStandIns({ surfaces: SURFACES, pageAnswers: PAGE_ANSWERS, pageChannels: PAGE_CHANNELS }, { plugins: {} }, []);
let releases: ReturnType<typeof followReleases>;
let windowQuery: WindowQuery = {};
let tray: Tray | undefined;
const lifecycle = background({
  stopPages: () => void verdict.stopping("the pages", () => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }),
  stopDatabase: () => verdict.stopping("the database", shutdown),
  exit: (code) => {
    scratch?.remove();
    app.exit(verdict.exitCode(code));
  },
  relaunch,
  error: (line) => verdict.error(line),
  ...(args.smoke || args.startCheck || args.callbackCheck ? {} : {
    limit: restartLimit({ file: path.join(home.dir, "restarts.json"), stopped: message => errorRecords.record("restarts-stopped", message) }),
  }),
});

const installing = answerStartWhileInstalling({
  platform: process.platform,
  args,
  installed: installedApp,
  underway: () => installUnderway({ home: home.dir, runningBuild: app.getVersion() }),
  whenReady: () => app.whenReady(),
  say: (box) => dialog.showMessageBox(box),
  exit: (code) => app.exit(code),
});

if (installing) {
} else if (!args.smoke && !args.startCheck && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (args.quit) {
  app.exit(0);
} else if (args.callbackCheck) {
  answerCallbackCheckEvents(app, process, { deliver: deliverCallback, exit: (code) => app.exit(code) });
  void runWhenReady(app.whenReady(), checkCallbacks, fail);
} else {
  answerAppEvents(app, process, { deliver: deliverCallback, lifecycle, showWindow, quitApp: () => app.quit() });
  if (args.smoke) {
    setTimeout(() => {
      console.error(phases.gaveUp(SMOKE_TIMEOUT_MS));
      void lifecycle.quit(1);
    }, SMOKE_TIMEOUT_MS).unref();
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
  void runWhenReady(app.whenReady(), run, fail);
}

async function run(): Promise<void> {
  marks.mark("app ready");
  phases.phase("starting the app's handlers");
  answerStartMarks(ipcMain, START_MARK, marks);
  const page = sayOutagesOnce(readerPerChannel(ipcMain), (line) => console.error(line));
  const appVersion = runningVersion({ packaged: app.isPackaged, packagedVersion: () => app.getVersion(), appPath: app.getAppPath() });
  journey = createJourneyRuntime({ home: home.dir, appVersion });
  answerPage(page, JOURNEY_CHANNELS, journey);
  const treesRead = new Map<unknown, AnnotatedTree>();
  partsOff = readPartsOff(home.dir);
  parts = windowStandIns({ surfaces: SURFACES, pageAnswers: PAGE_ANSWERS, pageChannels: PAGE_CHANNELS }, readStandIns(home.dir), partsOff);
  ipcMain.on(STAND_INS_OFFERED, (event) => { event.returnValue = parts.page; });
  protocol.handle(PAGE_SCHEME, (request) => pageResponse(request.url, path.join(__dirname, "renderer")));
  protocol.handle(PLUGIN_SCHEME, (request) => pluginResponse(request.url, parts.served));
  answerPageParts(page, parts.pageAnswers, parts.pageChannels, {
    home: home.dir,
    appVersion,
    library: open,
    treeRead: (project) => treesRead.get(project),
    surveyWorker: path.join(__dirname, "survey-worker.cjs"),
    declaredSurfaces: declaredSurfaces([SURFACES, NAMED_SURFACES], partsOff),
    server: () => storytree,
    captureWindow: async (rect) => {
      const shown = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed() && each.isVisible());
      return shown === undefined ? undefined : new Uint8Array((await shown.webContents.capturePage(rect)).toJPEG(70));
    },
  }, partsOff);
  if (!args.smoke && !args.startCheck) journey.desktopStarted(installedApp());
  const surfaces = surfacesActions(mount(parts.surfaces, partsOff).mounted, home.dir);
  answerPage(page, SURFACES_CHANNELS, surfaces);
  const help = setupHelpActions({
    licenseFile: path.join(app.isPackaged ? process.resourcesPath : __dirname, "LICENSE"),
    storytreeHome: home.dir,
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
    projectRecords: windowProjectRecords(PROJECT_RECORDS, readStandIns(home.dir), partsOff),
  });
  answerPage(page, SETUP_HELP_CHANNELS, { ...help, addProject: () => help.addProject().then(result => journey!.afterProjectAdded(result)) });
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

  let errorsOpened: Promise<void> | undefined;
  const openLibrary = async (): Promise<string | undefined> => {
    const opened = await openAppLibrary({
      home: home.dir,
      startLocal: () => start({ dataDir: home.pgdata, owner: APP_OWNER, bin: postgresBinaries(), log: (message) => console.log(`Postgres: ${message}`) }),
      connect,
    });
    ({ storytree, postgres } = opened);
    errorsOpened = errorRecords.open(opened.storytree);
    console.log(`library: ${opened.where}`);
    marks.mark("library open");
    const kinds = windowKinds(SURFACES.graph, readStandIns(home.dir), partsOff, (line) => console.log(line));
    reads = pageReads({ storytree, transcriptCacheHome: path.join(home.dir, "transcripts"), kinds });
    const pages = reads;
    projects = projectSelection({
      listProjects: async () => projectsOnThisComputer(await opened.storytree.projectIdentities(), home.dir),
      file: path.join(home.dir, "project-choice.json"),
      lineageOf: (name) => pages.projectLineage(name),
      buildsItself: (name) => pages.projectBuildsItself(name),
    });
    const current = (await projects.read(args.project)).current;
    if (!args.smoke) recordLaunch();
    return current;
  };
  phases.phase("opening the library");
  const started = await openAtStartup({ open: openLibrary, show: (query) => showPage(query, !args.background && !args.smoke), log: (line) => console.error(line), now: Date.now, sleep });
  const [project, problem] = "opened" in started ? [started.opened, undefined] : [undefined, started.problem];
  build = await whichBuild();
  const canRestart = restartAllowed({
    stopping: stopping.stopping,
    postgresUrl: () => postgres?.url,
    seedWriting,
    backups: () => backups,
  });
  const installing = installChoice({ available: !args.smoke && releasesInstall(), file: path.join(home.dir, "install-choice.json") });
  const channels = channelChoice(home.dir, args.smoke);
  const quiet = quietMoment({
    launchedAt: Date.now(),
    choice: () => installing.read().choice,
    windowActiveAt: () => BrowserWindow.getAllWindows().some(window => window.isVisible() && !window.isMinimized())
      ? Date.now() - powerMonitor.getSystemIdleTime() * 1000 : undefined,
    agentActiveAt: async () => storytree === undefined ? undefined : await asReader("app quietMoment", () => agentActiveAt(storytree!)),
    log: (line) => console.error(line),
  });
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
  windowQuery = problem === undefined ? {} : { problem };
  if (args.smoke) {
    phases.phase("opening the window");
    await smoke(openWindow(windowQuery), project);
  }
  else {
    showPage(windowQuery, !args.background);
    showTray();
    libraryWork();
    try { signingIn.apply(); } catch (error) { console.error(`opening at sign-in: ${messageOf(error)}`); }
    setInterval(() => void asReader("app lookAround", () => reads?.lookAround()), LOOK_EVERY_MS).unref();
    releases = followReleases({ restart: lifecycle.restart, canRestart, quiet }, home.dir, () => installing.read().choice);
    if ("unreachable" in started && started.unreachable) {
      void keepTryingBehind({ open: openLibrary, opened: libraryWork, show: (query) => showPage(query, false), log: (line) => console.error(line), stopped: stopping.stopping, now: Date.now, sleep });
    }
  }

  function libraryWork(): void {
    void errorsOpened?.then(() => errorRecords.settled())
      .then(() => askToReportErrors(errorRecords, { ask: reportBox(options => dialog.showMessageBox(options)) }))
      .catch((error: unknown) => console.error(`asking to report the app's errors: ${messageOf(error)}`));
    if (storytree !== undefined) backups = asReader("app backups", () => keepBackups({ storytree: storytree!, dir: home.backups, log: line => console.log(line) }));
  }
}

type WindowQuery = LibraryQuery & { project?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function showPage(query: WindowQuery, open: boolean): void {
  windowQuery = query;
  showPageQuery(BrowserWindow.getAllWindows(), query, {
    load: (window, shown) => window.loadURL(pageUrl(shown)).catch(() => {}),
    open: open ? openWindow : undefined,
  });
}

function showTray(): void {
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

function deliverCallback(url: string): void {
  routeCallback(url, { offered: identityConfig !== undefined, session: signInSession, early: earlyCallbacks, report: args.callbackCheck ? console.log : undefined });
}

async function checkCallbacks(): Promise<void> {
  if (identityConfig !== undefined) startFeedbackIdentity(identityConfig);
  if (registersSignInScheme(args, identityConfig !== undefined)) registerProtocol(AUTH_SCHEME);
  console.log("callback check: waiting for sign-in callbacks");
  for (const url of [...earlyCallbacks.splice(0), ...callbackUrls(process.argv)]) deliverCallback(url);
}

function showWindow(): void {
  bringWindowForward(BrowserWindow.getAllWindows(), { stopping: stopping.stopping(), open: () => openWindow(windowQuery) });
}

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
    writeFileSync(home.launchRecord, `${JSON.stringify({ ...record, pid: process.pid }, null, 2)}\n`);
  } catch (error) {
    console.error(`recording how to open the app: ${messageOf(error)}`);
  }
}

async function whichBuild(): Promise<string> {
  if (app.isPackaged) return packagedBuild(app.getVersion());
  const sha = await checkoutSha(app.getAppPath()).catch(() => undefined);
  return buildLabel({ appPath: app.getAppPath(), ...(sha === undefined ? {} : { sha }) });
}

function relaunch(target: Launch | undefined, inBackground: boolean): void {
  const appImage = process.env.APPIMAGE;
  const launch = target ?? thisBuild({ execPath: process.execPath, argv: process.argv, ...(appImage === undefined ? {} : { appImage }) });
  app.relaunch({ execPath: launch.execPath, args: [...launch.args, ...(inBackground ? ["--background"] : [])] });
}

function postgresBinaries(): string {
  return app.isPackaged
    ? findBinaries({ dir: path.join(process.resourcesPath, "postgres", "bin") })
    : findBinaries({ resolveFrom: app.getAppPath() });
}

function open(): PageReads {
  if (reads === undefined) throw new Error("the library is not open");
  return reads;
}

function openWindow(query: WindowQuery): BrowserWindow {
  return pageWindow(query).window;
}

function pageWindow(query: WindowQuery): { window: BrowserWindow; loaded: Promise<void> } {
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
  keepPageInWindow(window, { headless: args.smoke || args.pageCheck });
  logPageErrors(window.webContents, line => console.error(line));
  titleWindow(window, build);
  const recorder = process.env.STORYTREE_LAG_RECORDER === "off" ? { "lag-recorder": "off" } : {};
  window.once("ready-to-show", () => marks.mark("window ready to show"));
  const loaded = window.loadURL(pageUrl({ ...query, ...recorder }));
  loaded.catch(() => {});
  return { window, loaded };
}

function pageWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

async function smoke(window: BrowserWindow, project: string | undefined): Promise<void> {
  let code = 1;
  try {
    phases.phase("waiting for the page");
    const state = await pageState(window);
    phases.phase(`reading the page (${state})`);
    project = await window.webContents.executeJavaScript("document.body.dataset.project") as string | undefined;
    await window.webContents.executeJavaScript(CLEAR_FIRST_LAUNCH);
    const opened = (await window.webContents.executeJavaScript(`(() => {
      const all = [...document.querySelectorAll("details.capability")];
      const pick = all.find((node) => node.querySelector("summary [data-column=verified] .badge-passing") === null) ?? all[0];
      if (pick === undefined) return null;
      pick.querySelector("summary").click();
      return { title: pick.querySelector("summary .row-title").innerText, contracts: pick.querySelectorAll("[data-contract-id]").length };
    })()`)) as { title: string; contracts: number } | null;
    const read = await surfacesActions(mount(parts.surfaces, partsOff).mounted, home.dir).readSurfaces();
    const arcsOn = !read.ok || surfaceOn(read.value, "arcs");
    const arcProblems = project !== undefined && state === "ready" && arcsOn ? await smokeArcSurface(window.webContents, project, open()) : [];
    if (state === "ready" && args.forestMode !== undefined) {
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
    const [width] = window.getContentSize();
    const height = Number(await window.webContents.executeJavaScript("document.documentElement.scrollHeight"));
    window.setContentSize(width ?? 1120, Math.min(Math.max(height, 480), 4000));
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 800));
    let image = await window.webContents.capturePage();
    if (image.isEmpty()) {
      window.showInactive();
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

async function pageState(window: BrowserWindow): Promise<string> {
  for (;;) {
    const state = window.webContents.isLoading()
      ? "loading"
      : String(await window.webContents.executeJavaScript("document.body?.dataset.state ?? 'loading'"));
    if (state !== "loading") return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function drewText(tree: AnnotatedTree, drew: string | undefined): string {
  const { surface } = JSON.parse(drew ?? "{}") as { surface?: string };
  const capabilities = tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0);
  return `the ${surface ?? "surface"} drew ${tree.stories.map((story) => `story "${story.title}"`).join(", ")} and all ${capabilities} capabilities`;
}

function shutdown(): Promise<void> {
  return stopping.shutdown();
}

function fail(error: unknown): void {
  journey?.record("error");
  console.error(`storytree 0.3: ${messageOf(error)}`);
  void lifecycle.quit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
