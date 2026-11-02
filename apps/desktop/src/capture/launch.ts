/**
 * Capability 2 · Storytree projects. Chromium for a capture, found from this checkout on any machine: Playwright is this package's own
 * playwright-core, and Chromium is the one Playwright installed for itself, unless the environment
 * names others by path (CAPTURE_PLAYWRIGHT, CAPTURE_CHROMIUM) or names an installed browser channel
 * (CAPTURE_CHANNEL, such as chrome, which CI's runner images carry). A path is imported by its file URL,
 * since import() refuses a bare Windows path (ERR_UNSUPPORTED_ESM_URL_SCHEME). When the Chromium
 * Playwright pins is not installed, as in a cloud container whose browsers folder holds another
 * revision, the newest Chromium in that folder is launched instead, saying which.
 */
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Browser, LaunchOptions } from "playwright-core";

export interface Machine {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
}

export interface LaunchPlan {
  /** What to import() for Playwright: this package's playwright-core, or the file URL of the one named. */
  readonly module: string;
  readonly options: LaunchOptions;
}

const THIS_MACHINE: Machine = { env: process.env, platform: process.platform };

/** How `machine` launches a capture's Chromium: headless, software GL, a named Chromium only when named. */
export function launchPlan({ env, platform }: Machine = THIS_MACHINE, { softwareGL = true }: { softwareGL?: boolean } = {}): LaunchPlan {
  const playwright = env.CAPTURE_PLAYWRIGHT ?? env.PLANET_PLAYWRIGHT ?? env.STORYTREE_PLAYWRIGHT;
  const executablePath = env.CAPTURE_CHROMIUM ?? env.PLANET_CHROMIUM;
  const channel = executablePath === undefined ? env.CAPTURE_CHANNEL : undefined;
  const module = playwright === undefined ? "playwright-core" : playwright.startsWith("file:") ? playwright : pathToFileURL(playwright, { windows: platform === "win32" }).href;
  const options: LaunchOptions = {
    headless: true,
    // Keep SwiftShader on WebGL with Chromium's ordinary software compositor.
    // Driver mode also puts page compositing through SwiftShader. Run it in the browser process:
    // on a CPU-starved runner each hop to a separate GPU process waits its turn, stretching frames to seconds.
    args: ["--no-sandbox", "--disable-dev-shm-usage",
      ...(softwareGL ? ["--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader", "--in-process-gpu"] : [])],
    ...(executablePath === undefined ? {} : { executablePath }),
    ...(channel === undefined ? {} : { channel }),
  };
  return { module, options };
}

/** A capture's Chromium, launched as launchPlan says for `machine`. */
export async function launch(machine: Machine = THIS_MACHINE, graphics: { softwareGL?: boolean } = {}): Promise<Browser> {
  const { options } = launchPlan(machine, graphics);
  const { chromium } = await loadPlaywright(machine);
  if (options.executablePath !== undefined || options.channel !== undefined) return chromium.launch(options);
  const installed = installedChromium(chromium.executablePath());
  if (installed === undefined) return chromium.launch(options);
  process.stderr.write(`capture: Playwright's pinned Chromium is not installed; launching ${installed}\n`);
  return chromium.launch({ ...options, executablePath: installed });
}

const REVISION = /^(chromium|chromium_headless_shell)-(\d+)$/;
const EXECUTABLES = ["chrome-headless-shell", "chrome-headless-shell.exe", "chrome", "chrome.exe",
  "Chromium.app/Contents/MacOS/Chromium", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"];

/**
 * The Chromium to launch in place of the one Playwright pins, given where Playwright's full Chromium
 * would be (`chromium.executablePath()`, inside its browsers folder's `chromium-<revision>`): undefined
 * while the pinned revision's headless shell, which headless launches use, is installed, or when the
 * folder holds no other Chromium. Otherwise the newest revision's, its headless shell before its full browser.
 */
export function installedChromium(pinned: string): string | undefined {
  let revisionFolder = pinned;
  while (!REVISION.test(path.basename(revisionFolder))) {
    if (path.dirname(revisionFolder) === revisionFolder) return undefined;
    revisionFolder = path.dirname(revisionFolder);
  }
  const browsers = path.dirname(revisionFolder);
  const revision = REVISION.exec(path.basename(revisionFolder))![2];
  if (existsSync(path.join(browsers, `chromium_headless_shell-${revision}`))) return undefined;
  const candidates = readdirSync(browsers).flatMap(name => {
    const match = REVISION.exec(name);
    return match ? [{ name, shell: match[1] === "chromium_headless_shell", revision: Number(match[2]) }] : [];
  }).sort((a, b) => b.revision - a.revision || Number(b.shell) - Number(a.shell));
  for (const { name } of candidates) {
    const folder = path.join(browsers, name);
    for (const build of readdirSync(folder)) {
      for (const executable of EXECUTABLES) {
        const found = path.join(folder, build, executable);
        if (existsSync(found) && statSync(found).isFile()) return found;
      }
    }
  }
  return undefined;
}

/** Also used by Electron captures that connect over CDP instead of launching Chromium. */
export async function loadPlaywright(machine: Machine = THIS_MACHINE): Promise<typeof import("playwright-core")> {
  return import(launchPlan(machine).module) as Promise<typeof import("playwright-core")>;
}

/**
 * The Chromium process behind a browser Playwright launched in this process; undefined for any
 * other browser. Playwright's in-process connection maps the client browser to its server object.
 */
export function browserProcess(browser: Browser): ChildProcess | undefined {
  const connection = (browser as unknown as { _connection?: { toImpl?: (object: unknown) => unknown } })._connection;
  try {
    const server = connection?.toImpl?.(browser) as { options?: { browserProcess?: { process?: ChildProcess } } } | undefined;
    return server?.options?.browserProcess?.process;
  } catch { return undefined; }
}

/**
 * Close a capture's browser, bounded: Playwright's close waits until every pipe of the browser
 * process closes, which on a loaded macOS runner never came after the browser had disconnected
 * (PR #1279). Once disconnected, a close that has not returned within `afterDisconnectMs` is
 * abandoned: the process group is killed and its pipes let go, so the run can end on its own.
 */
export async function closeBrowser(browser: Browser, { afterDisconnectMs = 5_000 } = {}): Promise<"closed" | "killed"> {
  let timer: NodeJS.Timeout | undefined;
  let onDisconnect: (() => void) | undefined;
  // Found before closing: once the browser goes, Playwright no longer maps it to its process.
  const child = browserProcess(browser);
  const closed = browser.close().then(() => "closed" as const);
  const abandoned = new Promise<"killed">(resolve => {
    const wait = () => { timer = setTimeout(resolve, afterDisconnectMs, "killed"); };
    if (!browser.isConnected()) wait();
    else browser.once("disconnected", onDisconnect = wait);
  });
  try {
    const outcome = await Promise.race([closed, abandoned]);
    if (outcome === "killed") {
      closed.catch(() => {});
      killBrowserProcess(child);
    }
    return outcome;
  } finally {
    clearTimeout(timer);
    if (onDisconnect) browser.off("disconnected", onDisconnect);
  }
}

function killBrowserProcess(child: ChildProcess | undefined): void {
  if (child === undefined) return;
  if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    // Playwright starts the browser as its own process group off Windows; kill its helpers with it.
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  for (const stream of child.stdio) stream?.destroy();
  child.unref();
}
