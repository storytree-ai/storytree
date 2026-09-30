// Build first, then: node packages/website/evidence/capture.mjs [evidence subfolder]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, process.argv[2] ?? "scaffold");
const dist = path.resolve(here, "../dist");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  await mkdir(output, { recursive: true });
  const measures = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });
    const measured = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      headings: document.querySelectorAll("h1").length,
      mount: document.querySelector("#website-forest").getBoundingClientRect().toJSON(),
      bodyFont: getComputedStyle(document.querySelector(".lede")).fontSize,
    }));
    assert.equal(measured.document, measured.viewport, "No horizontal page overflow");
    assert.equal(measured.headings, 1);
    assert.deepEqual(errors, []);
    measures.push(measured);
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true });
    await page.close();
  }
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(measures, null, 2) + "\n");
  console.log(JSON.stringify(measures));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
