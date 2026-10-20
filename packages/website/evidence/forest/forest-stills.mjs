// Capture storytree's two stills, public/forest-*.png, from the website's own live drawing of the framed map, the same saved
// renderer the visitor's map uses. Build first (pnpm --filter @storytree/website build), then from the checkout root:
//   node packages/website/evidence/forest/forest-stills.mjs
// Each is the drawn canvas's full width, cut to a band round the sheet's names; the frame's buttons and notes are hidden for the shot.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(website, "dist");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
try {
  for (const [width, height, kind] of [[1440, 1000, "desktop"], [390, 844, "phone"]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: kind === "phone" ? 2 : 1, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#map-frame").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 90_000 });
    await page.waitForTimeout(4000);
    // Only the drawing: the frame's views, compass, zoom and tap buttons sit over it on the page, not in the picture.
    await page.addStyleTag({ content: "#map-frame > :not(#website-forest), .forest-views, .sheet-compass, .map-browse-toggle { visibility:hidden !important; }" });
    await page.waitForTimeout(500);
    const box = await page.locator("#website-forest .forest-canvas canvas").boundingBox();
    // The glass sheet is wider than it is deep: the band from a little above its northernmost name to a little below its southernmost.
    const names = await page.locator("#website-forest .planet-nameplate[data-story-id]").evaluateAll(plates => plates.map(plate => plate.getBoundingClientRect()).filter(at => at.height));
    const top = Math.max(box.y, Math.min(...names.map(at => at.top)) - 90), bottom = Math.min(box.y + box.height, Math.max(...names.map(at => at.bottom)) + 50);
    const clip = { x: box.x, y: top, width: box.width, height: bottom - top };
    await page.screenshot({ path: path.join(website, `public/forest-${kind}.png`), clip });
    console.log(`Captured the framed map's ${kind} still at ${width} × ${height}: ${Math.round(clip.width)} × ${Math.round(clip.height)} px`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
