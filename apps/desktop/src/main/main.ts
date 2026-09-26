/**
 * The storytree 0.3 desktop app's main process. It starts the app's own Postgres on its data
 * directory (~/.storytree/0.3/pgdata) through local-postgres, connects the library through its
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
 * `--smoke` renders the project without showing a window, saves a screenshot to the file given
 * with `--screenshot <file>`, prints the page's text to stdout, and quits: exit 0 only if the
 * surface on show says it drew every story of the project and every one of its capabilities.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } from "electron";

import {
  appDirIn,
  background,
  buildApp,
  electronIn,
  pageReads,
  slotOf,
  slotSha,
  smokeProblems,
  TRAY_MENU,
  updateToMain,
  type PageReads,
  type RunningBuild,
} from "@storytree/app";
import { connect, type AnnotatedTree, type Storytree } from "@storytree/library";
import { DataDirInUseError, findBinaries, start, type LocalPostgres } from "@storytree/local-postgres";

import { CHANNELS } from "../bridge.js";
import { APP_OWNER, appHome } from "../home.js";
import { chooseProject, parseArgs } from "./args.js";
import { TRAY_ICON_PNG } from "./tray-icon.js";

const args = parseArgs(process.argv);
const home = appHome();
/** How often the app that follows merged main checks whether main has moved. */
const UPDATE_EVERY_MS = 3 * 60_000;
/** How long the smoke check may take, start to finish, before it gives up. */
const SMOKE_TIMEOUT_MS = 180_000;

// Electron's own files (cache, local storage) live in the app's home too, apart from any other app.
app.setPath("userData", home.electron);

let postgres: LocalPostgres | undefined;
let storytree: Storytree | undefined;
let reads: PageReads | undefined;
let shutDown: Promise<void> | undefined;
/** What the window was opened with, so it can be opened again after it is closed. */
let windowQuery: { project?: string; problem?: string } = {};
/** Held here so it is not garbage-collected, which would remove the icon. */
let tray: Tray | undefined;
const lifecycle = background({ stopDatabase: shutdown, exit: (code) => app.exit(code) });

if (!args.smoke && !app.requestSingleInstanceLock()) {
  app.quit(); // the app is already open: that one is focused instead
} else {
  app.on("second-instance", () => showWindow());
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
      void shutdown().finally(() => app.exit(1));
    }, SMOKE_TIMEOUT_MS).unref();
  }
  app.whenReady().then(run, (error: unknown) => fail(error));
}

async function run(): Promise<void> {
  ipcMain.handle(CHANNELS.listProjects, () => (reads === undefined ? [] : reads.listProjects()));
  ipcMain.handle(CHANNELS.projectTree, (_event, name: unknown) => open().projectTree(name));
  ipcMain.handle(CHANNELS.changesSince, (_event, name: unknown, cursor: unknown) => open().changesSince(name, cursor));
  ipcMain.handle(CHANNELS.linesSince, (_event, name: unknown, cursor: unknown) => open().linesSince(name, cursor));
  ipcMain.handle(CHANNELS.frontCovers, (_event, name: unknown, nodeId: unknown) => open().frontCovers(name, nodeId));
  ipcMain.handle(CHANNELS.relatedNotes, (_event, name: unknown, noteId: unknown) => open().relatedNotes(name, noteId));

  let problem: string | undefined;
  try {
    postgres = await start({ dataDir: home.pgdata, owner: APP_OWNER, bin: postgresBinaries(), log: (message) => console.log(`Postgres: ${message}`) });
    storytree = await connect({ url: postgres.url });
    reads = pageReads({ storytree, serverUrl: postgres.url });
    recordLaunch();
  } catch (error) {
    problem =
      error instanceof DataDirInUseError
        ? `The app's library (${error.dataDir}) is in use by ${error.owner ?? "another program"} (process ${error.pid}). ` +
          "Close that, then open the app again."
        : `The app's library could not be opened: ${messageOf(error)}`;
    console.error(problem);
  }
  const projects = storytree === undefined ? [] : await storytree.listProjects();
  const project = chooseProject(projects, args.project);
  windowQuery = { ...(project === undefined ? {} : { project }), ...(problem === undefined ? {} : { problem }) };
  if (args.smoke) await smoke(openWindow(windowQuery), project);
  else {
    if (!args.background) openWindow(windowQuery);
    showTray();
    void followMain();
  }
}

