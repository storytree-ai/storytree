// A step's words (ADR-1018 D3 to D5), from a built site: one intro step and two map steps, at a laptop's width, a tablet's and two
// phones', with the tour playing, so the map steps show their second line as it replaces the first.
// pnpm --filter @storytree/website build && node packages/website/evidence/step-words/capture.mjs <before|after> [--dist <folder>]
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tag = process.argv[2] ?? "after";
const dist = process.argv.includes("--dist") ? path.resolve(process.argv[process.argv.indexOf("--dist") + 1]) : path.resolve(here, "../../dist");
const pictures = path.join(here, tag);
await mkdir(pictures, { recursive: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
// Each step with how long it plays before its picture: the map steps until their second line has begun.
const shots = [["fixes", 9000], ["map-claims", 10_500], ["map-health", 13_000]];
const seen = [];
try {
  for (const [width, height] of [[1440, 900], [1000, 800], [800, 1000], [390, 844], [320, 640]]) {
    for (const [id, wait] of shots) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
      await page.locator(`#tour-pips [data-step="${id}"]`).click();
      await page.waitForTimeout(wait);
      seen.push(await page.evaluate(() => {
        const visible = node => !!node && getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden" && node.getBoundingClientRect().width > 0;
        const kicker = document.getElementById("tour-kicker");
        return {
          step: document.querySelector("#chapter2").dataset.tourStep, width: innerWidth,
          kicker: visible(kicker) ? kicker.textContent : null,
          bar: visible(document.getElementById("tour-label")) ? document.getElementById("tour-label").textContent : null,
          depth: document.getElementById("tour-depth").hidden ? null : document.getElementById("tour-depth").textContent,
          lines: [...document.querySelectorAll("#tour-lines .tour-line.on")].map(line => line.textContent.slice(0, 40)),
        };
      }));
      await page.screenshot({ path: path.join(pictures, `${width}-${id}.png`) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(seen, null, 1));
