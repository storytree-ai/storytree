/** Capability 2 · Storytree projects. One capture lifecycle; a new look supplies its seed, views and expectations. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { Browser, Page, ViewportSize } from "playwright-core";

import type { StorytreeBridge } from "../bridge.js";
import { fakeBridge, type FakeBridge, type FakeBridgeOptions } from "./fake-bridge.js";
import { closeBrowser, launch } from "./launch.js";
import { captureOutput } from "./output.js";

export interface CaptureSeed {
  projects: string[];
  tree: Awaited<ReturnType<StorytreeBridge["projectTree"]>>;
  changes: Awaited<ReturnType<StorytreeBridge["changesSince"]>>;
  lines: Awaited<ReturnType<StorytreeBridge["linesSince"]>>;
  covers: Record<string, Awaited<ReturnType<StorytreeBridge["frontCovers"]>>>;
}

export interface CaptureContext {
  browser: Browser;
  /** The server's origin; absent for a component capture using setContent. */
  origin: string | undefined;
  out: string;
  settle: typeof settle;
}

export interface CapturePage extends CaptureContext {
  page: Page;
  bridge: FakeBridge;
  errors: string[];
  warnings: string[];
  failed: string[];
}

export interface CaptureView {
  name: string;
  prepare?: (context: CapturePage) => unknown | Promise<unknown>;
  measure?: (context: CapturePage) => unknown | Promise<unknown>;
  expect?: (value: unknown, context: CapturePage) => unknown | Promise<unknown>;
  picture?: false;
  measurement?: string;
}

interface CaptureOptions {
  folder: string;
  /** The run's prefix or label, which its files carry: a check run then clears only those from its scratch folder. */
  name?: string;
  dist?: string;
  /** Pure HTML/SVG previews use Chromium's ordinary compositor, without the WebGL flags. */
  softwareGL?: boolean;
  /** How long a close may run on after the browser disconnects before its process is killed. */
  closeGraceMs?: number;
}

export interface SeededCaptureOptions extends CaptureOptions {
  dist: string;
  /** What the page reads; none for a capture whose `answers` read a live library (live.ts's liveAnswers). */
  seed?: CaptureSeed;
  survey?: Awaited<ReturnType<StorytreeBridge["codeSurvey"]>>;
  answers?: Partial<StorytreeBridge>;
  /** The first-run guide is already seen unless "unseen", for a capture of the guide itself. */
  guide?: FakeBridgeOptions["guide"];
  /** The teaching cards are hidden unless "shown", for a capture of the cards themselves. */
  teaching?: FakeBridgeOptions["teaching"];
  /** The map's kept layouts to open with (a shared seed's `layouts`); without them every island searches from nothing. */
  layouts?: FakeBridgeOptions["layouts"];
  viewport?: ViewportSize;
  prepare?: (context: CapturePage) => unknown | Promise<unknown>;
  views: CaptureView[];
}

/**
 * Render a bounded number of frames; an observation hook may request each globe redraw. While the map then says it is laying
 * out its islands (2.63), wait until it says it has settled, so no picture taken after shows an island mid-layout.
 */
export async function settle(page: Page, frames = 12): Promise<void> {
  // A string avoids tsx's function-name helpers; invoke it so Playwright awaits the loop.
  await page.evaluate(`(async frames => {
    for (let i = 0; i < frames; i++) {
      globalThis.__globe?.invalidate();
      await new Promise(requestAnimationFrame);
    }
  })(${JSON.stringify(frames)})`);
  if (await page.evaluate(`document.querySelector('[data-layout="laying-out"]') !== null`)) await settledMap(page, { frames });
}

/**
 * Waits until the map says it has settled (the forest's `data-layout="settled"` mark, 3.98) and says so for `frames`
 * frames running, so an island between its search landing and its roads being asked is not taken as laid out.
 */
