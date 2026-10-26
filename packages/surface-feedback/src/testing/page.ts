/**
 * A real Chrome page holding one of this package's browser modules, bundled as the app's renderer bundles it: what the
 * view and naming tests drive, since popovers and the top layer are the browser's own.
 */
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

/**
 * The module at `entry` (this package's file URL) bundled as a script that puts its exports on `globalThis[name]`. A
 * test names it under `entryPoints`, as esbuild does, so the code survey sees the test reaches it.
 */
export async function bundled({ entryPoints: [entry] }: { entryPoints: [URL] }, name: string): Promise<string> {
  // A file path, not `entry.pathname`: on Windows that reads "/C:/…", which esbuild cannot resolve.
  const result = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, format: "iife", globalName: name, platform: "browser", target: "es2023", logLevel: "silent" });
  return result.outputFiles[0]!.text;
}

/** Chrome, installed on the three CI runner images, so no browser is downloaded during tests. */
export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

/** A fresh page holding `html`, then `scripts`, each run in order. */
export async function pageWith(browser: Browser, html: string, scripts: readonly string[] = []): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  for (const script of scripts) await page.addScriptTag({ content: script });
  return page;
}
