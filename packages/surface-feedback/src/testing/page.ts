import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

export async function bundled({ entryPoints: [entry] }: { entryPoints: [URL] }, name: string): Promise<string> {
  const result = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, format: "iife", globalName: name, platform: "browser", target: "es2023", logLevel: "silent" });
  return result.outputFiles[0]!.text;
}

export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

export async function pageWith(browser: Browser, html: string, scripts: readonly string[] = []): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  for (const script of scripts) await page.addScriptTag({ content: script });
  return page;
}
