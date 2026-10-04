// The globe's story nameplates on the shop at phone and desktop widths (forest 3.30): the cut to the shop's three
// teaching islands (the stand-down step since the cut was retired: the whole shop, its four teaching stories lit) and free play on the whole shop. Saves a picture of each and every
// plate's box where it hangs and where it settled, so how far each name sits from its island is measured, not eyeballed.
// pnpm --filter @storytree/website build && node packages/website/evidence/nameplates-phone/capture.mjs <before|after>
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const label = process.argv[2] ?? "after";
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });

/** Every story plate on show: its box where it hangs (before any step), where it settled, and whether it is dimmed. */
const plates = page => page.evaluate(() => [...document.querySelectorAll(".planet-nameplate[data-story-id]")]
  .filter(node => node.style.visibility !== "hidden" && node.getBoundingClientRect().width > 0)
  .map(node => {
    const box = node.getBoundingClientRect(), drop = Number(node.dataset.drop ?? 0), shift = Number(node.dataset.shift ?? 0);
    const r = n => Math.round(n * 10) / 10;
    return {
      story: node.dataset.storyId, title: node.textContent, facing: Math.round(Number(node.dataset.facing) * 1000) / 1000, crowded: node.classList.contains("crowded"),
      dimmed: Number(getComputedStyle(node).opacity) < 0.4,
      island: node.dataset.island ? JSON.parse(node.dataset.island) : undefined,
      hangs: { left: r(box.left - shift), top: r(box.top - drop), right: r(box.right - shift), bottom: r(box.bottom - drop) },
      settled: { left: r(box.left), top: r(box.top), right: r(box.right), bottom: r(box.bottom) },
    };
  }));

const measured = {};
for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }], ["320", { width: 320, height: 700 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  await page.locator('#tour-pips [data-step="agents-standdown"]').click();
  if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
  await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "shop" && document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
  await page.waitForTimeout(6000);
  if (await page.locator("#tour-play").getAttribute("aria-label") === "Pause the tour") await page.locator("#tour-play").click();
  await page.waitForTimeout(500);
  measured[`${tag}-cut`] = await plates(page);
  await page.screenshot({ path: path.join(here, `${label}-${tag}-cut.png`) });
  await page.locator("#tour-skip").click();
  await page.waitForTimeout(5000);
  measured[`${tag}-freeplay`] = await plates(page);
  await page.screenshot({ path: path.join(here, `${label}-${tag}-freeplay.png`) });
  await page.close();
}
await writeFile(path.join(here, `measurements-${label}.json`), JSON.stringify(measured, null, 1) + "\n");
for (const [scene, list] of Object.entries(measured)) {
  const away = list.map(p => ({ title: p.title, far: Math.round(Math.hypot(p.settled.left - p.hangs.left, p.settled.top - p.hangs.top)), crowded: p.crowded }));
  console.log(scene, JSON.stringify(away));
}
assert.ok(Object.values(measured).every(list => list.length > 0), "plates were on show in every scene");
await browser.close(); server.close();
