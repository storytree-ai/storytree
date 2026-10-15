// pnpm --filter @storytree/website build, then: node packages/website/evidence/first-short/capture-overlay.mjs
// Pictures of the first short's overlay on the built home page, into this folder: on a laptop and a phone mid-clip, and
// with reduced motion asked for, where the still and its link stand in for the video; and on the tour, where it must leave
// the tour's bar and its waitlist button clear.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try {
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
try {
  for (const [name, viewport, reducedMotion] of [["laptop", { width: 1440, height: 900 }, "no-preference"], ["phone", { width: 390, height: 844 }, "no-preference"],
    ["laptop-reduced-motion", { width: 1440, height: 900 }, "reduce"]]) {
    const page = await browser.newPage({ viewport, reducedMotion });
    await page.goto(url);
    const playing = reducedMotion === "reduce" ? null
      : await page.waitForFunction(() => { const v = document.querySelector("#short video"); return v && v.currentTime > 4 && !v.paused; }, null, { timeout: 30_000 }).then(() => true, () => false);
    await page.screenshot({ path: path.join(here, `overlay-${name}.png`) });
    console.log(name, reducedMotion === "reduce" ? "reduced motion" : playing ? "playing" : "NOT PLAYING (this Chromium may lack the codecs; the poster shows)");
    await page.close();
  }
  for (const [name, viewport] of [["tour-laptop", { width: 1440, height: 900 }], ["tour-phone", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto(url);
    await page.locator("#chapter2").scrollIntoViewIfNeeded();
    await page.locator("#tour-hatch").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const [short, hatch, bar] = await Promise.all(["#short", "#tour-hatch", "#tour-bar"].map(selector => page.locator(selector).boundingBox()));
    const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    await page.screenshot({ path: path.join(here, `overlay-${name}.png`) });
    console.log(name, overlaps(short, hatch) ? "COVERS THE WAITLIST BUTTON" : "waitlist button clear", overlaps(short, bar) ? "COVERS THE TOUR BAR" : "tour bar clear");
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
