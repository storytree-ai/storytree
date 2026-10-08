/**
 * Capability 2 · Storytree projects. Chromium for a capture, found from this checkout on any machine: Playwright is this package's own
 * playwright-core, and Chromium is the one Playwright installed for itself, unless the environment
 * names others by path (CAPTURE_PLAYWRIGHT, CAPTURE_CHROMIUM) or names an installed browser channel
 * (CAPTURE_CHANNEL, such as chrome, which CI's runner images carry). A path is imported by its file URL,
 * since import() refuses a bare Windows path (ERR_UNSUPPORTED_ESM_URL_SCHEME).
 */
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
  return chromium.launch(options);
}

/** Also used by Electron captures that connect over CDP instead of launching Chromium. */
export async function loadPlaywright(machine: Machine = THIS_MACHINE): Promise<typeof import("playwright-core")> {
  return import(launchPlan(machine).module) as Promise<typeof import("playwright-core")>;
}
