/**
 * Chromium for a capture, found from this checkout on any machine: Playwright is this package's own
 * playwright-core, and Chromium is the one Playwright installed for itself, unless the environment
 * names others by path (CAPTURE_PLAYWRIGHT, CAPTURE_CHROMIUM). A path is imported by its file URL,
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
export function launchPlan({ env, platform }: Machine = THIS_MACHINE): LaunchPlan {
  const playwright = env.CAPTURE_PLAYWRIGHT;
  const module = playwright === undefined ? "playwright-core" : playwright.startsWith("file:") ? playwright : pathToFileURL(playwright, { windows: platform === "win32" }).href;
  const options: LaunchOptions = {
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
    ...(env.CAPTURE_CHROMIUM === undefined ? {} : { executablePath: env.CAPTURE_CHROMIUM }),
  };
  return { module, options };
}

/** A capture's Chromium, launched as launchPlan says for `machine`. */
export async function launch(machine: Machine = THIS_MACHINE): Promise<Browser> {
  const { module, options } = launchPlan(machine);
  const { chromium } = (await import(module)) as typeof import("playwright-core");
  return chromium.launch(options);
}