export async function settledMap(page: Page, { frames = 12, timeoutMs = 180_000 }: { frames?: number; timeoutMs?: number } = {}): Promise<void> {
  // A string for the same reason as settle's.
  const held = await page.evaluate(`(async ({ frames, timeoutMs }) => {
    const until = performance.now() + timeoutMs;
    for (let run = 0; run < frames;) {
      if (performance.now() > until) return false;
      globalThis.__globe?.invalidate();
      await new Promise(requestAnimationFrame);
      run = document.querySelector('[data-layout="settled"]') === null ? 0 : run + 1;
    }
    return true;
  })(${JSON.stringify({ frames, timeoutMs })})`);
  if (held !== true) throw new Error(`the map did not say it had settled within ${timeoutMs} ms: ${await page.evaluate(`document.querySelector('[data-layout="laying-out"]')?.textContent ?? "no layout mark on the page"`)}; a seed's \`layouts\`, given to the bridge, open its islands laid out`);
}

/** Every localStorage entry the page holds: what a refresh of a seed's `layouts` reads back from a settled map. */
export async function pageStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key) ?? ""])));
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };

/** A shared server/browser lifetime for captures with their own interaction or measurement flow. */
export async function withCapture<T>({ folder, name, dist, softwareGL = true, closeGraceMs }: CaptureOptions, run: (context: CaptureContext) => Promise<T>): Promise<T> {
  const out = captureOutput(folder, name === undefined ? {} : { name });
  const server = dist === undefined ? undefined : createServer((request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (name === "/favicon.ico") { response.writeHead(204).end(); return; }
      const root = path.resolve(dist);
      const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
      if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
      const bytes = readFileSync(file);
      response.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  let browser: Browser | undefined;
  try {
    if (server !== undefined) await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server?.address();
    const origin = address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : undefined;
    browser = await launch(undefined, { softwareGL });
    return await run({ browser, origin, out, settle });
  } finally {
    try { if (browser !== undefined) await closeBrowser(browser, { afterDisconnectMs: closeGraceMs }); }
    finally {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }
}

/** The common seeded page, followed by just the views that make this look's evidence. */
export async function runCapture(options: SeededCaptureOptions): Promise<unknown[]> {
  return withCapture(options, async context => {
    const { seed, survey, answers = {} } = options;
    const bridge = fakeBridge({
      ...(seed === undefined ? {} : seeded(seed)),
      ...(survey === undefined ? {} : { codeSurvey: async () => survey }),
      ...answers,
    }, { guide: options.guide, teaching: options.teaching, layouts: options.layouts });
    return views(context, bridge, options);
  });
}

/** The page's reads answered from `seed`: its whole history at the first read, nothing newer after. */
function seeded(seed: CaptureSeed): Partial<StorytreeBridge> {
  let current = seed.projects[0];
  return {
    projectSelection: async () => ({ projects: seed.projects, current }),
    chooseProject: async name => ({ projects: seed.projects, current: current = name }),
    listProjects: async () => seed.projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => seed.covers[id] ?? [],
  };
}

/** The page opened on `bridge`, then each view's picture and measurement. */
async function views(context: CaptureContext, bridge: FakeBridge, options: SeededCaptureOptions): Promise<unknown[]> {
  const page = await context.browser.newPage({ viewport: options.viewport ?? { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
  const errors: string[] = [], warnings: string[] = [], failed: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("response", response => { if (response.status() >= 400) failed.push(response.url()); });
  const viewContext = { ...context, page, bridge, errors, warnings, failed };
  await bridge.install(page);
  await page.goto(`${context.origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  try {
    await bridge.ready(page);
  } catch (error) {
    // A page that never reaches ready has often already logged why: name that, not just the timeout.
    if (errors.length === 0) throw error;
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nthe page logged meanwhile:\n${errors.map(each => `  ${each}`).join("\n")}`, { cause: error });
  }
  await options.prepare?.(viewContext);
  const values: unknown[] = [];
  for (const view of options.views) {
    await view.prepare?.(viewContext);
    await settle(page);
    const value = await view.measure?.(viewContext);
    await view.expect?.(value, viewContext);
    if (view.picture !== false) await page.screenshot({ path: path.join(context.out, `${view.name}.png`), timeout: 180_000 });
    if (value !== undefined) writeFileSync(path.join(context.out, view.measurement ?? `${view.name}.json`), JSON.stringify(value, null, 2) + "\n");
    values.push(value);
  }
  assert.deepEqual(errors, [], "the captured page has no script or console errors");
  assert.deepEqual(failed, [], "the captured page loads its assets");
  return values;
}
