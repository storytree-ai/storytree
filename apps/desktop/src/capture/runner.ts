/** One capture lifecycle; a new look supplies its seed, views and expectations. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { Browser, Page, ViewportSize } from "playwright-core";

import type { StorytreeBridge } from "../bridge.js";
import { fakeBridge, type FakeBridge } from "./fake-bridge.js";
import { launch } from "./launch.js";
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
  dist?: string;
  /** Pure HTML/SVG previews use Chromium's ordinary compositor, without the WebGL flags. */
  softwareGL?: boolean;
}

export interface SeededCaptureOptions extends CaptureOptions {
  dist: string;
  seed: CaptureSeed;
  survey?: Awaited<ReturnType<StorytreeBridge["codeSurvey"]>>;
  answers?: Partial<StorytreeBridge>;
  viewport?: ViewportSize;
  prepare?: (context: CapturePage) => unknown | Promise<unknown>;
  views: CaptureView[];
}

/** Render a bounded number of frames; an observation hook may request each globe redraw. */
export async function settle(page: Page, frames = 12): Promise<void> {
  // A string avoids tsx's function-name helpers; invoke it so Playwright awaits the loop.
  await page.evaluate(`(async frames => {
    for (let i = 0; i < frames; i++) {
      globalThis.__globe?.invalidate();
      await new Promise(requestAnimationFrame);
    }
  })(${JSON.stringify(frames)})`);
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };

/** A shared server/browser lifetime for captures with their own interaction or measurement flow. */
export async function withCapture<T>({ folder, dist, softwareGL = true }: CaptureOptions, run: (context: CaptureContext) => Promise<T>): Promise<T> {
  const out = captureOutput(folder);
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
    try { await browser?.close(); }
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
    let current = seed.projects[0];
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: seed.projects, current }),
      chooseProject: async name => ({ projects: seed.projects, current: current = name }),
      listProjects: async () => seed.projects,
      projectTree: async () => seed.tree,
      changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
      frontCovers: async (_, id) => seed.covers[id] ?? [],
      ...(survey === undefined ? {} : { codeSurvey: async () => survey }),
      ...answers,
    });
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
    await bridge.ready(page);
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
  });
}