/**
 * When the app runs from one of the runtime's slots, follow merged main: check every few minutes,
 * and when main has moved and its new commit has built beside this one, restart into it, with the
 * window shown only if it is showing now. A failed build is logged and tried again at the next
 * check; the running app is untouched. The app run from anywhere else (a checkout, `pnpm desktop`)
 * never updates itself.
 */
async function followMain(): Promise<void> {
  const slot = slotOf(home.runtime, app.getAppPath());
  if (slot === undefined) return;
  const dir = path.join(home.runtime, slot);
  const running: RunningBuild = { slot, dir, sha: await slotSha(dir) };
  console.log(`updates: following merged main from slot ${slot} (${running.sha.slice(0, 7)})`);
  let checking = false;
  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const next = await updateToMain({ runtimeDir: home.runtime, running, build: buildApp });
      if (next === undefined) return;
      console.log(`updates: main moved to ${next.sha.slice(0, 7)}; restarting into slot ${next.slot}`);
      const showing = BrowserWindow.getAllWindows().some((window) => window.isVisible());
      app.relaunch({ execPath: electronIn(next.dir), args: [appDirIn(next.dir), ...(showing ? [] : ["--background"])] });
      app.quit();
    } catch (error) {
      console.error(`updates: ${messageOf(error)}`);
    } finally {
      checking = false;
    }
  };
  setInterval(() => void check(), UPDATE_EVERY_MS).unref();
  void check();
}

/** The tray icon, whose menu brings the window back or quits the app. */
function showTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_PNG));
  tray.setToolTip("storytree 0.3");
  const actions = { show: showWindow, quit: () => app.quit() };
  tray.setContextMenu(Menu.buildFromTemplate(TRAY_MENU.map((item) => ({ label: item.label, click: actions[item.id] }))));
  tray.on("click", showWindow);
}

/** Bring the window forward, opening it again on the same project if it was closed. */
function showWindow(): void {
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
  const command = app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath) : process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  try {
    writeFileSync(home.launchRecord, `${JSON.stringify({ command, args }, null, 2)}\n`);
  } catch (error) {
    console.error(`recording how to open the app: ${messageOf(error)}`);
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
    // Open one capability, as a click would, so the screenshot shows contracts too: the first
    // whose verified column is not passing, else the first.
    const opened = (await window.webContents.executeJavaScript(`(() => {
      const all = [...document.querySelectorAll("details.capability")];
      const pick = all.find((node) => node.querySelector("summary [data-column=verified] .badge-passing") === null) ?? all[0];
      if (pick === undefined) return null;
      pick.querySelector("summary").click();
      return { title: pick.querySelector("summary .row-title").innerText, contracts: pick.querySelectorAll("[data-contract-id]").length };
    })()`)) as { title: string; contracts: number } | null;
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
    const problems = smokeProblems(state, tree, page.drew);
    if (problems.length === 0 && tree !== undefined) {
      console.log(`smoke: project "${project}": ${drewText(tree, page.drew)}`);
      code = 0;
    } else {
      for (const problem of problems) console.error(`smoke: ${problem}`);
    }
  } catch (error) {
    console.error(`smoke: ${messageOf(error)}`);
  } finally {
    await shutdown();
    app.exit(code);
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
  shutDown ??= (async () => {
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
  console.error(`storytree 0.3: ${messageOf(error)}`);
  void shutdown().finally(() => app.exit(1));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
